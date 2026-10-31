//! Обработка входящих запросов и ответов протокола /hunty/1.0.0.
use crate::node::{Node, Online, Pend};
use crate::proto::*;
use crate::store::*;
use crate::util::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use libp2p::PeerId;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub fn pubkey_of(p: &PeerId) -> Option<libp2p::identity::PublicKey> {
    let mh: &libp2p::multihash::Multihash<64> = p.as_ref();
    if mh.code() != 0 {
        return None;
    }
    libp2p::identity::PublicKey::try_decode_protobuf(mh.digest()).ok()
}

pub fn verify(m: &Msg) -> bool {
    let Ok(pid) = m.from.parse::<PeerId>() else { return false };
    let Some(pk) = pubkey_of(&pid) else { return false };
    let Ok(sig) = B64.decode(&m.sig) else { return false };
    pk.verify(&m.signing_bytes(), &sig)
}

pub fn room_rev(r: &Room) -> u64 {
    r.meta_ts.max(r.members.values().map(|m| m.ts).max().unwrap_or(0))
}

impl Node {
    pub(crate) fn rel(&self, p: &PeerId) -> String {
        match self.st.friends.get(&p.to_string()).map(|f| &f.state) {
            Some(FriendState::Friend) => "friend",
            Some(FriendState::Outgoing) => "want",
            _ => "none",
        }
        .to_string()
    }

    pub(crate) fn shared_rooms(&self, p: &PeerId) -> Vec<RoomSync> {
        let ps = p.to_string();
        self.st
            .rooms
            .values()
            .filter(|r| !r.pending && r.is_member(&ps))
            .map(|r| RoomSync { id: r.id.clone(), last: self.st.last_ts(&r.id), rev: room_rev(r) })
            .collect()
    }

    fn voice_for(&self, p: &PeerId) -> Option<(String, VoiceState)> {
        let (room, vs) = self.voice.as_ref()?;
        let r = self.st.rooms.get(room)?;
        r.is_member(&p.to_string()).then(|| (room.clone(), vs.clone()))
    }

    pub(crate) fn relay_capable(&self) -> bool {
        self.swarm.behaviour().relay.is_enabled() && self.nat == "public"
    }

    pub(crate) fn hello_req(&self, p: &PeerId) -> Req {
        Req::Hello {
            profile: self.profile(),
            rel: self.rel(p),
            rooms: self.shared_rooms(p),
            relay: self.relay_capable(),
            voice: self.voice_for(p),
        }
    }

    fn hello_resp(&self, p: &PeerId) -> Resp {
        Resp::Hello {
            profile: self.profile(),
            rel: self.rel(p),
            rooms: self.shared_rooms(p),
            relay: self.relay_capable(),
            voice: self.voice_for(p),
        }
    }

    pub(crate) fn member_ok(&self, room: &str, peer: &str) -> bool {
        self.st.rooms.get(room).map(|r| !r.pending && r.is_member(peer)).unwrap_or(false)
    }

    /// Создаю личку с другом (если ещё нет).
    pub(crate) fn ensure_dm(&mut self, peer: &str) -> Option<String> {
        let p: PeerId = peer.parse().ok()?;
        let id = dm_room_id(&self.me, &p);
        let now = now_ms();
        let me = self.profile();
        let fp = self.st.friends.get(peer).map(|f| f.profile.clone()).unwrap_or_default();
        let created = !self.st.rooms.contains_key(&id);
        let r = self.st.rooms.entry(id.clone()).or_insert_with(|| Room {
            id: id.clone(),
            kind: "dm".into(),
            name: String::new(),
            color: String::new(),
            pic: String::new(),
            secret: String::new(),
            owner: String::new(),
            members: Default::default(),
            created: now,
            invite: "none".into(),
            voice: true,
            meta_ts: 0,
            muted: false,
            read_ts: 0,
            pending: false,
            inviter: String::new(),
            inviter_addrs: vec![],
            clear_ts: 0,
        });
        for (ps, prof) in [(self.me_s.clone(), me), (peer.to_string(), fp)] {
            r.members.entry(ps.clone()).or_insert(Member { peer: ps, nick: prof.nick, ava: prof.ava, role: "member".into(), ts: 1, gone: false });
        }
        if let Some(f) = self.st.friends.get_mut(peer) {
            f.dm = id.clone();
        }
        self.st.save_rooms();
        self.st.save_friends();
        if created {
            let v = self.room_json(&id);
            self.emit("room", json!({ "room": v }));
        }
        Some(id)
    }

    pub(crate) fn update_profile(&mut self, peer: &PeerId, p: Profile) {
        let ps = peer.to_string();
        if p.nick.is_empty() {
            return;
        }
        let mut changed = false;
        if let Some(f) = self.st.friends.get_mut(&ps) {
            if f.profile.ts < p.ts || f.profile.nick.is_empty() || (f.profile.ts == p.ts && f.profile != p) {
                if f.profile != p {
                    f.profile = p.clone();
                    changed = true;
                }
            }
        }
        let mut rooms_changed = false;
        for r in self.st.rooms.values_mut() {
            if let Some(m) = r.members.get_mut(&ps) {
                if m.nick != p.nick || m.ava != p.ava {
                    m.nick = p.nick.clone();
                    m.ava = p.ava.clone();
                    rooms_changed = true;
                }
            }
        }
        if changed {
            self.st.save_friends();
        }
        if rooms_changed {
            self.st.save_rooms();
        }
        if changed || rooms_changed {
            self.emit("profile", json!({ "peer": ps, "profile": p }));
        }
    }

    fn process_hello(&mut self, peer: PeerId, profile: Profile, rel: String, rooms: Vec<RoomSync>, relay: bool, voice: Option<(String, VoiceState)>) {
        let ps = peer.to_string();
        let first = !self.online.contains_key(&peer);
        let o = self.online.entry(peer).or_insert(Online { since: now_ms(), rtt: None, relay: false, rtt_sent: None });
        o.relay = relay;
        // дружба
        let state = self.st.friends.get(&ps).map(|f| f.state.clone());
        match (state, rel.as_str()) {
            (Some(FriendState::Outgoing), "friend") | (Some(FriendState::Outgoing), "want") => {
                if let Some(f) = self.st.friends.get_mut(&ps) {
                    f.state = FriendState::Friend;
                    f.since = now_ms();
                    f.profile = profile.clone();
                }
                self.st.save_friends();
                self.ensure_dm(&ps);
                let v = self.friend_json(&ps);
                self.emit("friend", json!({ "friend": v }));
                self.log("ok", format!("@{} теперь в друзьях · ключи обменялись напрямую", profile.nick));
                if rel == "want" {
                    // пусть и он узнает, что мы уже друзья
                    self.hello_inflight.remove(&peer);
                    self.send_hello(peer);
                }
            }
            (None, "want") if self.st.blocked.contains_key(&ps) => {
                tracing::info!("заявка от заблокированного {ps} — молча игнорирую");
            }
            (None, "want") => {
                self.st.friends.insert(
                    ps.clone(),
                    Friend { peer: ps.clone(), profile: profile.clone(), state: FriendState::Incoming, since: now_ms(), dm: String::new(), hint: vec![] },
                );
                self.st.save_friends();
                let v = self.friend_json(&ps);
                self.emit("friend", json!({ "friend": v, "request": true }));
                self.log("ping", format!("@{} хочет в друзья", profile.nick));
            }
            (Some(FriendState::Friend), "none") => {
                // он меня потерял (например, переустановил без бэкапа) — снова прошусь
                if let Some(f) = self.st.friends.get_mut(&ps) {
                    f.state = FriendState::Outgoing;
                }
                self.st.save_friends();
                let v = self.friend_json(&ps);
                self.emit("friend", json!({ "friend": v }));
            }
            _ => {}
        }
        self.update_profile(&peer, profile);
        if self.is_friend(&ps) {
            let dm = dm_room_id(&self.me, &peer);
            if !self.st.rooms.contains_key(&dm) {
                self.ensure_dm(&ps);
            }
        }
        // хаты
        let theirs: HashSet<String> = rooms.iter().map(|r| r.id.clone()).collect();
        for rs in rooms {
            let Some(r) = self.st.rooms.get(&rs.id) else { continue };
            if r.pending || !r.is_member(&ps) {
                continue;
            }
            let push = rs.rev != room_rev(r) && r.kind == "group";
            if rs.last > self.st.last_ts(&rs.id).max(r.clear_ts) {
                self.sync_from(peer, &rs.id);
            }
            if push {
                self.push_room_to(peer, &rs.id);
            }
        }
        let missing: Vec<String> = self
            .st
            .rooms
            .values()
            .filter(|r| !r.pending && r.kind == "group" && r.is_member(&ps) && !theirs.contains(&r.id))
            .map(|r| r.id.clone())
            .collect();
        for id in missing {
            self.push_room_to(peer, &id);
        }
        // голос
        if let Some((room, vs)) = voice {
            if self.member_ok(&room, &ps) {
                self.voices.entry(room.clone()).or_default().insert(ps.clone(), vs.clone());
                self.emit("voice", json!({ "room": room, "peer": ps, "state": vs }));
            }
        }
        if first {
            self.presence(&peer);
            let via = match self.via(&peer) {
                "relay" => "через ретранслятор",
                "lan" => "по локалке",
                _ => "напрямую",
            };
            self.log("ok", format!("{} подключился {via}", self.nick(&ps)));
        }
        self.refresh_allow();
    }

    pub(crate) fn sync_from(&mut self, peer: PeerId, room: &str) {
        let last = self.st.last_ts(room);
        // после «очистить историю» старое не докачиваю
        let floor = self.st.rooms.get(room).map(|r| r.clear_ts).unwrap_or(0);
        let since = if last == 0 { floor } else { last.saturating_sub(10 * 60 * 1000).max(floor) };
        let have = self.st.have_since(room, since);
        self.send(peer, Req::SyncReq { room: room.to_string(), since, have }, Pend::Sync(room.to_string()));
    }

    /// Новые сообщения уже в хранилище — рассказать UI (лёгкие копии, без вложений).
    /// live: одно сообщение «вживую» (событие msg) или пачка из синхронизации (msgs).
    pub(crate) fn tell_ui(&mut self, room: &str, added: &[Msg], live: bool) {
        let mut vis = vec![];
        let mut upd: Vec<String> = vec![];
        for m in added {
            if is_meta(&m.kind) {
                if let Some(t) = target(m) {
                    if !upd.iter().any(|x| x == t) {
                        upd.push(t.to_string());
                    }
                }
            } else if let Some(x) = self.st.get(room, &m.id) {
                vis.push(self.st.view(x));
            }
        }
        let unread = self.st.unread(room, &self.me_s);
        if live {
            for v in vis {
                self.emit("msg", json!({ "room": room, "msg": v, "unread": unread }));
            }
        } else if !vis.is_empty() {
            self.emit("msgs", json!({ "room": room, "msgs": vis, "unread": unread }));
        }
        if !upd.is_empty() {
            let last = self.st.last_visible(room).and_then(|v| v.get("id").and_then(|x| x.as_str()).map(String::from));
            let mut touch_last = false;
            for t in upd {
                let v = self.st.get(room, &t).map(|x| self.st.view(x));
                if v.is_none() || last.as_deref() == Some(t.as_str()) {
                    touch_last = true;
                }
                self.emit("msg_upd", json!({ "room": room, "id": t, "msg": v }));
            }
            if touch_last {
                let v = self.room_json(room);
                self.emit("room", json!({ "room": v }));
            }
        }
    }

    pub(crate) fn blocked_dm(&self, room: &str, peer: &str) -> bool {
        self.st.blocked.contains_key(peer) && self.st.rooms.get(room).map(|r| r.kind == "dm").unwrap_or(false)
    }

    pub(crate) fn room_wire(&self, id: &str, secret: bool) -> Option<RoomWire> {
        let r = self.st.rooms.get(id)?;
        let mut addrs = vec![(self.me_s.clone(), self.my_addrs())];
        for m in r.live_members() {
            if m.peer == self.me_s {
                continue;
            }
            if let Some(c) = self.st.peers.get(&m.peer) {
                addrs.push((m.peer.clone(), c.addrs.iter().take(4).cloned().collect()));
            }
        }
        Some(RoomWire {
            id: r.id.clone(),
            kind: r.kind.clone(),
            name: r.name.clone(),
            color: r.color.clone(),
            pic: r.pic.clone(),
            secret: if secret { r.secret.clone() } else { String::new() },
            owner: r.owner.clone(),
            members: r.members.values().cloned().collect(),
            created: r.created,
            invite: r.invite.clone(),
            voice: r.voice,
            meta_ts: r.meta_ts,
            addrs,
        })
    }

    pub(crate) fn push_room_to(&mut self, peer: PeerId, id: &str) {
        let ps = peer.to_string();
        let member = self.st.rooms.get(id).map(|r| r.is_member(&ps)).unwrap_or(false);
        if let Some(w) = self.room_wire(id, member) {
            self.send(peer, Req::RoomPush { room: w }, Pend::Other);
        }
    }

    pub(crate) fn push_room_all(&mut self, id: &str, extra: &[PeerId]) {
        let mut t: Vec<PeerId> = self.online_members(id);
        for e in extra {
            if !t.contains(e) && self.online.contains_key(e) {
                t.push(*e);
            }
        }
        for p in t {
            self.push_room_to(p, id);
        }
    }

    fn learn_addrs(&mut self, w: &RoomWire) {
        for (p, addrs) in &w.addrs {
            let Ok(pid) = p.parse::<PeerId>() else { continue };
            if pid == self.me {
                continue;
            }
            let v: Vec<libp2p::Multiaddr> = addrs.iter().filter_map(|a| a.parse().ok()).collect();
            if !v.is_empty() {
                self.remember(&pid, v);
            }
        }
    }

    /// Слияние: участники — кто новее (ts), мета — у кого meta_ts больше и есть права.
    fn merge_room(&mut self, w: RoomWire, sender: &str) -> bool {
        let Some(r) = self.st.rooms.get_mut(&w.id) else { return false };
        let sender_admin = r.is_admin(sender) || w.owner == sender && r.owner == sender;
        let mut changed = false;
        for m in w.members {
            let take = match r.members.get(&m.peer) {
                None => true,
                Some(l) => m.ts > l.ts && *l != m,
            };
            if !take {
                continue;
            }
            let was_live = r.members.get(&m.peer).map(|l| !l.gone).unwrap_or(false);
            if m.gone && was_live && m.peer != sender && !sender_admin {
                continue;
            }
            let was_admin = r.members.get(&m.peer).map(|l| l.role == "admin").unwrap_or(false);
            if m.role == "admin" && !was_admin && !sender_admin && m.peer != r.owner {
                continue;
            }
            r.members.insert(m.peer.clone(), m);
            changed = true;
        }
        if w.meta_ts > r.meta_ts && sender_admin {
            r.name = w.name;
            r.color = w.color;
            r.pic = w.pic;
            r.invite = w.invite;
            r.voice = w.voice;
            r.meta_ts = w.meta_ts;
            changed = true;
        }
        if !w.secret.is_empty() && w.secret != r.secret && (sender_admin || r.secret.is_empty()) {
            r.secret = w.secret;
            changed = true;
        }
        changed
    }

    fn on_room_push(&mut self, peer: PeerId, w: RoomWire) {
        self.on_room_push_inner(peer, w.clone());
        if self.st.rooms.contains_key(&w.id) {
            self.learn_addrs(&w);
        }
    }

    fn on_room_push_inner(&mut self, peer: PeerId, w: RoomWire) {
        let ps = peer.to_string();
        let me = self.me_s.clone();
        let sender_listed = w.members.iter().any(|m| m.peer == ps && !m.gone);
        let me_listed = w.members.iter().any(|m| m.peer == me && !m.gone);
        let me_gone = w.members.iter().any(|m| m.peer == me && m.gone);
        let id = w.id.clone();
        match self.st.rooms.get(&id).map(|r| (r.pending, r.is_member(&ps), r.secret.clone())) {
            None => {
                if !(sender_listed && me_listed && self.is_friend(&ps) && w.kind == "group") {
                    return;
                }
                let r = Room {
                    id: id.clone(),
                    kind: w.kind.clone(),
                    name: w.name.clone(),
                    color: w.color.clone(),
                    pic: w.pic.clone(),
                    secret: w.secret.clone(),
                    owner: w.owner.clone(),
                    members: w.members.iter().map(|m| (m.peer.clone(), m.clone())).collect(),
                    created: w.created,
                    invite: w.invite.clone(),
                    voice: w.voice,
                    meta_ts: w.meta_ts,
                    muted: false,
                    read_ts: 0,
                    pending: false,
                    inviter: String::new(),
                    inviter_addrs: vec![],
                    clear_ts: 0,
                };
                self.st.rooms.insert(id.clone(), r);
                self.st.save_rooms();
                self.refresh_allow();
                let v = self.room_json(&id);
                self.emit("room", json!({ "room": v, "added_by": ps }));
                self.log("ping", format!("{} позвал тебя в хату «{}»", self.nick(&ps), w.name));
                self.sync_from(peer, &id);
            }
            Some((true, _, _)) => {
                if !(sender_listed && me_listed) {
                    return;
                }
                if let Some(r) = self.st.rooms.get_mut(&id) {
                    r.pending = false;
                    r.owner = w.owner.clone();
                    r.created = w.created;
                    r.kind = w.kind.clone();
                }
                self.merge_room(w, &ps);
                self.finish_join(peer, &id);
            }
            Some((false, was_member, secret)) => {
                if !was_member && !(sender_listed && !w.secret.is_empty() && w.secret == secret) {
                    return;
                }
                let changed = self.merge_room(w, &ps);
                if me_gone && !self.member_ok(&id, &me) {
                    let name = self.st.rooms.get(&id).map(|r| r.name.clone()).unwrap_or_default();
                    self.st.drop_room(&id);
                    self.refresh_allow();
                    self.emit("room_removed", json!({ "room": id, "why": "kick" }));
                    self.log("warn", format!("тебя убрали из хаты «{name}»"));
                    return;
                }
                if changed {
                    self.st.save_rooms();
                    self.refresh_allow();
                    let v = self.room_json(&id);
                    self.emit("room", json!({ "room": v }));
                }
            }
        }
    }

    fn finish_join(&mut self, peer: PeerId, id: &str) {
        self.st.save_rooms();
        self.refresh_allow();
        self.join_sent.remove(id);
        let v = self.room_json(id);
        self.emit("room", json!({ "room": v, "joined": true }));
        let name = self.st.rooms.get(id).map(|r| r.name.clone()).unwrap_or_default();
        self.log("ok", format!("ты в хате «{name}» · история подтягивается от участников"));
        self.sync_from(peer, id);
        // знакомлюсь с остальными
        let others: Vec<PeerId> = self
            .st
            .rooms
            .get(id)
            .map(|r| r.live_members().filter(|m| m.peer != self.me_s).filter_map(|m| m.peer.parse().ok()).collect())
            .unwrap_or_default();
        for p in others {
            if self.connected(&p) {
                self.hello_inflight.remove(&p);
                self.send_hello(p);
            } else {
                self.dial(p, &[]);
            }
        }
        let _ = self.post_sys(id, "join");
    }

    fn on_join(&mut self, peer: PeerId, room: String, secret: String, profile: Profile) -> Resp {
        let ps = peer.to_string();
        let Some(r) = self.st.rooms.get_mut(&room) else { return Resp::Err { e: "нет такой хаты".into() } };
        if r.pending || r.kind != "group" {
            return Resp::Err { e: "нет такой хаты".into() };
        }
        if r.secret.is_empty() || r.secret != secret {
            return Resp::Err { e: "инвайт устарел — попроси новый".into() };
        }
        let was = r.is_member(&ps);
        let role = r.members.get(&ps).map(|m| m.role.clone()).filter(|x| !x.is_empty()).unwrap_or_else(|| "member".into());
        r.members.insert(ps.clone(), Member { peer: ps.clone(), nick: profile.nick.clone(), ava: profile.ava.clone(), role, ts: now_ms(), gone: false });
        let name = r.name.clone();
        self.st.save_rooms();
        self.refresh_allow();
        let Some(w) = self.room_wire(&room, true) else { return Resp::Err { e: "ой".into() } };
        if !was {
            self.log("ok", format!("@{} зашёл в «{name}» по инвайту", profile.nick));
            let v = self.room_json(&room);
            self.emit("room", json!({ "room": v }));
        }
        let others: Vec<PeerId> = self.online_members(&room).into_iter().filter(|p| *p != peer).collect();
        for o in others {
            self.push_room_to(o, &room);
        }
        Resp::Joined { room: w }
    }

    fn on_msg(&mut self, peer: PeerId, msg: Msg) {
        let ps = peer.to_string();
        let room = msg.room.clone();
        if !self.st.rooms.contains_key(&room) && self.is_friend(&ps) && room == dm_room_id(&self.me, &peer) {
            self.ensure_dm(&ps);
        }
        if !self.member_ok(&room, &ps) {
            return;
        }
        if self.blocked_dm(&room, &msg.from) {
            return;
        }
        let author_ok = self.st.rooms.get(&room).map(|r| r.members.contains_key(&msg.from)).unwrap_or(false);
        if !author_ok || !verify(&msg) {
            tracing::warn!("отбросил сообщение {} от {}: подпись/автор не сходятся", msg.id, msg.from);
            return;
        }
        if self.st.add_msg(msg.clone()) {
            self.tell_ui(&room, std::slice::from_ref(&msg), true);
            let targets: Vec<PeerId> = self.online_members(&room).into_iter().filter(|p| *p != peer && p.to_string() != msg.from).collect();
            for t in targets {
                self.send(t, Req::Msg { msg: msg.clone() }, Pend::Other);
            }
        }
    }

    fn on_sync_req(&mut self, peer: PeerId, room: String, since: u64, have: Vec<String>) -> Resp {
        if !self.member_ok(&room, &peer.to_string()) {
            return Resp::Err { e: "не участник".into() };
        }
        let have: HashSet<String> = have.into_iter().collect();
        // не больше 300 штук и ~24 МБ за раз: картинки читаю с диска, остальное докачается следующим запросом
        let mut msgs: Vec<Msg> = vec![];
        let mut bytes = 0usize;
        let mut more = false;
        for m in self.st.msgs(&room).iter().filter(|m| m.ts >= since && !have.contains(&m.id)) {
            if msgs.len() >= 300 || bytes > 24 << 20 {
                more = true;
                break;
            }
            let Some(full) = self.st.full(m) else { continue };
            bytes += m.at.map(|a| a.1 as usize).unwrap_or(300 + m.text.len());
            msgs.push(full);
        }
        Resp::Sync { msgs, more }
    }

    pub(crate) fn on_req(&mut self, peer: PeerId, req: Req) -> Resp {
        let ps = peer.to_string();
        if self.st.profile.is_none() {
            return Resp::Err { e: "ещё не зарегался".into() };
        }
        match req {
            Req::Ping => Resp::Ok,
            Req::Whois => Resp::Profile { profile: self.profile() },
            Req::Hello { profile, rel, rooms, relay, voice } => {
                if !self.known(&peer) && rel != "want" {
                    return Resp::Err { e: "не знакомы".into() };
                }
                self.hello_inflight.remove(&peer);
                self.process_hello(peer, profile, rel, rooms, relay, voice);
                self.hello_resp(&peer)
            }
            Req::Profile { profile } => {
                self.update_profile(&peer, profile);
                Resp::Ok
            }
            Req::FriendReq { .. } | Req::FriendAccept { .. } if self.st.blocked.contains_key(&ps) => Resp::Err { e: "не принимаю заявки".into() },
            Req::FriendReq { profile } | Req::FriendAccept { profile } => {
                self.process_hello(peer, profile, "want".into(), vec![], false, None);
                self.hello_resp(&peer)
            }
            Req::FriendRemove => {
                if self.st.friends.remove(&ps).is_some() {
                    self.st.save_friends();
                    self.refresh_allow();
                    self.emit("friend_removed", json!({ "peer": ps }));
                }
                Resp::Ok
            }
            Req::Join { room, secret, profile } => self.on_join(peer, room, secret, profile),
            Req::RoomPush { room } => {
                self.on_room_push(peer, room);
                Resp::Ok
            }
            Req::Msg { msg } => {
                self.on_msg(peer, msg);
                Resp::Ok
            }
            Req::SyncReq { room, since, have } => self.on_sync_req(peer, room, since, have),
            Req::Ev { room, .. } | Req::Rtc { room, .. } | Req::Voice { room, .. } if self.blocked_dm(&room, &ps) => Resp::Ok,
            Req::Ev { room, kind, data } => {
                if self.member_ok(&room, &ps) {
                    self.emit("ev", json!({ "room": room, "from": ps, "kind": kind, "data": data }));
                }
                Resp::Ok
            }
            Req::Voice { room, state } => {
                if self.member_ok(&room, &ps) {
                    match &state {
                        Some(s) => {
                            self.voices.entry(room.clone()).or_default().insert(ps.clone(), s.clone());
                        }
                        None => {
                            if let Some(m) = self.voices.get_mut(&room) {
                                m.remove(&ps);
                            }
                        }
                    }
                    self.emit("voice", json!({ "room": room, "peer": ps, "state": state }));
                }
                Resp::Ok
            }
            Req::Rtc { room, data } => {
                if self.member_ok(&room, &ps) {
                    self.emit("rtc", json!({ "room": room, "from": ps, "data": data }));
                }
                Resp::Ok
            }
        }
    }

    pub(crate) fn on_resp(&mut self, peer: PeerId, pend: Pend, resp: Resp) {
        let ps = peer.to_string();
        match (pend, resp) {
            (Pend::Hello, Resp::Hello { profile, rel, rooms, relay, voice }) => {
                self.hello_inflight.remove(&peer);
                self.process_hello(peer, profile, rel, rooms, relay, voice);
            }
            (Pend::Hello, Resp::Err { e }) => {
                self.hello_inflight.remove(&peer);
                tracing::debug!("hello {peer}: {e}");
            }
            (Pend::Find(nick), Resp::Profile { profile }) => {
                if profile.nick == nick {
                    let fr = self.st.friends.get(&ps).map(|f| f.state.clone());
                    self.emit("found", json!({ "nick": nick, "peer": ps, "profile": profile, "friend": fr }));
                }
            }
            (Pend::Check(nick), Resp::Profile { profile }) => {
                if profile.nick == nick && peer != self.me {
                    self.finish_check(&nick, "taken", &ps);
                } else if let Some(c) = self.checks.get_mut(&nick) {
                    // у него уже другой ник — запись в DHT просто старая
                    c.providers.remove(&peer);
                }
            }
            (Pend::Whois, Resp::Profile { profile }) => {
                if !profile.nick.is_empty() && !self.known(&peer) {
                    self.nearby.insert(ps.clone(), profile.clone());
                    self.emit("nearby", json!({ "peer": ps, "profile": profile }));
                }
            }
            (Pend::Join(room), Resp::Joined { room: w }) => {
                if w.id != room {
                    return;
                }
                let me = self.me_s.clone();
                if !w.members.iter().any(|m| m.peer == me && !m.gone) {
                    return;
                }
                if let Some(r) = self.st.rooms.get_mut(&room) {
                    if !r.pending {
                        return;
                    }
                    r.pending = false;
                    r.owner = w.owner.clone();
                    r.created = w.created;
                    r.kind = w.kind.clone();
                    r.name = w.name.clone();
                    r.color = w.color.clone();
                    r.pic = w.pic.clone();
                    r.invite = w.invite.clone();
                    r.voice = w.voice;
                    r.meta_ts = w.meta_ts;
                    r.secret = w.secret.clone();
                    r.members = w.members.iter().map(|m| (m.peer.clone(), m.clone())).collect();
                }
                self.learn_addrs(&w);
                self.finish_join(peer, &room);
            }
            (Pend::Join(room), Resp::Err { e }) => {
                self.join_sent.remove(&room);
                self.log("err", format!("в хату не пустили: {e}"));
                self.emit("join_failed", json!({ "room": room, "error": e }));
            }
            (Pend::Sync(room), Resp::Sync { msgs, more }) => {
                let authors: HashMap<String, bool> =
                    self.st.rooms.get(&room).map(|r| r.members.keys().map(|k| (k.clone(), true)).collect()).unwrap_or_default();
                let mut new = vec![];
                let mut max_ts = 0;
                for mut m in msgs {
                    max_ts = max_ts.max(m.ts);
                    if m.room != room || !authors.contains_key(&m.from) || self.blocked_dm(&room, &m.from) || !verify(&m) {
                        continue;
                    }
                    m.at = None;
                    if self.st.add_msg(m.clone()) {
                        // в списке для UI вложение не нужно — tell_ui возьмёт лёгкую копию из хранилища
                        if let Value::Object(o) = &mut m.data {
                            o.remove("src");
                        }
                        new.push(m);
                    }
                }
                if !new.is_empty() {
                    self.tell_ui(&room, &new, false);
                }
                if more && max_ts > 0 {
                    let have = self.st.have_since(&room, max_ts);
                    self.send(peer, Req::SyncReq { room: room.clone(), since: max_ts, have }, Pend::Sync(room));
                }
            }
            _ => {}
        }
    }
}
