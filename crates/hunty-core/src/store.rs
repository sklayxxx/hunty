//! Хранилище: JSON-файлы + JSONL с сообщениями в папке данных.
use anyhow::{Context, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::Write;
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
    msgs: HashMap<String, Vec<Msg>>,
    ids: HashMap<String, HashSet<String>>,
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
            msgs: HashMap::new(),
            ids: HashMap::new(),
        };
        if let Ok(rd) = fs::read_dir(dir.join("msgs")) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) != Some("jsonl") {
                    continue;
                }
                let Ok(txt) = fs::read_to_string(&p) else { continue };
                for line in txt.lines() {
                    if let Ok(m) = serde_json::from_str::<Msg>(line) {
                        s.insert_mem(m);
                    }
                }
            }
        }
        Ok(s)
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

    fn insert_mem(&mut self, m: Msg) -> bool {
        let ids = self.ids.entry(m.room.clone()).or_default();
        if !ids.insert(m.id.clone()) {
            return false;
        }
        let v = self.msgs.entry(m.room.clone()).or_default();
        let pos = v.partition_point(|x| (x.ts, &x.id) <= (m.ts, &m.id));
        v.insert(pos, m);
        true
    }

    /// true — новое сообщение (записано на диск).
    pub fn add_msg(&mut self, m: Msg) -> bool {
        let line = match serde_json::to_string(&m) {
            Ok(l) => l,
            Err(_) => return false,
        };
        let room = m.room.clone();
        if !self.insert_mem(m) {
            return false;
        }
        let p = self.dir.join("msgs").join(format!("{}.jsonl", safe_name(&room)));
        match fs::OpenOptions::new().create(true).append(true).open(&p) {
            Ok(mut f) => {
                let _ = writeln!(f, "{line}");
            }
            Err(e) => tracing::error!("не смог дописать {}: {e}", p.display()),
        }
        true
    }

    pub fn has_msg(&self, room: &str, id: &str) -> bool {
        self.ids.get(room).map(|s| s.contains(id)).unwrap_or(false)
    }

    pub fn msgs(&self, room: &str) -> &[Msg] {
        self.msgs.get(room).map(|v| v.as_slice()).unwrap_or(&[])
    }

    pub fn last_ts(&self, room: &str) -> u64 {
        self.msgs(room).last().map(|m| m.ts).unwrap_or(0)
    }

    pub fn page(&self, room: &str, before: Option<u64>, limit: usize) -> Vec<Msg> {
        let v = self.msgs(room);
        let end = match before {
            Some(b) => v.partition_point(|m| m.ts < b),
            None => v.len(),
        };
        let start = end.saturating_sub(limit);
        v[start..end].to_vec()
    }

    pub fn unread(&self, room: &str, me: &str) -> usize {
        let Some(r) = self.rooms.get(room) else { return 0 };
        let v = self.msgs(room);
        let start = v.partition_point(|m| m.ts <= r.read_ts);
        v[start..].iter().filter(|m| m.from != me && m.kind != "sys").count()
    }

    pub fn drop_room(&mut self, room: &str) {
        self.msgs.remove(room);
        self.ids.remove(room);
        let _ = fs::remove_file(self.dir.join("msgs").join(format!("{}.jsonl", safe_name(room))));
        self.rooms.remove(room);
        self.save_rooms();
    }
}
