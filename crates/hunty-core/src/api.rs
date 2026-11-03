//! Команды от UI: {cmd:"…", …} → JSON-ответ.
use crate::codes::{self, FriendCode, JoinCode};
use crate::node::{Lookup, Node, Pend};
use crate::proto::*;
use crate::store::*;
use crate::util::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use libp2p::{Multiaddr, PeerId};
use serde_json::{json, Value};

type R = Result<Value, String>;

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}
fn b(v: &Value, k: &str) -> Option<bool> {
    v.get(k).and_then(|x| x.as_bool())
}

impl Node {
    pub(crate) fn friend_json(&self, peer: &str) -> Value {
        let Some(f) = self.st.friends.get(peer) else { return Value::Null };
        let pid: Option<PeerId> = peer.parse().ok();
        let o = pid.as_ref().and_then(|p| self.online.get(p));
        json!({
            "peer": f.peer,
            "profile": f.profile,
            "state": f.state,
            "since": f.since,
            "dm": f.dm,
            "online": o.is_some(),
            "rtt": o.and_then(|o| o.rtt),
            "via": pid.map(|p| self.via(&p)).unwrap_or("off"),
        })
    }

    pub(crate) fn room_json(&self, id: &str) -> Value {
        let Some(r) = self.st.rooms.get(id) else { return Value::Null };
        let members: Vec<Value> = r
            .live_members()
            .map(|m| {
                let me = m.peer == self.me_s;
                let pid: Option<PeerId> = m.peer.parse().ok();
                let prof = if me {
                    Some(self.profile())
                } else {
                    self.st.friends.get(&m.peer).map(|f| f.profile.clone())
                };
                let (nick, ava) = match &prof {
                    Some(p) if !p.nick.is_empty() => (p.nick.clone(), p.ava.clone()),
                    _ => (m.nick.clone(), m.ava.clone()),
                };
                json!({
                    "peer": m.peer, "nick": nick, "ava": ava, "role": if r.owner == m.peer { "owner" } else { m.role.as_str() },
                    "me": me, "online": me || pid.map(|p| self.online.contains_key(&p)).unwrap_or(false),
                    "friend": self.is_friend(&m.peer),
                })
            })
            .collect();
        json!({
            "id": r.id, "kind": r.kind, "name": r.name, "color": r.color, "pic": r.pic, "owner": r.owner,
            "invite": r.invite, "voice": r.voice, "muted": r.muted, "pending": r.pending,
            "created": r.created, "members": members, "unread": self.st.unread(id, &self.me_s),
            "last": self.st.last_visible(id), "read_ts": r.read_ts, "admin": r.is_admin(&self.me_s),
            "count": self.st.count(id), "clear_ts": r.clear_ts,
        })
    }

    fn me_json(&self) -> Value {
        json!({ "peer": self.me_s, "profile": self.st.profile, "onboarded": self.st.profile.is_some() })
    }

    pub(crate) fn state_json(&self) -> Value {
        let friends: Vec<Value> = self.st.friends.keys().map(|k| self.friend_json(k)).collect();
        let rooms: Vec<Value> = self.st.rooms.keys().map(|k| self.room_json(k)).collect();
        let online: serde_json::Map<String, Value> = self
            .online
            .iter()
            .map(|(p, o)| (p.to_string(), json!({ "rtt": o.rtt, "via": self.via(p) })))
            .collect();
        let nearby: Vec<Value> = self.nearby.iter().map(|(p, pr)| json!({ "peer": p, "profile": pr })).collect();
        json!({
            "version": crate::node::VERSION,
            "me": self.me_json(),
            "friends": friends,
            "rooms": rooms,
            "online": online,
            "voice": { "mine": self.voice, "rooms": self.voices },
            "nearby": nearby,
            "ice": self.st.config.ice,
            "config": self.st.config,
            "net": self.net_json(),
            "blocked": self.blocked_json(),
        })
    }

    pub(crate) fn blocked_json(&self) -> Value {
        json!(self.st.blocked.iter().map(|(p, b)| json!({ "peer": p, "nick": b.nick, "ts": b.ts })).collect::<Vec<_>>())
    }

    pub(crate) fn sign(&self, mut m: Msg) -> Msg {
        m.sig = match self.key.sign(&m.signing_bytes()) {
            Ok(sig) => B64.encode(sig),
            Err(_) => String::new(),
        };
        m
    }

    pub(crate) fn post(&mut self, room: &str, kind: &str, text: &str, data: Value, reply: &str) -> Result<Msg, String> {
        if !self.member_ok(room, &self.me_s.clone()) {
            return Err("ты не в этом чате".into());
        }
        let last = self.st.last_ts(room);
        let ts = now_ms().max(last + 1);
        let m = self.sign(Msg {
            id: rand_hex(10),
            room: room.to_string(),
            from: self.me_s.clone(),
            ts,
            kind: kind.to_string(),
            text: text.to_string(),
            data,
            reply: reply.to_string(),
            sig: String::new(),
            at: None,
        });
        self.st.add_msg(m.clone());
        if let Some(r) = self.st.rooms.get_mut(room) {
            r.read_ts = r.read_ts.max(ts);
        }
        self.bcast(room, Req::Msg { msg: m.clone() });
        Ok(m)
    }

    pub(crate) fn post_sys(&mut self, room: &str, what: &str) -> Result<Msg, String> {
        let m = self.post(room, "sys", what, Value::Null, "")?;
        let v = self.st.view(&m);
        self.emit("msg", json!({ "room": room, "msg": v, "unread": 0 }));
        Ok(m)
    }

    fn reacted(&self, room: &str, id: &str, e: &str) -> bool {
        self.st.reacted(room, id, &self.me_s, e)
    }

    /// Своё сообщение для UI (лёгкая копия, с цитатой).
    fn my_view(&self, m: &Msg) -> Value {
        self.st.get(&m.room, &m.id).map(|x| self.st.view(x)).unwrap_or_else(|| self.st.view(m))
    }

    /// Реакция / правка / удаление у всех — обычное подписанное сообщение со ссылкой на цель.
    fn post_meta(&mut self, room: &str, kind: &str, text: &str, data: Value) -> R {
        let m = self.post(room, kind, text, data, "")?;
        self.tell_ui(room, std::slice::from_ref(&m), true);
        Ok(json!({ "ok": true, "id": m.id }))
    }

    fn set_profile(&mut self, v: &Value) -> R {
        let mut p = self.st.profile.clone().unwrap_or_default();
        if let Some(n) = v.get("nick").and_then(|x| x.as_str()) {
            let n = clean_nick(n).ok_or("ник: 2–16 символов, латиница, цифры, точка, _ или -")?;
            if n != p.nick {
                let busy = self.nick_known(&n).is_some()
                    || self.checks.get(&n).map(|c| matches!(c.done.as_deref(), Some("taken") | Some("maybe"))).unwrap_or(false);
                if busy {
                    return Err(format!("ник @{n} уже занят — выбери другой"));
                }
            }
            p.nick = n;
        }
        if let Some(a) = v.get("ava").and_then(|x| x.as_str()) {
            if a.len() > 96 * 1024 {
                return Err("аватарка слишком большая (до 96 КБ)".into());
            }
            p.ava = a.to_string();
        }
        if let Some(l) = v.get("line").and_then(|x| x.as_str()) {
            p.line = l.chars().take(64).collect();
        }
        if let Some(st) = v.get("status").and_then(|x| x.as_str()) {
            p.status = st.chars().take(16).collect();
        }
        if let Some(c) = v.get("color").and_then(|x| x.as_str()) {
            p.color = c.chars().take(32).collect();
        }
        if let Some(x) = v.get("bio").and_then(|x| x.as_str()) {
            p.bio = x.trim().chars().take(190).collect();
        }
        if let Some(x) = v.get("banner").and_then(|x| x.as_str()) {
            if x.len() > 200 * 1024 {
                return Err("картинка шапки слишком большая (до 200 КБ)".into());
            }
            if !(x.is_empty() || x.starts_with("g:") || x.starts_with("data:image/")) {
                return Err("шапка: градиент или картинка".into());
            }
            p.banner = x.to_string();
        }
        if let Some(x) = v.get("game").and_then(|x| x.as_str()) {
            p.game = x.trim().chars().take(48).collect();
        }
        if p.nick.is_empty() {
            return Err("нужен ник".into());
        }
        p.ts = now_ms();
        self.st.profile = Some(p.clone());
        self.st.save_profile();
        // обновляю себя в хатах
        let me = self.me_s.clone();
        for r in self.st.rooms.values_mut() {
            if let Some(m) = r.members.get_mut(&me) {
                m.nick = p.nick.clone();
                m.ava = p.ava.clone();
            }
        }
        self.st.save_rooms();
        let peers: Vec<PeerId> = self.online.keys().cloned().collect();
        for x in peers {
            self.send(x, Req::Profile { profile: p.clone() }, Pend::Other);
        }
        self.emit("me", json!({ "me": self.me_json() }));
        Ok(self.me_json())
    }

    pub(crate) fn on_cmd(&mut self, v: Value) -> R {
        let c = s(&v, "cmd");
        if self.st.profile.is_none() && !matches!(c.as_str(), "state" | "onboard" | "net" | "backup_import" | "config_set" | "ping" | "nick_check" | "log_ui") {
            return Err("сначала регистрация".into());
        }
        match c.as_str() {
            "ping" => Ok(json!("pong")),
            "state" => Ok(self.state_json()),
            "net" => Ok(self.net_json()),
            "onboard" | "profile_set" => {
                let first = self.st.profile.is_none();
                let old_nick = self.st.profile.as_ref().map(|p| p.nick.clone()).unwrap_or_default();
                let r = self.set_profile(&v)?;
                if self.st.profile.as_ref().map(|p| p.nick != old_nick).unwrap_or(false) {
                    self.last_provide = None; // новый ник — переопубликую в DHT
                }
                if first {
                    self.log("ok", "ключ ed25519 создан · ты в сети, серверов: 0");
                    // сразу пытаюсь подключиться к уже знакомым (после импорта бэкапа)
                    for p in self.wanted() {
                        self.dial(p, &[]);
                    }
                }
                Ok(r)
            }
            "friend_code" => {
                let code = codes::friend_encode(&FriendCode { p: self.me_s.clone(), n: self.profile().nick, a: self.my_addrs() });
                Ok(json!({ "code": code, "peer": self.me_s }))
            }
            "friend_add" => {
                let fc = codes::friend_decode(&s(&v, "code")).ok_or("не похоже на код друга — нужен hunty://add/…")?;
                if fc.p == self.me_s {
                    return Err("это твой собственный код :)".into());
                }
                let pid: PeerId = fc.p.parse().map_err(|_| "битый код")?;
                let state = self.st.friends.get(&fc.p).map(|f| f.state.clone());
                match state {
                    Some(FriendState::Friend) => return Ok(json!({ "already": true, "friend": self.friend_json(&fc.p) })),
                    Some(FriendState::Incoming) => {
                        return self.on_cmd(json!({ "cmd": "friend_accept", "peer": fc.p }));
                    }
                    _ => {}
                }
                let nick = clean_nick(&fc.n).unwrap_or_default();
                let e = self.st.friends.entry(fc.p.clone()).or_insert(Friend {
                    peer: fc.p.clone(),
                    profile: Profile { nick, ..Default::default() },
                    state: FriendState::Outgoing,
                    since: now_ms(),
                    dm: String::new(),
                    hint: vec![],
                    want: 0,
                });
                e.hint = fc.a.clone();
                e.since = now_ms(); // нажал «добавить» ещё раз — это новая заявка (свежее прошлого отказа)
                self.st.save_friends();
                // сам зовёшь в друзья того, кого блокнул, — значит, блок больше не нужен
                if self.st.blocked.remove(&fc.p).is_some() {
                    self.st.save_blocked();
                    let bl = self.blocked_json();
                    self.emit("blocked", json!({ "blocked": bl }));
                }
                let addrs: Vec<Multiaddr> = fc.a.iter().filter_map(|a| a.parse().ok()).collect();
                if self.connected(&pid) {
                    self.hello_inflight.remove(&pid);
                    self.send_hello(pid);
                } else {
                    self.dial(pid, &addrs);
                    self.lookup(Lookup::Peer(pid));
                }
                let f = self.friend_json(&fc.p);
                self.emit("friend", json!({ "friend": f }));
                Ok(json!({ "friend": f }))
            }
            "friend_accept" => {
                let p = s(&v, "peer");
                let Some(f) = self.st.friends.get_mut(&p) else { return Err("нет такой заявки".into()) };
                f.state = FriendState::Friend;
                f.since = now_ms();
                let nick = f.profile.nick.clone();
                self.st.save_friends();
                self.ensure_dm(&p);
                self.refresh_allow();
                if let Ok(pid) = p.parse::<PeerId>() {
                    if self.connected(&pid) {
                        self.hello_inflight.remove(&pid);
                        self.send_hello(pid);
                    } else {
                        self.dial(pid, &[]);
                    }
                }
                self.log("ok", format!("@{nick} в друзьях · ключи обменялись напрямую"));
                let fj = self.friend_json(&p);
                self.emit("friend", json!({ "friend": fj }));
                Ok(json!({ "friend": fj }))
            }
            "friend_decline" | "friend_remove" => {
                let p = s(&v, "peer");
                let Some(old) = self.st.friends.remove(&p) else {
                    return Err("нет такого друга".into());
                };
                // отказ — по времени его заявки (его же часы, без расхождений), удаление — с этой минуты
                self.declined.insert(p.clone(), if c == "friend_decline" && old.want > 0 { old.want } else { now_ms() });
                self.st.save_friends();
                self.refresh_allow();
                // и при удалении, и при отказе говорю ему — иначе его «хочу в друзья» в следующем hello вернёт заявку обратно
                if let Ok(pid) = p.parse::<PeerId>() {
                    if self.connected(&pid) {
                        self.send(pid, Req::FriendRemove, Pend::Other);
                    }
                }
                self.emit("friend_removed", json!({ "peer": p }));
                Ok(json!({ "ok": true }))
            }
            "nick_find" => {
                let n = clean_nick(&s(&v, "nick")).ok_or("ник: 2–16 символов, латиница, цифры, точка, _ или -")?;
                if !self.dht_ready() {
                    return Err(if self.st.config.dht { "DHT ещё подключается — попробуй через полминуты" } else { "DHT выключен в настройках сети" }.into());
                }
                self.lookups.remove(&format!("n:{n}"));
                self.lookup(Lookup::Nick(n.clone()));
                // в локалке ищу сразу
                let lan: Vec<(String, Profile)> = self.nearby.iter().filter(|(_, p)| p.nick == n).map(|(a, b)| (a.clone(), b.clone())).collect();
                for (p, pr) in lan {
                    let fr = self.st.friends.get(&p).map(|f| f.state.clone());
                    self.emit("found", json!({ "nick": n, "peer": p, "profile": pr, "friend": fr }));
                }
                Ok(json!({ "nick": n, "searching": true }))
            }
            "nearby" => Ok(json!(self.nearby.iter().map(|(p, pr)| json!({ "peer": p, "profile": pr })).collect::<Vec<_>>())),
            "dm_open" => {
                let p = s(&v, "peer");
                if !self.is_friend(&p) {
                    return Err("личка — только с друзьями".into());
                }
                let id = self.ensure_dm(&p).ok_or("кривой peer")?;
                Ok(self.room_json(&id))
            }
            "self_open" => {
                // «Избранное», как Saved Messages в Telegram: чат только со мной — никому не уходит
                let tail: String = self.me_s.chars().rev().take(12).collect::<Vec<_>>().into_iter().rev().collect();
                let id = format!("s-{tail}");
                if !self.st.rooms.contains_key(&id) {
                    let now = now_ms();
                    let me = self.profile();
                    let mut members = std::collections::BTreeMap::new();
                    members.insert(self.me_s.clone(), Member { peer: self.me_s.clone(), nick: me.nick.clone(), ava: me.ava.clone(), role: "owner".into(), ts: now, gone: false });
                    self.st.rooms.insert(
                        id.clone(),
                        Room {
                            id: id.clone(),
                            kind: "self".into(),
                            name: "Избранное".into(),
                            color: String::new(),
                            pic: String::new(),
                            secret: String::new(),
                            owner: self.me_s.clone(),
                            members,
                            created: now,
                            invite: "none".into(),
                            voice: false,
                            meta_ts: now,
                            muted: false,
                            read_ts: now,
                            pending: false,
                            inviter: String::new(),
                            inviter_addrs: vec![],
                            clear_ts: 0,
                        },
                    );
                    self.st.save_rooms();
                    let r = self.room_json(&id);
                    self.emit("room", json!({ "room": r }));
                }
                Ok(self.room_json(&id))
            }
            "hall" => {
                let week = v.get("week").and_then(|x| x.as_u64()).unwrap_or(0);
                let tz = v.get("tz").and_then(|x| x.as_i64()).unwrap_or(0);
                Ok(self.st.hall(week, tz))
            }
            "room_create" => {
                let name: String = s(&v, "name").trim().chars().take(32).collect();
                if name.is_empty() {
                    return Err("назови группу".into());
                }
                let id = format!("g-{}", rand_hex(8));
                let now = now_ms();
                let me = self.profile();
                let mut members = std::collections::BTreeMap::new();
                members.insert(self.me_s.clone(), Member { peer: self.me_s.clone(), nick: me.nick.clone(), ava: me.ava.clone(), role: "owner".into(), ts: now, gone: false });
                let picks: Vec<String> = v.get("members").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                for p in &picks {
                    if let Some(f) = self.st.friends.get(p) {
                        if f.state == FriendState::Friend {
                            members.insert(p.clone(), Member { peer: p.clone(), nick: f.profile.nick.clone(), ava: f.profile.ava.clone(), role: "member".into(), ts: now, gone: false });
                        }
                    }
                }
                let invite = if s(&v, "invite") == "admin" { "admin" } else { "all" };
                self.st.rooms.insert(
                    id.clone(),
                    Room {
                        id: id.clone(),
                        kind: "group".into(),
                        name,
                        color: s(&v, "color"),
                        pic: room_pic(&v)?,
                        secret: rand_hex(16),
                        owner: self.me_s.clone(),
                        members,
                        created: now,
                        invite: invite.into(),
                        voice: b(&v, "voice").unwrap_or(true),
                        meta_ts: now,
                        muted: false,
                        read_ts: now,
                        pending: false,
                        inviter: String::new(),
                        inviter_addrs: vec![],
                        clear_ts: 0,
                    },
                );
                self.st.save_rooms();
                self.refresh_allow();
                let _ = self.post(&id, "sys", "create", Value::Null, "");
                let targets: Vec<PeerId> = picks.iter().filter_map(|p| p.parse().ok()).collect();
                for t in targets {
                    if self.online.contains_key(&t) {
                        self.push_room_to(t, &id);
                    }
                }
                self.last_provide = None;
                let r = self.room_json(&id);
                self.emit("room", json!({ "room": r }));
                Ok(r)
            }
            "room_add" => {
                // добавить друзей в существующую группу (без инвайт-ссылки)
                let id = s(&v, "room");
                let me = self.me_s.clone();
                let picks: Vec<String> = v.get("peers").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                let adds: Vec<(String, Profile)> = picks
                    .iter()
                    .filter_map(|p| self.st.friends.get(p).filter(|f| f.state == FriendState::Friend).map(|f| (p.clone(), f.profile.clone())))
                    .collect();
                let r = self.st.rooms.get_mut(&id).ok_or("нет такой группы")?;
                if r.kind != "group" || r.pending {
                    return Err("добавлять можно только в группу".into());
                }
                if r.invite == "admin" && !r.is_admin(&me) {
                    return Err("приглашать может только админ".into());
                }
                if adds.is_empty() {
                    return Err("добавлять можно только друзей".into());
                }
                let now = now_ms();
                let mut extra: Vec<PeerId> = vec![];
                for (p, pr) in adds {
                    let m = r.members.entry(p.clone()).or_insert(Member { peer: p.clone(), nick: pr.nick.clone(), ava: pr.ava.clone(), role: "member".into(), ts: now, gone: false });
                    m.gone = false;
                    m.ts = now;
                    if let Ok(pid) = p.parse() {
                        extra.push(pid);
                    }
                }
                self.st.save_rooms();
                self.refresh_allow();
                self.push_room_all(&id, &extra);
                let j = self.room_json(&id);
                self.emit("room", json!({ "room": j }));
                Ok(j)
            }
            "room_invite" => {
                let id = s(&v, "room");
                let r = self.st.rooms.get(&id).ok_or("нет такой группы")?;
                if r.kind != "group" || r.pending {
                    return Err("инвайт бывает только у группы".into());
                }
                if r.invite == "admin" && !r.is_admin(&self.me_s) {
                    return Err("приглашать может только админ".into());
                }
                let code = codes::join_encode(&JoinCode { r: id.clone(), s: r.secret.clone(), n: r.name.clone(), c: r.color.clone(), p: self.me_s.clone(), a: self.my_addrs() });
                Ok(json!({ "code": code }))
            }
            "room_join" => {
                let jc = codes::join_decode(&s(&v, "code")).ok_or("не похоже на инвайт — нужен hunty://join/…")?;
                if let Some(r) = self.st.rooms.get(&jc.r) {
                    if !r.pending {
                        return Ok(json!({ "already": true, "room": self.room_json(&jc.r) }));
                    }
                }
                let pid: PeerId = jc.p.parse().map_err(|_| "битый инвайт")?;
                self.st.rooms.insert(
                    jc.r.clone(),
                    Room {
                        id: jc.r.clone(),
                        kind: "group".into(),
                        name: jc.n.chars().take(32).collect(),
                        color: jc.c.clone(),
                        pic: String::new(),
                        secret: jc.s.clone(),
                        owner: String::new(),
                        members: Default::default(),
                        created: now_ms(),
                        invite: "all".into(),
                        voice: true,
                        meta_ts: 0,
                        muted: false,
                        read_ts: 0,
                        pending: true,
                        inviter: jc.p.clone(),
                        inviter_addrs: jc.a.clone(),
                        clear_ts: 0,
                    },
                );
                self.st.save_rooms();
                self.join_sent.remove(&jc.r);
                let addrs: Vec<Multiaddr> = jc.a.iter().filter_map(|a| a.parse().ok()).collect();
                if self.connected(&pid) {
                    self.try_joins(Some(pid));
                } else {
                    self.dial(pid, &addrs);
                }
                self.lookup(Lookup::Room(jc.r.clone()));
                self.lookup(Lookup::Peer(pid));
                let r = self.room_json(&jc.r);
                self.emit("room", json!({ "room": r }));
                Ok(r)
            }
            "room_leave" => {
                let id = s(&v, "room");
                let r = self.st.rooms.get_mut(&id).ok_or("нет такой группы")?;
                let kind = r.kind.clone();
                if kind == "group" && !r.pending {
                    let me = self.me_s.clone();
                    if let Some(m) = r.members.get_mut(&me) {
                        m.gone = true;
                        m.ts = now_ms();
                    }
                    let _ = self.post(&id, "sys", "leave", Value::Null, "");
                    self.push_room_all(&id, &[]);
                }
                if self.voice.as_ref().map(|(r, _)| *r == id).unwrap_or(false) {
                    self.on_cmd(json!({ "cmd": "voice_leave" }))?;
                }
                self.st.drop_room(&id);
                self.refresh_allow();
                self.emit("room_removed", json!({ "room": id, "why": "leave" }));
                Ok(json!({ "ok": true }))
            }
            "room_update" => {
                let id = s(&v, "room");
                let me = self.me_s.clone();
                let r = self.st.rooms.get_mut(&id).ok_or("нет такой группы")?;
                if r.kind != "group" {
                    // локальные флажки лички
                    if let Some(m) = b(&v, "muted") {
                        r.muted = m;
                    }
                    self.st.save_rooms();
                    return Ok(self.room_json(&id));
                }
                if let Some(m) = b(&v, "muted") {
                    r.muted = m;
                }
                let meta = v.get("name").is_some() || v.get("color").is_some() || v.get("pic").is_some() || v.get("invite").is_some() || v.get("voice").is_some();
                if meta {
                    if !r.is_admin(&me) {
                        return Err("менять группу может только админ".into());
                    }
                    if let Some(n) = v.get("name").and_then(|x| x.as_str()) {
                        let n: String = n.trim().chars().take(32).collect();
                        if !n.is_empty() {
                            r.name = n;
                        }
                    }
                    if let Some(c) = v.get("color").and_then(|x| x.as_str()) {
                        r.color = c.to_string();
                    }
                    if v.get("pic").is_some() {
                        r.pic = room_pic(&v)?;
                    }
                    if let Some(i) = v.get("invite").and_then(|x| x.as_str()) {
                        r.invite = if i == "admin" { "admin".into() } else { "all".into() };
                    }
                    if let Some(x) = b(&v, "voice") {
                        r.voice = x;
                    }
                    r.meta_ts = now_ms();
                }
                if b(&v, "new_secret").unwrap_or(false) && r.is_admin(&me) {
                    r.secret = rand_hex(16);
                    r.meta_ts = now_ms();
                }
                self.st.save_rooms();
                if meta || b(&v, "new_secret").unwrap_or(false) {
                    self.push_room_all(&id, &[]);
                }
                let j = self.room_json(&id);
                self.emit("room", json!({ "room": j }));
                Ok(j)
            }
            "room_kick" | "room_admin" => {
                let id = s(&v, "room");
                let p = s(&v, "peer");
                let me = self.me_s.clone();
                let r = self.st.rooms.get_mut(&id).ok_or("нет такой группы")?;
                if !r.is_admin(&me) {
                    return Err("это может только админ".into());
                }
                if p == r.owner {
                    return Err("создателя группы не трогаем".into());
                }
                let m = r.members.get_mut(&p).ok_or("нет такого участника")?;
                m.ts = now_ms();
                if c == "room_kick" {
                    m.gone = true;
                    r.secret = rand_hex(16);
                    r.meta_ts = now_ms();
                } else {
                    m.role = if b(&v, "on").unwrap_or(true) { "admin".into() } else { "member".into() };
                }
                self.st.save_rooms();
                self.refresh_allow();
                let extra: Vec<PeerId> = p.parse().ok().into_iter().collect();
                self.push_room_all(&id, &extra);
                let j = self.room_json(&id);
                self.emit("room", json!({ "room": j }));
                Ok(j)
            }
            "msgs" => {
                let id = s(&v, "room");
                let before = v.get("before").and_then(|x| x.as_u64());
                let limit = v.get("limit").and_then(|x| x.as_u64()).unwrap_or(80).min(500) as usize;
                Ok(json!({ "room": id, "msgs": self.st.page(&id, before, limit), "total": self.st.count(&id) }))
            }
            "search" => {
                let id = s(&v, "room");
                let limit = v.get("limit").and_then(|x| x.as_u64()).unwrap_or(50).min(200) as usize;
                let (total, msgs) = self.st.search(&id, &s(&v, "q"), &s(&v, "from"), limit);
                Ok(json!({ "room": id, "msgs": msgs, "total": total }))
            }
            "media_list" => {
                let id = s(&v, "room");
                let limit = v.get("limit").and_then(|x| x.as_u64()).unwrap_or(120).min(500) as usize;
                let (total, msgs) = self.st.media_list(&id, limit);
                Ok(json!({ "room": id, "msgs": msgs, "total": total }))
            }
            "msgs_to" => {
                // догрузить историю до сообщения с ts включительно (+ немного постарше для контекста)
                let id = s(&v, "room");
                let ts = v.get("ts").and_then(|x| x.as_u64()).unwrap_or(0);
                let n = (self.st.newer_than(&id, ts) + 20).min(5000);
                Ok(json!({ "room": id, "msgs": self.st.page(&id, None, n), "total": self.st.count(&id) }))
            }
            "send" => {
                let id = s(&v, "room");
                let kind = match s(&v, "kind").as_str() {
                    "" => "text".to_string(),
                    k => k.to_string(),
                };
                let text: String = s(&v, "text").chars().take(4000).collect();
                let data = v.get("data").cloned().unwrap_or(Value::Null);
                if text.trim().is_empty() && data.is_null() {
                    return Err("пустое сообщение".into());
                }
                if is_meta(&kind) {
                    return Err("реакции и правки — отдельными командами".into());
                }
                let m = self.post(&id, &kind, &text, data, &s(&v, "reply"))?;
                Ok(self.my_view(&m))
            }
            "react" => {
                let id = s(&v, "room");
                let to = s(&v, "id");
                let e: String = s(&v, "e").chars().take(8).collect();
                if e.is_empty() || e.len() > 32 {
                    return Err("нужна реакция".into());
                }
                let t = self.st.get(&id, &to).ok_or("сообщение не найдено")?;
                if is_meta(&t.kind) || t.kind == "sys" {
                    return Err("на это реагировать нельзя".into());
                }
                let on = match b(&v, "on") {
                    Some(x) => x,
                    None => !self.reacted(&id, &to, &e),
                };
                self.post_meta(&id, "react", &e, json!({ "to": to, "e": e, "on": on }))
            }
            "edit" => {
                let id = s(&v, "room");
                let to = s(&v, "id");
                let text: String = s(&v, "text").chars().take(4000).collect();
                let t = self.st.get(&id, &to).ok_or("сообщение не найдено")?;
                if t.from != self.me_s || is_meta(&t.kind) || t.kind == "sys" || t.kind == "sticker" {
                    return Err("редактировать можно только свои сообщения".into());
                }
                if text.trim().is_empty() && t.kind == "text" {
                    return Err("пустое сообщение — лучше удали".into());
                }
                let mine = self.st.rooms.get(&id).map(|r| r.kind == "self").unwrap_or(false);
                if !mine && now_ms().saturating_sub(t.ts) > EDIT_WINDOW_MS + 5_000 {
                    return Err("править можно только 30 секунд после отправки".into());
                }
                self.post_meta(&id, "edit", &text, json!({ "to": to }))
            }
            "del" => {
                let id = s(&v, "room");
                let to = s(&v, "id");
                let t = self.st.get(&id, &to).ok_or("сообщение не найдено")?;
                let admin = self.st.rooms.get(&id).map(|r| r.kind == "group" && r.is_admin(&self.me_s)).unwrap_or(false);
                if is_meta(&t.kind) || (t.from != self.me_s && !admin) {
                    return Err("удалить у всех можно только своё".into());
                }
                self.post_meta(&id, "del", "удалил сообщение", json!({ "to": to }))
            }
            "msg_hide" => {
                let id = s(&v, "room");
                let to = s(&v, "id");
                if !self.st.hide(&id, &to) {
                    return Err("сообщение не найдено".into());
                }
                self.emit("msg_upd", json!({ "room": id, "id": to, "msg": null }));
                let j = self.room_json(&id);
                self.emit("room", json!({ "room": j }));
                Ok(json!({ "ok": true }))
            }
            "room_clear" => {
                let id = s(&v, "room");
                if !self.st.rooms.contains_key(&id) {
                    return Err("нет такой группы".into());
                }
                let freed = self.st.clear(&id, now_ms());
                let j = self.room_json(&id);
                self.emit("room", json!({ "room": j, "cleared": true }));
                Ok(json!({ "ok": true, "freed": freed }))
            }
            "media" => {
                let (mime, name, b64) = self.st.media(&s(&v, "room"), &s(&v, "id")).ok_or("вложение не найдено")?;
                Ok(json!({ "mime": mime, "name": name, "b64": b64 }))
            }
            "storage" => Ok(self.st.storage()),
            "nick_check" => {
                let Some(n) = clean_nick(&s(&v, "nick")) else { return Ok(json!({ "state": "bad" })) };
                if self.st.profile.as_ref().map(|p| p.nick == n).unwrap_or(false) {
                    return Ok(json!({ "nick": n, "state": "mine" }));
                }
                if let Some(p) = self.nick_known(&n) {
                    return Ok(json!({ "nick": n, "state": "taken", "peer": p, "online": p.parse::<PeerId>().map(|x| self.online.contains_key(&x)).unwrap_or(false) }));
                }
                if let Some(c) = self.checks.get(&n) {
                    if let Some(d) = &c.done {
                        return Ok(json!({ "nick": n, "state": d, "peer": c.peer }));
                    }
                    if c.started.elapsed().as_secs() < 60 {
                        return Ok(json!({ "nick": n, "state": "checking" }));
                    }
                }
                if !self.st.config.dht || !self.swarm.behaviour().kad.is_enabled() {
                    return Ok(json!({ "nick": n, "state": "nodht" }));
                }
                if !self.start_check(&n, false) {
                    return Ok(json!({ "nick": n, "state": "wait" }));
                }
                Ok(json!({ "nick": n, "state": "checking" }))
            }
            "block" => {
                let p = s(&v, "peer");
                if p == self.me_s || p.parse::<PeerId>().is_err() {
                    return Err("кривой peer".into());
                }
                let nick = self.nick(&p);
                self.st.blocked.insert(p.clone(), Blocked { nick, ts: now_ms() });
                self.st.save_blocked();
                if self.st.friends.remove(&p).is_some() {
                    self.st.save_friends();
                    if let Ok(pid) = p.parse::<PeerId>() {
                        if self.connected(&pid) {
                            self.send(pid, Req::FriendRemove, Pend::Other);
                        }
                    }
                    self.emit("friend_removed", json!({ "peer": p }));
                }
                self.nearby.remove(&p);
                self.refresh_allow();
                let bl = self.blocked_json();
                self.emit("blocked", json!({ "blocked": bl }));
                Ok(json!({ "blocked": bl }))
            }
            "unblock" => {
                let p = s(&v, "peer");
                self.st.blocked.remove(&p);
                self.st.save_blocked();
                self.refresh_allow();
                let bl = self.blocked_json();
                self.emit("blocked", json!({ "blocked": bl }));
                Ok(json!({ "blocked": bl }))
            }
            "log_ui" => {
                if self.ui_log.0.elapsed().as_secs() > 60 {
                    self.ui_log = (std::time::Instant::now(), 0);
                }
                if self.ui_log.1 < 40 {
                    self.ui_log.1 += 1;
                    let text: String = s(&v, "text").chars().take(2000).collect();
                    tracing::warn!("[ui:{}] {text}", s(&v, "k"));
                }
                Ok(json!({ "ok": true }))
            }
            "read" => {
                let id = s(&v, "room");
                let last = self.st.last_ts(&id);
                if let Some(r) = self.st.rooms.get_mut(&id) {
                    if r.read_ts < last {
                        r.read_ts = last;
                        self.st.save_rooms();
                    }
                }
                Ok(json!({ "ok": true }))
            }
            "ev" => {
                let id = s(&v, "room");
                let kind = s(&v, "kind");
                let data = v.get("data").cloned().unwrap_or(Value::Null);
                if !self.member_ok(&id, &self.me_s.clone()) {
                    return Err("ты не в этом чате".into());
                }
                let to = s(&v, "to");
                let req = Req::Ev { room: id.clone(), kind, data };
                if to.is_empty() {
                    self.bcast(&id, req);
                } else {
                    let p: PeerId = to.parse().map_err(|_| "кривой peer")?;
                    if !self.online.contains_key(&p) {
                        return Err("не в сети".into());
                    }
                    self.send(p, req, Pend::Other);
                }
                Ok(json!({ "ok": true }))
            }
            "rtc" => {
                let id = s(&v, "room");
                let p: PeerId = s(&v, "to").parse().map_err(|_| "кривой peer")?;
                let data = v.get("data").cloned().unwrap_or(Value::Null);
                if !self.online.contains_key(&p) {
                    return Err("не в сети".into());
                }
                self.send(p, Req::Rtc { room: id, data }, Pend::Other);
                Ok(json!({ "ok": true }))
            }
            "voice_join" | "voice_state" => {
                let id = if c == "voice_join" { s(&v, "room") } else { self.voice.as_ref().map(|x| x.0.clone()).ok_or("ты не в голосе")? };
                if !self.member_ok(&id, &self.me_s.clone()) {
                    return Err("ты не в этом чате".into());
                }
                if self.st.rooms.get(&id).map(|r| r.kind == "self").unwrap_or(false) {
                    return Err("в «Избранном» звонить некому".into());
                }
                let mut st: VoiceState = v.get("state").cloned().and_then(|x| serde_json::from_value(x).ok()).unwrap_or_default();
                if c == "voice_join" {
                    if let Some((old, _)) = self.voice.clone() {
                        if old != id {
                            self.bcast(&old, Req::Voice { room: old.clone(), state: None });
                            if let Some(m) = self.voices.get_mut(&old) {
                                m.remove(&self.me_s);
                            }
                            self.emit("voice", json!({ "room": old, "peer": self.me_s, "state": null }));
                        }
                    }
                    st.since = now_ms();
                } else {
                    st.since = self.voice.as_ref().map(|x| x.1.since).unwrap_or_else(now_ms);
                }
                self.voice = Some((id.clone(), st.clone()));
                self.voices.entry(id.clone()).or_default().insert(self.me_s.clone(), st.clone());
                self.bcast(&id, Req::Voice { room: id.clone(), state: Some(st.clone()) });
                self.emit("voice", json!({ "room": id, "peer": self.me_s, "state": st }));
                Ok(json!({ "room": id, "peers": self.voices.get(&id) }))
            }
            "voice_leave" => {
                if let Some((id, _)) = self.voice.take() {
                    self.bcast(&id, Req::Voice { room: id.clone(), state: None });
                    if let Some(m) = self.voices.get_mut(&id) {
                        m.remove(&self.me_s);
                    }
                    self.emit("voice", json!({ "room": id, "peer": self.me_s, "state": null }));
                }
                Ok(json!({ "ok": true }))
            }
            "config_set" => {
                let cfg = &mut self.st.config;
                if let Some(x) = b(&v, "findable") {
                    cfg.findable = x;
                    self.last_provide = None;
                }
                if let Some(x) = b(&v, "mdns") {
                    cfg.mdns = x;
                }
                if let Some(x) = b(&v, "dht") {
                    cfg.dht = x;
                }
                if let Some(x) = b(&v, "upnp") {
                    cfg.upnp = x;
                }
                if let Some(x) = b(&v, "relay_server") {
                    cfg.relay_server = x;
                }
                if let Some(x) = b(&v, "server") {
                    cfg.server = x;
                    // сервер без ретранслятора и проброса порта бессмысленен
                    if x {
                        cfg.relay_server = true;
                        cfg.upnp = true;
                    }
                }
                if let Some(x) = v.get("ice") {
                    if x.is_array() {
                        cfg.ice = x.clone();
                    }
                }
                if let Some(p) = v.get("port").and_then(|x| x.as_u64()) {
                    cfg.port = p as u16;
                }
                self.st.save_config();
                Ok(json!({ "config": self.st.config, "restart": true }))
            }
            "backup_export" => {
                let key = self.key.to_protobuf_encoding().map_err(|e| e.to_string())?;
                Ok(json!({
                    "hunty_backup": 1, "peer": self.me_s, "key": B64.encode(key), "profile": self.st.profile,
                    "friends": self.st.friends, "rooms": self.st.rooms, "config": self.st.config, "ts": now_ms(),
                }))
            }
            "backup_import" => {
                let d = v.get("data").ok_or("нет данных")?;
                if d.get("hunty_backup").is_none() {
                    return Err("это не бэкап Hunty".into());
                }
                let key = B64.decode(d.get("key").and_then(|x| x.as_str()).ok_or("нет ключа")?).map_err(|_| "битый ключ")?;
                libp2p::identity::Keypair::from_protobuf_encoding(&key).map_err(|_| "битый ключ")?;
                let dir = self.st.dir.clone();
                write_atomic(&dir.join("identity.key"), &key).map_err(|e| e.to_string())?;
                for (f, k) in [("profile.json", "profile"), ("friends.json", "friends"), ("rooms.json", "rooms"), ("config.json", "config")] {
                    if let Some(x) = d.get(k) {
                        write_atomic(&dir.join(f), &serde_json::to_vec_pretty(x).unwrap_or_default()).map_err(|e| e.to_string())?;
                    }
                }
                let _ = std::fs::remove_file(dir.join("peers.json"));
                self.quit = true;
                Ok(json!({ "restart": true }))
            }
            "quit" => {
                self.quit = true;
                Ok(json!({ "ok": true }))
            }
            other => Err(format!("неизвестная команда: {other}")),
        }
    }
}

/// аватарка группы из команды: "" или data:image/… до 96 КБ
fn room_pic(v: &Value) -> Result<String, String> {
    let p = v.get("pic").and_then(|x| x.as_str()).unwrap_or("");
    if p.is_empty() {
        return Ok(String::new());
    }
    if !p.starts_with("data:image/") {
        return Err("аватарка группы — только картинка".into());
    }
    if p.len() > 96 * 1024 {
        return Err("аватарка группы слишком большая (до 96 КБ)".into());
    }
    Ok(p.to_string())
}
