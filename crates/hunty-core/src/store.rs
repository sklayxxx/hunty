//! Хранилище: JSON-файлы + JSONL с сообщениями в папке данных.
use anyhow::{Context, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct Profile {
    pub nick: String,
    #[serde(default)]
    pub ava: String,
    #[serde(default)]
    pub line: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub color: String,
    /// «о себе» — до 190 символов
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub bio: String,
    /// шапка профиля: "" (цвет ника), "g:<имя градиента>" или data:image/… до 200 КБ
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub banner: String,
    /// «играет в …» — ставит приложение, если ты разрешил
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub game: String,
    #[serde(default)]
    pub ts: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FriendState {
    Friend,
    Incoming,
    Outgoing,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Friend {
    pub peer: String,
    pub profile: Profile,
    pub state: FriendState,
    pub since: u64,
    #[serde(default)]
    pub dm: String,
    /// адреса из кода дружбы (пока не подключились)
    #[serde(default)]
    pub hint: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Member {
    pub peer: String,
    #[serde(default)]
    pub nick: String,
    #[serde(default)]
    pub ava: String,
    #[serde(default)]
    pub role: String,
    pub ts: u64,
    #[serde(default)]
    pub gone: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Room {
    pub id: String,
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
    /// аватарка группы: data:image/… до 96 КБ ("" — плитка с буквой)
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub pic: String,
    #[serde(default)]
    pub secret: String,
    pub owner: String,
    pub members: BTreeMap<String, Member>,
    pub created: u64,
    #[serde(default)]
    pub invite: String,
    #[serde(default)]
    pub voice: bool,
    #[serde(default)]
    pub meta_ts: u64,
    // ---- локальное ----
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub read_ts: u64,
    #[serde(default)]
    pub pending: bool,
    #[serde(default)]
    pub inviter: String,
    #[serde(default)]
    pub inviter_addrs: Vec<String>,
    /// история очищена до этого момента (локально): старое не принимаю и не докачиваю
    #[serde(default)]
    pub clear_ts: u64,
}

impl Room {
    pub fn is_member(&self, peer: &str) -> bool {
        self.members.get(peer).map(|m| !m.gone).unwrap_or(false)
    }
    pub fn live_members(&self) -> impl Iterator<Item = &Member> {
        self.members.values().filter(|m| !m.gone)
    }
    pub fn is_admin(&self, peer: &str) -> bool {
        self.owner == peer
            || self.members.get(peer).map(|m| !m.gone && m.role == "admin").unwrap_or(false)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Msg {
    pub id: String,
    pub room: String,
    pub from: String,
    pub ts: u64,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub data: Value,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub reply: String,
    #[serde(default)]
    pub sig: String,
    /// где лежит полная строка в JSONL (только у «тяжёлых»: их вложение в памяти не держу)
    #[serde(skip)]
    pub at: Option<(u64, u32)>,
}

/// Вложение длиннее — в памяти только «лёгкая» копия, полная строка читается с диска.
pub const HEAVY: usize = 4096;
/// Сколько после отправки можно править сообщение (UI показывает обратный отсчёт).
pub const EDIT_WINDOW_MS: u64 = 30_000;
/// Правило «30 секунд» действует для сообщений начиная с v0.3 — старые правки не пропадут.
pub const EDIT_RULE_SINCE: u64 = 1793404800000;

/// Служебные сообщения, которые меняют другие: реакция, правка, удаление у всех.
pub fn is_meta(kind: &str) -> bool {
    matches!(kind, "react" | "edit" | "del")
}
/// На какое сообщение ссылается служебное.
pub fn target(m: &Msg) -> Option<&str> {
    m.data.get("to").and_then(|x| x.as_str())
}
fn heavy_len(m: &Msg) -> usize {
    m.data.get("src").and_then(|x| x.as_str()).map(|s| s.len()).unwrap_or(0)
}
fn strip(m: &mut Msg) {
    if let Value::Object(o) = &mut m.data {
        o.remove("src");
        o.insert("ref".into(), Value::Bool(true));
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Blocked {
    #[serde(default)]
    pub nick: String,
    #[serde(default)]
    pub ts: u64,
}

/// JSON с отсортированными ключами — одинаковые байты на любой сборке serde_json.
pub fn canon(v: &Value, out: &mut String) {
    match v {
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k).unwrap_or_default());
                out.push(':');
                canon(&m[*k], out);
            }
            out.push('}');
        }
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canon(x, out);
            }
            out.push(']');
        }
        _ => out.push_str(&serde_json::to_string(v).unwrap_or_default()),
    }
}

impl Msg {
    pub fn signing_bytes(&self) -> Vec<u8> {
        let v = serde_json::json!([
            "hunty-msg-v1", self.id, self.room, self.from, self.ts, self.kind, self.text, self.data, self.reply
        ]);
        let mut s = String::new();
        canon(&v, &mut s);
        s.into_bytes()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct PeerCache {
    #[serde(default)]
    pub addrs: Vec<String>,
    #[serde(default)]
    pub seen: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Config {
    #[serde(default)]
    pub port: u16,
    #[serde(default = "yes")]
    pub mdns: bool,
    #[serde(default = "yes")]
    pub dht: bool,
    #[serde(default = "yes")]
    pub upnp: bool,
    #[serde(default = "yes")]
    pub relay_server: bool,
    #[serde(default = "default_ice")]
    pub ice: Value,
    /// можно ли найти меня по нику через DHT
    #[serde(default = "yes")]
    pub findable: bool,
}
fn yes() -> bool {
    true
}
fn default_ice() -> Value {
    serde_json::json!([{ "urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }])
}
impl Default for Config {
    fn default() -> Self {
        Config { port: 0, mdns: true, dht: true, upnp: true, relay_server: true, ice: default_ice(), findable: true }
    }
}

pub struct Store {
    pub dir: PathBuf,
    pub profile: Option<Profile>,
    pub friends: BTreeMap<String, Friend>,
    pub rooms: BTreeMap<String, Room>,
    pub peers: BTreeMap<String, PeerCache>,
    pub config: Config,
    pub blocked: BTreeMap<String, Blocked>,
    msgs: HashMap<String, Vec<Msg>>,
    /// все виденные id → ts (и удалённые тоже — чтобы не принять их снова)
    ids: HashMap<String, HashMap<String, u64>>,
    /// хата → id сообщения → реакции/правки/удаления к нему
    metas: HashMap<String, HashMap<String, Vec<Msg>>>,
    /// «удалить у себя»: хата → id → ts
    hidden: HashMap<String, HashMap<String, u64>>,
    /// файлы, которые надо переписать без удалённого (освободить место)
    dirty: HashSet<String>,
}

fn load<T: DeserializeOwned + Default>(p: &Path) -> T {
    match fs::read(p) {
        Ok(b) => match serde_json::from_slice(&b) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("битый файл {}: {e}, откладываю в .bad", p.display());
                let _ = fs::rename(p, p.with_extension("bad"));
                T::default()
            }
        },
        Err(_) => T::default(),
    }
}

pub fn write_atomic(p: &Path, data: &[u8]) -> Result<()> {
    let tmp = p.with_extension("tmp");
    fs::write(&tmp, data).with_context(|| format!("запись {}", tmp.display()))?;
    fs::rename(&tmp, p)?;
    Ok(())
}

fn safe_name(id: &str) -> String {
    id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect()
}

fn read_from(f: &mut fs::File, off: u64, len: u32) -> Option<Vec<u8>> {
    f.seek(SeekFrom::Start(off)).ok()?;
    let mut b = vec![0u8; len as usize];
    f.read_exact(&mut b).ok()?;
    Some(b)
}

fn file_len(p: &Path) -> u64 {
    fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

impl Store {
    pub fn open(dir: &Path) -> Result<Store> {
        fs::create_dir_all(dir.join("msgs"))?;
        let profile: Option<Profile> = load(&dir.join("profile.json"));
        let mut s = Store {
            dir: dir.to_path_buf(),
            profile,
            friends: load(&dir.join("friends.json")),
            rooms: load(&dir.join("rooms.json")),
            peers: load(&dir.join("peers.json")),
            config: if dir.join("config.json").exists() { load(&dir.join("config.json")) } else { Config::default() },
            blocked: load(&dir.join("blocked.json")),
            msgs: HashMap::new(),
            ids: HashMap::new(),
            metas: HashMap::new(),
            hidden: HashMap::new(),
            dirty: HashSet::new(),
        };
        let mut files = vec![];
        if let Ok(rd) = fs::read_dir(dir.join("msgs")) {
            for e in rd.flatten() {
                let p = e.path();
                match p.extension().and_then(|x| x.to_str()) {
                    Some("jsonl") => files.push(p),
                    Some("hide") => s.load_hidden(&p),
                    _ => {}
                }
            }
        }
        for p in files {
            s.load_jsonl(&p);
        }
        // удаления, которые пришли раньше, чем я успел переписать файл
        let rooms: Vec<String> = s.metas.keys().cloned().collect();
        for room in rooms {
            let dels: Vec<(String, String)> = s.metas[&room]
                .iter()
                .flat_map(|(t, v)| v.iter().filter(|m| m.kind == "del").map(move |m| (t.clone(), m.from.clone())))
                .collect();
            for (t, by) in dels {
                s.apply_del(&room, &t, &by);
            }
        }
        Ok(s)
    }

    fn load_hidden(&mut self, p: &Path) {
        let Ok(txt) = fs::read_to_string(p) else { return };
        let Some(stem) = p.file_stem().and_then(|x| x.to_str()) else { return };
        // имя файла = safe_name(хаты); хаты у меня из [a-z0-9-], так что оно и есть id
        let h = self.hidden.entry(stem.to_string()).or_default();
        for line in txt.lines() {
            if let Some((ts, id)) = line.trim().split_once(' ') {
                h.insert(id.to_string(), ts.parse().unwrap_or(0));
            }
        }
    }

    fn load_jsonl(&mut self, p: &Path) {
        let Ok(f) = fs::File::open(p) else { return };
        let stem = p.file_stem().and_then(|x| x.to_str()).unwrap_or("").to_string();
        let mut r = BufReader::with_capacity(1 << 16, f);
        let mut buf = Vec::new();
        let mut off = 0u64;
        loop {
            buf.clear();
            let n = match r.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            let at = off;
            off += n as u64;
            let mut line: &[u8] = &buf;
            while let Some((&c, rest)) = line.split_last() {
                if c == b'\n' || c == b'\r' {
                    line = rest;
                } else {
                    break;
                }
            }
            if line.is_empty() {
                continue;
            }
            let Ok(mut m) = serde_json::from_slice::<Msg>(line) else { continue };
            if safe_name(&m.room) != stem {
                continue;
            }
            if self.is_hidden(&m.room, &m.id) || self.rooms.get(&m.room).map(|r| m.ts <= r.clear_ts).unwrap_or(false) {
                self.dirty.insert(m.room.clone());
                continue;
            }
            if heavy_len(&m) > HEAVY {
                strip(&mut m);
                m.at = Some((at, line.len() as u32));
            }
            let room = m.room.clone();
            if !self.insert_mem(m) {
                self.dirty.insert(room);
            }
        }
    }

    fn json<T: Serialize>(&self, name: &str, v: &T) {
        let p = self.dir.join(name);
        match serde_json::to_vec_pretty(v) {
            Ok(b) => {
                if let Err(e) = write_atomic(&p, &b) {
                    tracing::error!("не смог сохранить {name}: {e}");
                }
            }
            Err(e) => tracing::error!("serde {name}: {e}"),
        }
    }
    pub fn save_profile(&self) {
        self.json("profile.json", &self.profile)
    }
    pub fn save_friends(&self) {
        self.json("friends.json", &self.friends)
    }
    pub fn save_rooms(&self) {
        self.json("rooms.json", &self.rooms)
    }
    pub fn save_peers(&self) {
        self.json("peers.json", &self.peers)
    }
    pub fn save_config(&self) {
        self.json("config.json", &self.config)
    }
    pub fn save_blocked(&self) {
        self.json("blocked.json", &self.blocked)
    }

    fn path(&self, room: &str) -> PathBuf {
        self.dir.join("msgs").join(format!("{}.jsonl", safe_name(room)))
    }
    fn hide_path(&self, room: &str) -> PathBuf {
        self.dir.join("msgs").join(format!("{}.hide", safe_name(room)))
    }

    fn insert_mem(&mut self, m: Msg) -> bool {
        let ids = self.ids.entry(m.room.clone()).or_default();
        if ids.contains_key(&m.id) {
            return false;
        }
        ids.insert(m.id.clone(), m.ts);
        if is_meta(&m.kind) {
            if let Some(t) = target(&m) {
                self.metas.entry(m.room.clone()).or_default().entry(t.to_string()).or_default().push(m.clone());
            }
        }
        let v = self.msgs.entry(m.room.clone()).or_default();
        let pos = v.partition_point(|x| (x.ts, &x.id) <= (m.ts, &m.id));
        v.insert(pos, m);
        true
    }

    /// Дописать строку в JSONL; вернуть смещение, с которого она легла.
    fn append(&self, room: &str, line: &str) -> Option<u64> {
        let p = self.path(room);
        let mut f = match fs::OpenOptions::new().create(true).read(true).append(true).open(&p) {
            Ok(f) => f,
            Err(e) => {
                tracing::error!("не смог дописать {}: {e}", p.display());
                return None;
            }
        };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        let mut b = Vec::with_capacity(line.len() + 2);
        // хвост от оборванной записи (выключили свет) — начинаю с новой строки
        let broken = len > 0 && read_from(&mut f, len - 1, 1).map(|x| x[0] != b'\n').unwrap_or(false);
        if broken {
            b.push(b'\n');
        }
        b.extend_from_slice(line.as_bytes());
        b.push(b'\n');
        match f.write_all(&b) {
            Ok(_) => Some(len + broken as u64),
            Err(e) => {
                tracing::error!("не смог дописать {}: {e}", p.display());
                None
            }
        }
    }

    fn is_hidden(&self, room: &str, id: &str) -> bool {
        self.hidden.get(room).map(|h| h.contains_key(id)).unwrap_or(false)
    }

    fn idx(&self, room: &str, id: &str) -> Option<usize> {
        let ts = *self.ids.get(room)?.get(id)?;
        let v = self.msgs.get(room)?;
        let i = v.partition_point(|x| (x.ts, x.id.as_str()) < (ts, id));
        (i < v.len() && v[i].id == id).then_some(i)
    }

    pub fn get(&self, room: &str, id: &str) -> Option<&Msg> {
        let i = self.idx(room, id)?;
        self.msgs.get(room).map(|v| &v[i])
    }

    fn del_ok(&self, room: &str, by: &str, author: &str) -> bool {
        by == author || self.rooms.get(room).map(|r| r.kind == "group" && r.is_admin(by)).unwrap_or(false)
    }

    /// Сообщение удалено «у всех» (удаление могло прийти раньше самого сообщения).
    fn killed(&self, room: &str, m: &Msg) -> bool {
        self.metas
            .get(room)
            .and_then(|x| x.get(&m.id))
            .map(|v| v.iter().any(|d| d.kind == "del" && self.del_ok(room, &d.from, &m.from)))
            .unwrap_or(false)
    }

    fn apply_del(&mut self, room: &str, t: &str, by: &str) -> bool {
        let Some(i) = self.idx(room, t) else { return false };
        let (author, meta) = {
            let m = &self.msgs[room][i];
            (m.from.clone(), is_meta(&m.kind))
        };
        if meta || !self.del_ok(room, by, &author) {
            return false;
        }
        if let Some(v) = self.msgs.get_mut(room) {
            v.remove(i);
        }
        self.dirty.insert(room.to_string());
        true
    }

    /// true — новое сообщение (записано на диск). В памяти остаётся лёгкая копия.
    pub fn add_msg(&mut self, m: Msg) -> bool {
        let room = m.room.clone();
        if self.rooms.get(&room).map(|r| m.ts <= r.clear_ts).unwrap_or(false) {
            return false;
        }
        if self.has_msg(&room, &m.id) || self.is_hidden(&room, &m.id) {
            return false;
        }
        if !is_meta(&m.kind) && self.killed(&room, &m) {
            self.ids.entry(room).or_default().insert(m.id.clone(), m.ts);
            return false;
        }
        let line = match serde_json::to_string(&m) {
            Ok(l) => l,
            Err(_) => return false,
        };
        let off = self.append(&room, &line);
        let mut m = m;
        if heavy_len(&m) > HEAVY {
            if let Some(o) = off {
                strip(&mut m);
                m.at = Some((o, line.len() as u32));
            }
        }
        let del = (m.kind == "del").then(|| (target(&m).unwrap_or("").to_string(), m.from.clone()));
        if !self.insert_mem(m) {
            return false;
        }
        if let Some((t, by)) = del {
            self.apply_del(&room, &t, &by);
        }
        true
    }

    pub fn has_msg(&self, room: &str, id: &str) -> bool {
        self.ids.get(room).map(|s| s.contains_key(id)).unwrap_or(false)
    }

    /// Все сообщения хаты (вместе со служебными), лёгкие копии.
    pub fn msgs(&self, room: &str) -> &[Msg] {
        self.msgs.get(room).map(|v| v.as_slice()).unwrap_or(&[])
    }

    /// Полная копия (с вложением) — для отправки пирам.
    pub fn full(&self, m: &Msg) -> Option<Msg> {
        let Some((off, len)) = m.at else { return Some(m.clone()) };
        let mut f = fs::File::open(self.path(&m.room)).ok()?;
        let b = read_from(&mut f, off, len)?;
        let x: Msg = serde_json::from_slice(&b).ok()?;
        (x.id == m.id).then_some(x)
    }

    /// Вложение сообщения: (mime, имя, base64).
    pub fn media(&self, room: &str, id: &str) -> Option<(String, String, String)> {
        let m = self.full(self.get(room, id)?)?;
        let src = m.data.get("src")?.as_str()?;
        let (head, b64) = src.strip_prefix("data:")?.split_once(',')?;
        let mime = head.strip_suffix(";base64")?;
        let name = m.data.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let mime = if mime.is_empty() { "application/octet-stream" } else { mime };
        Some((mime.to_string(), name, b64.to_string()))
    }

    pub fn last_ts(&self, room: &str) -> u64 {
        self.msgs(room).last().map(|m| m.ts).unwrap_or(0)
    }

    /// id, которые у меня уже есть (или удалены/скрыты) начиная с since — чтобы пир их не слал.
    pub fn have_since(&self, room: &str, since: u64) -> Vec<String> {
        let mut out: Vec<String> = self.ids.get(room).map(|m| m.iter().filter(|(_, t)| **t >= since).map(|(k, _)| k.clone()).collect()).unwrap_or_default();
        if let Some(h) = self.hidden.get(room) {
            for (k, t) in h {
                if *t >= since && !self.has_msg(room, k) {
                    out.push(k.clone());
                }
            }
        }
        out
    }

    fn edited(&self, m: &Msg) -> Option<&Msg> {
        let ms = self.metas.get(&m.room)?.get(&m.id)?;
        // с v0.3 править можно 30 секунд после отправки: поздние правки (часы те же — автора) не применяем
        // в «Избранном» (только моё) править можно сколько угодно
        let mine = self.rooms.get(&m.room).map(|r| r.kind == "self").unwrap_or(false);
        let late = |x: &Msg| !mine && m.ts >= EDIT_RULE_SINCE && x.ts > m.ts + EDIT_WINDOW_MS + 10_000;
        ms.iter().filter(|x| x.kind == "edit" && x.from == m.from && !late(x)).max_by(|a, b| (a.ts, &a.id).cmp(&(b.ts, &b.id)))
    }

    /// Стоит ли сейчас моя реакция e на сообщении.
    pub fn reacted(&self, room: &str, id: &str, me: &str, e: &str) -> bool {
        let Some(ms) = self.metas.get(room).and_then(|x| x.get(id)) else { return false };
        ms.iter()
            .filter(|x| x.kind == "react" && x.from == me && x.data.get("e").and_then(|y| y.as_str()) == Some(e))
            .max_by(|a, b| (a.ts, &a.id).cmp(&(b.ts, &b.id)))
            .map(|x| x.data.get("on").and_then(|y| y.as_bool()).unwrap_or(true))
            .unwrap_or(false)
    }

    /// Сообщение для UI: без подписи и вложения, с применёнными правками, реакциями и цитатой.
    pub fn view(&self, m: &Msg) -> Value {
        let mut v = serde_json::to_value(m).unwrap_or(Value::Null);
        let Value::Object(o) = &mut v else { return v };
        o.remove("sig");
        if let Some(e) = self.edited(m) {
            o.insert("text".into(), json!(e.text));
            o.insert("edited".into(), json!(e.ts));
        }
        if let Some(ms) = self.metas.get(&m.room).and_then(|x| x.get(&m.id)) {
            // (эмодзи, кто) → (ts, вкл)
            let mut rs: BTreeMap<(String, String), (u64, bool)> = BTreeMap::new();
            for x in ms.iter().filter(|x| x.kind == "react") {
                let e = x.data.get("e").and_then(|y| y.as_str()).unwrap_or("");
                if e.is_empty() || e.len() > 32 {
                    continue;
                }
                let on = x.data.get("on").and_then(|y| y.as_bool()).unwrap_or(true);
                let k = (e.to_string(), x.from.clone());
                if rs.get(&k).map(|(t, _)| x.ts >= *t).unwrap_or(true) {
                    rs.insert(k, (x.ts, on));
                }
            }
            let mut out: Vec<(String, u64, Vec<String>)> = vec![];
            for ((e, from), (ts, on)) in rs {
                if !on {
                    continue;
                }
                match out.iter_mut().find(|x| x.0 == e) {
                    Some(x) => {
                        x.1 = x.1.min(ts);
                        x.2.push(from);
                    }
                    None => out.push((e, ts, vec![from])),
                }
            }
            out.sort_by_key(|x| x.1);
            if !out.is_empty() {
                o.insert("reacts".into(), Value::Array(out.into_iter().map(|(e, _, p)| json!({ "e": e, "p": p })).collect()));
            }
        }
        if !m.reply.is_empty() {
            let rp = match self.get(&m.room, &m.reply).filter(|t| !is_meta(&t.kind)) {
                Some(t) => {
                    let text = self.edited(t).map(|e| e.text.as_str()).unwrap_or(&t.text);
                    let name = t.data.get("name").and_then(|x| x.as_str()).unwrap_or("");
                    json!({ "id": t.id, "from": t.from, "kind": t.kind, "text": text.chars().take(140).collect::<String>(), "name": name })
                }
                None => json!({ "id": m.reply, "gone": true }),
            };
            o.insert("rp".into(), rp);
        }
        v
    }

    /// Зал славы: сообщения, которые наградили 🏆 (в личке хватит одного кубка, в группе — двух)
    /// или завалили реакциями, и награды недели. Считается из общей истории — у всех выходит одинаково.
    /// week — начало недели (мс), tz — смещение часового пояса в минутах (как getTimezoneOffset в JS).
    pub fn hall(&self, week: u64, tz: i64) -> Value {
        const CUP: &str = "\u{1F3C6}";
        let mut entries: Vec<(u64, Value)> = vec![];
        let (mut talk, mut stk, mut night, mut gave, mut got): (HashMap<&str, u64>, HashMap<&str, u64>, HashMap<&str, u64>, HashMap<&str, u64>, HashMap<&str, u64>) =
            Default::default();
        let mut meme: Option<(u64, u64, &Msg)> = None;
        for (rid, r) in &self.rooms {
            if r.pending || (r.kind != "dm" && r.kind != "group") {
                continue;
            }
            let dm = r.kind == "dm";
            let metas = self.metas.get(rid);
            for m in self.msgs(rid) {
                if m.kind == "react" {
                    if m.ts >= week && m.data.get("on").and_then(|y| y.as_bool()).unwrap_or(true) {
                        *gave.entry(m.from.as_str()).or_default() += 1;
                    }
                    continue;
                }
                if is_meta(&m.kind) || m.kind == "sys" {
                    continue;
                }
                if m.ts >= week {
                    *talk.entry(m.from.as_str()).or_default() += 1;
                    if m.kind == "sticker" {
                        *stk.entry(m.from.as_str()).or_default() += 1;
                    }
                    let h = ((m.ts / 60_000) as i64 - tz).rem_euclid(1440) / 60;
                    if h < 5 {
                        *night.entry(m.from.as_str()).or_default() += 1;
                    }
                }
                let Some(ms) = metas.and_then(|x| x.get(&m.id)) else { continue };
                // (эмодзи, кто) → (ts, вкл); свои реакции на своё не считаются
                let mut rs: BTreeMap<(&str, &str), (u64, bool)> = BTreeMap::new();
                for x in ms.iter().filter(|x| x.kind == "react" && x.from != m.from) {
                    let e = x.data.get("e").and_then(|y| y.as_str()).unwrap_or("");
                    if e.is_empty() || e.len() > 32 {
                        continue;
                    }
                    let on = x.data.get("on").and_then(|y| y.as_bool()).unwrap_or(true);
                    let k = (e, x.from.as_str());
                    if rs.get(&k).map(|(t, _)| x.ts >= *t).unwrap_or(true) {
                        rs.insert(k, (x.ts, on));
                    }
                }
                let live: Vec<(&str, &str, u64)> = rs.into_iter().filter(|(_, (_, on))| *on).map(|((e, p), (t, _))| (e, p, t)).collect();
                if live.is_empty() {
                    continue;
                }
                let total = live.len() as u64;
                if m.ts >= week {
                    *got.entry(m.from.as_str()).or_default() += total;
                    if total >= 2 && meme.map(|(n, t, _)| (total, m.ts) > (n, t)).unwrap_or(true) {
                        meme = Some((total, m.ts, m));
                    }
                }
                let mut cups: Vec<u64> = live.iter().filter(|x| x.0 == CUP).map(|x| x.2).collect();
                cups.sort_unstable();
                let people: BTreeSet<&str> = live.iter().map(|x| x.1).collect();
                let need = if dm { 1 } else { 2 };
                let (why, at) = if cups.len() >= need {
                    ("cup", cups[need - 1])
                } else if (dm && total >= 4) || (!dm && people.len() >= 3 && total >= 5) {
                    ("many", live.iter().map(|x| x.2).max().unwrap_or(m.ts))
                } else {
                    continue;
                };
                let mut v = self.view(m);
                if let Value::Object(o) = &mut v {
                    o.insert("why".into(), json!(why));
                    o.insert("at".into(), json!(at));
                    o.insert("cups".into(), json!(cups.len()));
                }
                entries.push((at, v));
            }
        }
        entries.sort_by(|a, b| b.0.cmp(&a.0));
        // победитель — у кого больше; при равенстве — меньший peer id (одинаково у всех)
        let top = |h: &HashMap<&str, u64>, min: u64| -> Option<(String, u64)> {
            h.iter().filter(|(_, n)| **n >= min).max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0))).map(|(p, n)| (p.to_string(), *n))
        };
        let mut awards = vec![];
        if let Some((n, _, m)) = meme {
            awards.push(json!({ "k": "meme", "peer": m.from, "n": n, "room": m.room, "id": m.id, "msg": self.view(m) }));
        }
        for (k, h, min) in [("talk", &talk, 10), ("stk", &stk, 3), ("night", &night, 3), ("gave", &gave, 5), ("star", &got, 5)] {
            if let Some((p, n)) = top(h, min) {
                awards.push(json!({ "k": k, "peer": p, "n": n }));
            }
        }
        json!({ "entries": entries.into_iter().take(300).map(|x| x.1).collect::<Vec<_>>(), "awards": awards, "week": week })
    }

    /// Страница видимых сообщений (служебные уже применены).
    pub fn page(&self, room: &str, before: Option<u64>, limit: usize) -> Vec<Value> {
        let v = self.msgs(room);
        let end = match before {
            Some(b) => v.partition_point(|m| m.ts < b),
            None => v.len(),
        };
        let mut out: Vec<&Msg> = v[..end].iter().rev().filter(|m| !is_meta(&m.kind)).take(limit).collect();
        out.reverse();
        out.into_iter().map(|m| self.view(m)).collect()
    }

    pub fn last_visible(&self, room: &str) -> Option<Value> {
        self.msgs(room).iter().rev().find(|m| !is_meta(&m.kind)).map(|m| self.view(m))
    }

    pub fn count(&self, room: &str) -> usize {
        self.msgs(room).iter().filter(|m| !is_meta(&m.kind)).count()
    }

    /// Поиск по переписке (без учёта регистра, ё = е), новые сверху: (сколько всего нашлось, первые limit).
    /// Ищу в тексте (с учётом правок) и в именах файлов; from — только сообщения этого автора.
    pub fn search(&self, room: &str, q: &str, from: &str, limit: usize) -> (usize, Vec<Value>) {
        let norm = |x: &str| x.to_lowercase().replace('ё', "е");
        let q = norm(q.trim());
        let mut total = 0;
        let mut out = vec![];
        if q.is_empty() && from.is_empty() {
            return (0, out);
        }
        for m in self.msgs(room).iter().rev() {
            if is_meta(&m.kind) || m.kind == "sys" || (!from.is_empty() && m.from != from) {
                continue;
            }
            if !q.is_empty() {
                let text = self.edited(m).map(|e| e.text.as_str()).unwrap_or(&m.text);
                let name = m.data.get("name").and_then(|x| x.as_str()).unwrap_or("");
                if !norm(text).contains(&q) && !norm(name).contains(&q) {
                    continue;
                }
            }
            total += 1;
            if out.len() < limit {
                out.push(self.view(m));
            }
        }
        (total, out)
    }

    /// Картинки и видео чата, новые сверху — окно «Клипы и скрины».
    pub fn media_list(&self, room: &str, limit: usize) -> (usize, Vec<Value>) {
        let mut total = 0;
        let mut out = vec![];
        for m in self.msgs(room).iter().rev() {
            let mime = m.data.get("mime").and_then(|x| x.as_str()).unwrap_or("");
            let ok = m.kind == "image" || (m.kind == "file" && (mime.starts_with("video/") || mime.starts_with("image/")));
            if !ok {
                continue;
            }
            total += 1;
            if out.len() < limit {
                out.push(self.view(m));
            }
        }
        (total, out)
    }

    /// Сколько видимых сообщений новее ts (для прыжка к найденному: сколько догрузить).
    pub fn newer_than(&self, room: &str, ts: u64) -> usize {
        let v = self.msgs(room);
        let i = v.partition_point(|m| m.ts < ts);
        v[i..].iter().filter(|m| !is_meta(&m.kind)).count()
    }

    pub fn unread(&self, room: &str, me: &str) -> usize {
        let Some(r) = self.rooms.get(room) else { return 0 };
        let v = self.msgs(room);
        let start = v.partition_point(|m| m.ts <= r.read_ts);
        v[start..].iter().filter(|m| m.from != me && m.kind != "sys" && !is_meta(&m.kind)).count()
    }

    /// «Удалить у себя»: убрать из памяти и с диска, больше не принимать.
    pub fn hide(&mut self, room: &str, id: &str) -> bool {
        let Some(i) = self.idx(room, id) else { return false };
        let ts = self.msgs[room][i].ts;
        if let Some(v) = self.msgs.get_mut(room) {
            v.remove(i);
        }
        self.hidden.entry(room.to_string()).or_default().insert(id.to_string(), ts);
        let p = self.hide_path(room);
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&p) {
            let _ = writeln!(f, "{ts} {id}");
        }
        self.dirty.insert(room.to_string());
        true
    }

    /// Очистить историю хаты у себя (место на диске освобождается сразу).
    pub fn clear(&mut self, room: &str, ts: u64) -> u64 {
        let freed = file_len(&self.path(room));
        self.msgs.remove(room);
        self.ids.remove(room);
        self.metas.remove(room);
        self.hidden.remove(room);
        self.dirty.remove(room);
        let _ = fs::remove_file(self.path(room));
        let _ = fs::remove_file(self.hide_path(room));
        if let Some(r) = self.rooms.get_mut(room) {
            r.clear_ts = ts;
            r.read_ts = r.read_ts.max(ts);
        }
        self.save_rooms();
        freed
    }

    pub fn dirty(&self) -> Vec<String> {
        self.dirty.iter().cloned().collect()
    }

    /// Переписать JSONL без удалённого. Тяжёлые строки копирую с диска как есть.
    pub fn compact(&mut self, room: &str) {
        self.dirty.remove(room);
        let p = self.path(room);
        let tmp = self.dir.join("msgs").join(format!("{}.jsonl.tmp", safe_name(room)));
        let mut src = fs::File::open(&p).ok();
        let empty = vec![];
        let v = self.msgs.get(room).unwrap_or(&empty);
        let out = match fs::File::create(&tmp) {
            Ok(f) => f,
            Err(e) => {
                tracing::error!("не смог переписать {}: {e}", p.display());
                return;
            }
        };
        let mut out = BufWriter::new(out);
        let mut off = 0u64;
        let mut new_at: Vec<(usize, Option<(u64, u32)>)> = vec![];
        let mut ok = true;
        for (i, m) in v.iter().enumerate() {
            let line = match m.at {
                Some((o, l)) => match src.as_mut().and_then(|f| read_from(f, o, l)) {
                    Some(b) => b,
                    None => {
                        // строка пропала (файл правили руками?) — оставляю лёгкую копию
                        new_at.push((i, None));
                        serde_json::to_vec(m).unwrap_or_default()
                    }
                },
                None => serde_json::to_vec(m).unwrap_or_default(),
            };
            if line.is_empty() {
                continue;
            }
            if out.write_all(&line).and_then(|_| out.write_all(b"\n")).is_err() {
                ok = false;
                break;
            }
            if m.at.is_some() && !new_at.last().map(|x| x.0 == i).unwrap_or(false) {
                new_at.push((i, Some((off, line.len() as u32))));
            }
            off += line.len() as u64 + 1;
        }
        let ok = ok && out.flush().is_ok();
        drop(out);
        drop(src);
        if !ok || fs::rename(&tmp, &p).is_err() {
            tracing::error!("не смог переписать {}", p.display());
            let _ = fs::remove_file(&tmp);
            self.dirty.insert(room.to_string());
            return;
        }
        if let Some(v) = self.msgs.get_mut(room) {
            for (i, a) in new_at {
                v[i].at = a;
            }
        }
    }

    /// Сколько места занимает каждая хата.
    pub fn storage(&self) -> Value {
        let mut rooms = vec![];
        let mut total = 0u64;
        for id in self.rooms.keys() {
            let bytes = file_len(&self.path(id)) + file_len(&self.hide_path(id));
            total += bytes;
            let v = self.msgs(id);
            let media: Vec<u64> = v.iter().filter_map(|m| m.at.map(|a| a.1 as u64)).collect();
            rooms.push(json!({
                "room": id, "bytes": bytes, "msgs": v.iter().filter(|m| !is_meta(&m.kind)).count(),
                "media": media.len(), "media_bytes": media.iter().sum::<u64>(),
            }));
        }
        let log = file_len(&self.dir.join("hunty.log"));
        json!({ "rooms": rooms, "total": total + log, "log": log, "dir": self.dir.to_string_lossy() })
    }

    pub fn drop_room(&mut self, room: &str) {
        self.msgs.remove(room);
        self.ids.remove(room);
        self.metas.remove(room);
        self.hidden.remove(room);
        self.dirty.remove(room);
        let _ = fs::remove_file(self.path(room));
        let _ = fs::remove_file(self.hide_path(room));
        self.rooms.remove(room);
        self.save_rooms();
    }
}
