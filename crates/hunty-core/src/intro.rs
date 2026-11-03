//! Каждый ПК — мини-сервер знакомств.
//!
//! Друг, который уже в сети с нами обоими, знает свежие адреса (в том числе «дырку» в NAT,
//! через которую мы до него достучались). Спрашиваю у него «кого из моих ты видишь» (Seek) —
//! он отвечает (Seen) и тут же шлёт второму встречное знакомство (Intro). Оба звонят друг
//! другу одновременно — так пробивается большинство домашних NAT, а если нет и у второго резерв
//! на этом друге — идём цепочкой через него. Если искомого пока нет, друг запоминает просьбу
//! и знакомит, как только тот появится. Обычно это доли секунды вместо минуты поиска в DHT.
use crate::node::{is_circuit, is_loopback, strip_peer, Node, Pend};
use crate::proto::*;
use crate::util::short;
use libp2p::{
    multiaddr::Protocol,
    swarm::dial_opts::{DialOpts, PeerCondition},
    Multiaddr, PeerId,
};
use std::collections::HashSet;
use std::time::{Duration, Instant};

/// Сколько помнить просьбу «найди мне его».
const SEEK_TTL: Duration = Duration::from_secs(10 * 60);

fn is_quic(a: &Multiaddr) -> bool {
    a.iter().any(|p| matches!(p, Protocol::QuicV1 | Protocol::Quic))
}

impl Node {
    /// Как я вижу пира x: наблюдаемые адреса соединений + его собственные из кеша.
    pub(crate) fn seen_of(&self, x: &PeerId) -> Seen {
        let mut addrs: Vec<String> = vec![];
        let add = |a: &Multiaddr, v: &mut Vec<String>| {
            let s = strip_peer(a.clone(), x).to_string();
            if !v.contains(&s) {
                v.push(s);
            }
        };
        if let Some(c) = self.conns.get(x) {
            for (a, dialer) in c.values() {
                if is_circuit(a) || (!self.opts.local_only && is_loopback(a)) {
                    continue;
                }
                // входящий QUIC — это его сокет как его видит интернет (дырка в NAT);
                // входящий TCP — случайный порт, по нему не дозвониться
                if *dialer || is_quic(a) {
                    add(a, &mut addrs);
                }
            }
        }
        if let Some(pc) = self.st.peers.get(&x.to_string()) {
            for a in pc.addrs.iter().take(8) {
                if let Ok(m) = a.parse::<Multiaddr>() {
                    add(&m, &mut addrs);
                }
            }
        }
        addrs.truncate(12);
        Seen { peer: x.to_string(), addrs, hop: self.reserved.contains(x) && self.swarm.behaviour().relay.is_enabled() }
    }

    /// Адрес «через помощника»: …/p2p/helper/p2p-circuit/p2p/x (соединение с помощником уже есть).
    pub(crate) fn circuit_via(&self, helper: &PeerId, x: &PeerId) -> Option<Multiaddr> {
        let c = self.conns.get(helper)?;
        let (a, _) = c.values().filter(|(a, _)| !is_circuit(a)).max_by_key(|(a, d)| (*d, crate::node::is_public(a)))?;
        Some(strip_peer(a.clone(), helper).with(Protocol::P2p(*helper)).with(Protocol::P2pCircuit).with(Protocol::P2p(*x)))
    }

    /// Звонок по свежим адресам: не жду, пока повиснет старый звонок по устаревшему кешу.
    pub(crate) fn dial_fresh(&mut self, p: PeerId, fresh: Vec<Multiaddr>) {
        if p == self.me || self.connected(&p) {
            return;
        }
        let mut seen = HashSet::new();
        let addrs: Vec<Multiaddr> = fresh
            .into_iter()
            .map(|a| strip_peer(a, &p))
            .filter(|a| self.opts.local_only || !is_loopback(a))
            .filter(|a| seen.insert(a.to_string()))
            .collect();
        if addrs.is_empty() {
            return;
        }
        self.dialing.insert(p, Instant::now());
        let o = DialOpts::peer_id(p).condition(PeerCondition::Disconnected).addresses(addrs).build();
        if let Err(e) = self.swarm.dial(o) {
            tracing::debug!("dial+ {p}: {e}");
        }
    }

    /// Мне рассказали, где сейчас x (ответ Seen или встречное Intro).
    pub(crate) fn on_seen(&mut self, helper: PeerId, s: Seen) {
        let Ok(x) = s.peer.parse::<PeerId>() else { return };
        if x == self.me || x == helper || self.connected(&x) || !self.known(&x) || self.st.blocked.contains_key(&s.peer) {
            return;
        }
        let mut addrs: Vec<Multiaddr> =
            s.addrs.iter().filter_map(|a| a.parse::<Multiaddr>().ok()).filter(|a| !is_circuit(a)).collect();
        if s.hop {
            if let Some(c) = self.circuit_via(&helper, &x) {
                addrs.push(c);
            }
        }
        if addrs.is_empty() {
            return;
        }
        self.intros.0 += 1;
        tracing::info!("знакомство: {} подсказал, где {} ({} адр., цепочка: {})", short(&helper.to_string()), short(&s.peer), addrs.len(), s.hop);
        self.dial_n.remove(&x);
        self.dial_fresh(x, addrs);
    }

    /// Кого из моих нет в сети — их и спрошу у помощника (сначала друзья).
    fn missing(&self, except: &PeerId) -> Vec<String> {
        let mut w: Vec<PeerId> = self.wanted().into_iter().filter(|p| p != except && !self.connected(p)).collect();
        w.sort_by_key(|p| (!self.is_friend(&p.to_string()), p.to_string()));
        w.into_iter().take(64).map(|p| p.to_string()).collect()
    }

    /// Спросить помощника «кого из них видишь». force — без антиспама (свежий помощник).
    pub(crate) fn seek_via(&mut self, helper: PeerId, force: bool) {
        let Some(o) = self.online.get(&helper) else { return };
        if o.lvl < LEVEL {
            return;
        }
        if !force && self.seek_sent.get(&helper).map(|t| t.elapsed() < Duration::from_secs(5)).unwrap_or(false) {
            return;
        }
        let want = self.missing(&helper);
        if want.is_empty() {
            return;
        }
        self.seek_sent.insert(helper, Instant::now());
        self.send(helper, Req::Seek { want }, Pend::Seek);
    }

    /// Я — помощник: меня спросили, кого я вижу.
    pub(crate) fn on_seek(&mut self, peer: PeerId, want: Vec<String>) -> Resp {
        if !self.known(&peer) || !self.online.contains_key(&peer) {
            return Resp::Err { e: "не знакомы".into() };
        }
        let now = Instant::now();
        let mut found = vec![];
        for w in want.into_iter().take(64) {
            let Ok(x) = w.parse::<PeerId>() else { continue };
            if x == self.me || x == peer {
                continue;
            }
            if self.online.contains_key(&x) {
                found.push(self.seen_of(&x));
                self.introduce(x, peer, now);
            } else if self.known(&x) {
                let m = self.seekers.entry(x).or_default();
                if m.len() < 64 {
                    m.insert(peer, now);
                }
            }
        }
        Resp::Seen { found }
    }

    /// Встречное знакомство: x узнаёт, где a (оба звонят друг другу одновременно).
    fn introduce(&mut self, x: PeerId, a: PeerId, now: Instant) {
        let lvl = self.online.get(&x).map(|o| o.lvl).unwrap_or(0);
        if lvl >= LEVEL {
            let s = self.seen_of(&a);
            self.send(x, Req::Intro { seen: s }, Pend::Other);
        }
        self.intros.1 += 1;
        let v = self.intro_recent.entry(x).or_default();
        v.retain(|(p, t)| *p != a && now.duration_since(*t) < Duration::from_secs(90));
        v.push((a, now));
    }

    /// x только что появился у меня — знакомлю его со всеми, кто его ждал.
    pub(crate) fn serve_seekers(&mut self, x: PeerId) {
        let Some(m) = self.seekers.remove(&x) else { return };
        let now = Instant::now();
        let xs = self.seen_of(&x);
        let mut n = 0;
        for (a, t) in m {
            if now.duration_since(t) > SEEK_TTL || !self.online.contains_key(&a) {
                continue;
            }
            if self.online.get(&a).map(|o| o.lvl >= LEVEL).unwrap_or(false) {
                self.send(a, Req::Intro { seen: xs.clone() }, Pend::Other);
            }
            self.introduce(x, a, now);
            n += 1;
        }
        if n > 0 {
            tracing::info!("познакомил {} с {n} ждавшими", short(&x.to_string()));
        }
    }

    /// x зарезервировался на моём ретрансляторе — тем, с кем недавно знакомил, даю цепочку.
    pub(crate) fn on_reserved(&mut self, x: PeerId) {
        self.reserved.insert(x);
        let now = Instant::now();
        let Some(v) = self.intro_recent.get(&x).cloned() else { return };
        let xs = self.seen_of(&x);
        for (a, t) in v {
            if now.duration_since(t) < Duration::from_secs(90) && self.online.get(&a).map(|o| o.lvl >= LEVEL).unwrap_or(false) {
                self.send(a, Req::Intro { seen: xs.clone() }, Pend::Other);
            }
        }
    }

    /// Раз в тик: чищу старые просьбы и переспрашиваю помощников, пока кого-то не хватает.
    pub(crate) fn tick_intro(&mut self, now: Instant) {
        self.seekers.retain(|_, m| {
            m.retain(|_, t| now.duration_since(*t) < SEEK_TTL);
            !m.is_empty()
        });
        self.intro_recent.retain(|_, v| {
            v.retain(|(_, t)| now.duration_since(*t) < Duration::from_secs(90));
            !v.is_empty()
        });
        // первые минуты переспрашиваю чаще — все только что запустились
        let every = if self.started.elapsed() < Duration::from_secs(180) { 20 } else { 120 };
        let helpers: Vec<PeerId> = self
            .online
            .iter()
            .filter(|(p, o)| o.lvl >= LEVEL && self.seek_sent.get(p).map(|t| now.duration_since(*t) > Duration::from_secs(every)).unwrap_or(true))
            .map(|(p, _)| *p)
            .collect();
        for h in helpers {
            self.seek_via(h, false);
        }
    }
}
