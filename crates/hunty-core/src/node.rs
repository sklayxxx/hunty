//! Узел Hunty: один таск владеет Swarm и Store — без локов и гонок.
use crate::proto::*;
use crate::store::*;
use crate::util::*;
use anyhow::Result;
use futures::StreamExt;
use libp2p::{
    autonat, dcutr, identify,
    identity::Keypair,
    kad, mdns,
    multiaddr::Protocol,
    noise, ping, relay,
    request_response::{self, OutboundRequestId, ProtocolSupport},
    swarm::{
        behaviour::toggle::Toggle,
        dial_opts::{DialOpts, PeerCondition},
        ConnectionId, NetworkBehaviour, SwarmEvent,
    },
    tcp, upnp, yamux, Multiaddr, PeerId, StreamProtocol, Swarm,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
const HOP: &str = "/libp2p/circuit/relay/0.2.0/hop";
/// Публичный IPFS DHT — точки входа (как у kubo).
const BOOT: &[&str] = &[
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
    "/dnsaddr/va1.bootstrap.libp2p.io/p2p/12D3KooWKnDdG3iXw9eTFijk3EWSunZcFi54Zka4wmtqtt6rPxc8",
    "/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ",
    "/ip4/104.131.131.82/udp/4001/quic-v1/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ",
];

/// Переопределения из командной строки / тестов.
#[derive(Clone, Debug, Default)]
pub struct Opts {
    pub mdns: Option<bool>,
    pub dht: Option<bool>,
    pub upnp: Option<bool>,
    pub relay_server: Option<bool>,
    pub port: Option<u16>,
    /// слушать только 127.0.0.1 (e2e-тесты на одной машине)
    pub local_only: bool,
}

pub type Cmd = (Value, oneshot::Sender<Result<Value, String>>);

#[derive(NetworkBehaviour)]
pub struct Behaviour {
    pub relay_client: relay::client::Behaviour,
    pub relay: Toggle<relay::Behaviour>,
    pub identify: identify::Behaviour,
    pub ping: ping::Behaviour,
    pub kad: Toggle<kad::Behaviour<kad::store::MemoryStore>>,
    pub mdns: Toggle<mdns::tokio::Behaviour>,
    pub autonat: autonat::Behaviour,
    pub dcutr: dcutr::Behaviour,
    pub upnp: Toggle<upnp::tokio::Behaviour>,
    pub rr: request_response::json::Behaviour<Req, Resp>,
}

pub(crate) struct Online {
    #[allow(dead_code)] // пригодится для «в сети с …» в профиле
    pub since: u64,
    pub rtt: Option<u32>,
    pub relay: bool,
    pub rtt_sent: Option<u32>,
    /// уровень протокола (2 — умеет знакомить: Seek/Intro)
    pub lvl: u8,
    /// держит ПК сервером для друзей
    pub server: bool,
    /// до него можно достучаться напрямую (белый IP / UPnP) — или он сервер
    pub hub: bool,
}

/// Что пир рассказал о себе в Hello (кроме профиля и хат).
#[derive(Clone, Copy, Default)]
pub(crate) struct Caps {
    pub relay: bool,
    pub lvl: u8,
    pub server: bool,
    pub hub: bool,
}

pub(crate) enum Pend {
    Hello,
    Whois,
    Find(String),
    /// проверка «занят ли ник»: спрашиваю того, кто его опубликовал
    Check(String),
    Join(String),
    Sync(String),
    Seek,
    Other,
}

#[derive(Clone)]
pub(crate) enum Lookup {
    Peer(PeerId),
    Room(String),
    Nick(String),
    Check(String),
}

/// Проверка ника на уникальность через DHT (без серверов — «насколько видно сети»).
pub(crate) struct NickCheck {
    pub started: Instant,
    /// кто опубликовал этот ник и ещё не ответил «у меня другой»
    pub providers: HashSet<PeerId>,
    pub query_done: Option<Instant>,
    /// free | taken | maybe
    pub done: Option<String>,
    pub peer: String,
    pub at: Instant,
    /// проверяю свой же ник (после регистрации без сети)
    pub own: bool,
    /// сколько DHT-запросов ещё идёт (ключи nick и nickreg)
    pub queries: u8,
}

pub(crate) struct RelayUse {
    pub listener: libp2p::core::transport::ListenerId,
    pub ok: bool,
    pub logged: bool,
    pub at: Instant,
    /// адрес ретранслятора (без /p2p-circuit) — чтобы запомнить удачный
    pub addr: Multiaddr,
}

pub struct Node {
    pub(crate) swarm: Swarm<Behaviour>,
    pub(crate) key: Keypair,
    pub(crate) me: PeerId,
    pub(crate) me_s: String,
    pub(crate) st: Store,
    pub(crate) opts: Opts,
    pub(crate) tx: mpsc::UnboundedSender<Value>,
    pub(crate) allow: Arc<RwLock<HashSet<PeerId>>>,
    pub(crate) online: HashMap<PeerId, Online>,
    pub(crate) conns: HashMap<PeerId, HashMap<ConnectionId, (Multiaddr, bool)>>,
    pub(crate) pending: HashMap<OutboundRequestId, Pend>,
    pub(crate) hello_inflight: HashSet<PeerId>,
    pub(crate) dialing: HashMap<PeerId, Instant>,
    pub(crate) lookups: HashMap<String, Instant>,
    pub(crate) lookup_q: HashMap<kad::QueryId, Lookup>,
    pub(crate) join_cands: HashSet<PeerId>,
    pub(crate) join_sent: HashMap<String, Instant>,
    pub(crate) hunty_peers: HashSet<PeerId>,
    /// кого спросить «кто ты» после подключения (поиск по нику)
    pub(crate) find_want: HashMap<PeerId, (String, Instant)>,
    pub(crate) check_want: HashMap<PeerId, (String, Instant)>,
    pub(crate) checks: HashMap<String, NickCheck>,
    pub(crate) ui_log: (Instant, u32),
    pub(crate) lan: HashMap<PeerId, Vec<Multiaddr>>,
    pub(crate) lan_probed: HashSet<PeerId>,
    pub(crate) nearby: BTreeMap<String, Profile>,
    pub(crate) nat: String,
    pub(crate) upnp_state: String,
    pub(crate) relays: HashMap<PeerId, RelayUse>,
    pub(crate) relay_cands: HashMap<PeerId, Vec<Multiaddr>>,
    pub(crate) relay_bad: HashSet<PeerId>,
    pub(crate) voice: Option<(String, VoiceState)>,
    pub(crate) voices: HashMap<String, HashMap<String, VoiceState>>,
    pub(crate) bootstrapped: bool,
    pub(crate) last_boot: Option<Instant>,
    pub(crate) last_provide: Option<Instant>,
    pub(crate) provide_n: u32,
    pub(crate) addr_dirty: Option<Instant>,
    pub(crate) last_hb: Instant,
    pub(crate) peers_dirty: bool,
    pub(crate) started: Instant,
    pub(crate) net_sig: String,
    pub(crate) quit: bool,
    /// мини-сервер знакомств: кого ищут (цель → кто ищет и когда спросил)
    pub(crate) seekers: HashMap<PeerId, HashMap<PeerId, Instant>>,
    /// недавно познакомил: цель → [(кто искал, когда)] — повторю с цепочкой, когда цель зарезервируется
    pub(crate) intro_recent: HashMap<PeerId, Vec<(PeerId, Instant)>>,
    /// когда последний раз спрашивал помощника «кого видишь»
    pub(crate) seek_sent: HashMap<PeerId, Instant>,
    /// у кого резерв на моём ретрансляторе
    pub(crate) reserved: HashSet<PeerId>,
    /// сколько раз подряд не дозвонился (для расписания попыток)
    pub(crate) dial_n: HashMap<PeerId, u32>,
    /// пиров в таблице DHT (поиск можно начинать, не дожидаясь полного bootstrap)
    pub(crate) routing_n: usize,
    /// сколько раз меня познакомили и сколько раз познакомил я
    pub(crate) intros: (u32, u32),
    /// режим «сервер для друзей» (из конфига при старте)
    pub(crate) server: bool,
    /// какую «прямую достижимость» (хаб) я уже рассказал друзьям в Hello
    pub(crate) hub_told: bool,
    /// отказал в заявке / удалил из друзей → с какого момента (его часы для заявки, мои — для удаления) не верю его «хочу дружить»:
    /// повтор старой заявки или авто-переспрос после удаления получает «нет», а не всплывает заявкой снова
    pub(crate) declined: HashMap<String, u64>,
}

fn load_key(dir: &std::path::Path) -> Result<Keypair> {
    let p = dir.join("identity.key");
    if let Ok(b) = std::fs::read(&p) {
        if let Ok(k) = Keypair::from_protobuf_encoding(&b) {
            return Ok(k);
        }
        let _ = std::fs::rename(&p, p.with_extension("bad"));
    }
    let k = Keypair::generate_ed25519();
    write_atomic(&p, &k.to_protobuf_encoding()?)?;
    Ok(k)
}

pub fn ip_of(a: &Multiaddr) -> Option<IpAddr> {
    a.iter().find_map(|p| match p {
        Protocol::Ip4(i) => Some(IpAddr::V4(i)),
        Protocol::Ip6(i) => Some(IpAddr::V6(i)),
        _ => None,
    })
}
pub fn is_circuit(a: &Multiaddr) -> bool {
    a.iter().any(|p| matches!(p, Protocol::P2pCircuit))
}
pub fn is_loopback(a: &Multiaddr) -> bool {
    ip_of(a).map(|i| i.is_loopback()).unwrap_or(false)
}
pub fn is_private(a: &Multiaddr) -> bool {
    match ip_of(a) {
        Some(IpAddr::V4(i)) => i.is_private() || i.is_link_local() || i.octets()[0] == 100 && (i.octets()[1] & 0xc0) == 64,
        Some(IpAddr::V6(i)) => (i.segments()[0] & 0xfe00) == 0xfc00 || (i.segments()[0] & 0xffc0) == 0xfe80,
        None => false,
    }
}
pub fn is_public(a: &Multiaddr) -> bool {
    match ip_of(a) {
        Some(i) => !i.is_loopback() && !i.is_unspecified() && !is_private(a) && !i.is_multicast(),
        None => a.iter().any(|p| matches!(p, Protocol::Dns(_) | Protocol::Dns4(_) | Protocol::Dns6(_) | Protocol::Dnsaddr(_))),
    }
}
pub(crate) fn strip_peer(mut a: Multiaddr, p: &PeerId) -> Multiaddr {
    if let Some(Protocol::P2p(x)) = a.iter().last() {
        if x == *p {
            a.pop();
        }
    }
    a
}
fn relay_of(a: &Multiaddr) -> Option<PeerId> {
    let mut last = None;
    for p in a.iter() {
        match p {
            Protocol::P2p(id) => last = Some(id),
            Protocol::P2pCircuit => return last,
            _ => {}
        }
    }
    None
}

pub async fn spawn(dir: PathBuf, opts: Opts) -> Result<(mpsc::UnboundedSender<Cmd>, mpsc::UnboundedReceiver<Value>)> {
    std::fs::create_dir_all(&dir)?;
    let key = load_key(&dir)?;
    let mut st = Store::open(&dir)?;
    if st.config.port == 0 {
        st.config.port = 20000 + (rand::random::<u16>() % 40000);
        st.save_config();
    }
    let cfg = st.config.clone();
    let use_mdns = opts.mdns.unwrap_or(cfg.mdns);
    let use_dht = opts.dht.unwrap_or(cfg.dht);
    let use_upnp = opts.upnp.unwrap_or(cfg.upnp) && !opts.local_only;
    // в локальном режиме (тесты) сервер тоже можно — просто без UPnP
    let server = cfg.server;
    // сервер для друзей всегда ретранслирует — в этом его смысл
    let use_relay = opts.relay_server.unwrap_or(cfg.relay_server) || server;
    let allow: Arc<RwLock<HashSet<PeerId>>> = Default::default();
    let allow_b = allow.clone();

    let mut swarm = libp2p::SwarmBuilder::with_existing_identity(key.clone())
        .with_tokio()
        .with_tcp(tcp::Config::default().nodelay(true), noise::Config::new, yamux::Config::default)?
        .with_quic()
        .with_dns()?
        .with_relay_client(noise::Config::new, yamux::Config::default)?
        .with_behaviour(move |key, relay_client| {
            let peer = key.public().to_peer_id();
            let relay = if use_relay {
                let mut rc = relay::Config::default();
                // сервер держит с запасом: вся компания друзей и их звонки
                let k = if server { 4 } else { 1 };
                rc.max_reservations = 32 * k;
                rc.max_reservations_per_peer = 4;
                rc.max_circuits = 32 * k;
                rc.max_circuits_per_peer = 8 * k;
                rc.max_circuit_duration = Duration::from_secs(60 * 60 * k as u64);
                rc.max_circuit_bytes = (1u64 << 30) * k as u64;
                let a1 = allow_b.clone();
                let a2 = allow_b.clone();
                rc.reservation_rate_limiters = vec![Box::new(move |p: PeerId, _a: &Multiaddr, _n: Instant| {
                    a1.read().map(|s| s.contains(&p)).unwrap_or(false)
                })];
                rc.circuit_src_rate_limiters = vec![Box::new(move |p: PeerId, _a: &Multiaddr, _n: Instant| {
                    a2.read().map(|s| s.contains(&p)).unwrap_or(false)
                })];
                Some(relay::Behaviour::new(peer, rc))
            } else {
                None
            };
            let kad = if use_dht {
                let mut kc = kad::Config::new(kad::PROTOCOL_NAME);
                kc.set_query_timeout(Duration::from_secs(60));
                let mut k = kad::Behaviour::with_config(peer, kad::store::MemoryStore::new(peer), kc);
                k.set_mode(Some(kad::Mode::Client));
                Some(k)
            } else {
                None
            };
            let mdns = if use_mdns { Some(mdns::tokio::Behaviour::new(mdns::Config::default(), peer)?) } else { None };
            let ac = autonat::Config {
                boot_delay: Duration::from_secs(3),
                retry_interval: Duration::from_secs(30),
                refresh_interval: Duration::from_secs(5 * 60),
                only_global_ips: true,
                ..Default::default()
            };
            let rr = request_response::Behaviour::with_codec(
                request_response::json::codec::Codec::<Req, Resp>::default()
                    .set_request_size_maximum(12 << 20)
                    .set_response_size_maximum(64 << 20),
                [(StreamProtocol::new(PROTOCOL), ProtocolSupport::Full)],
                request_response::Config::default()
                    .with_request_timeout(Duration::from_secs(30))
                    .with_max_concurrent_streams(512),
            );
            Ok(Behaviour {
                relay_client,
                relay: Toggle::from(relay),
                identify: identify::Behaviour::new(
                    identify::Config::new("/hunty/0.1.0".into(), key.public())
                        .with_agent_version(format!("hunty/{VERSION}"))
                        .with_push_listen_addr_updates(true),
                ),
                ping: ping::Behaviour::new(ping::Config::new().with_interval(Duration::from_secs(10))),
                kad: Toggle::from(kad),
                mdns: Toggle::from(mdns),
                autonat: autonat::Behaviour::new(peer, ac),
                dcutr: dcutr::Behaviour::new(peer),
                upnp: Toggle::from(use_upnp.then(upnp::tokio::Behaviour::default)),
                rr,
            })
        })?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(75)))
        .build();

    let port = opts.port.unwrap_or(cfg.port);
    let hosts: &[&str] = if opts.local_only { &["/ip4/127.0.0.1"] } else { &["/ip4/0.0.0.0", "/ip6/::"] };
    for h in hosts {
        for (proto, p) in [("tcp", port), ("udp", port)] {
            let tail = if proto == "tcp" { format!("/tcp/{p}") } else { format!("/udp/{p}/quic-v1") };
            let a: Multiaddr = format!("{h}{tail}").parse()?;
            if swarm.listen_on(a.clone()).is_err() {
                let a0: Multiaddr = format!("{h}{}", if proto == "tcp" { "/tcp/0".to_string() } else { "/udp/0/quic-v1".to_string() }).parse()?;
                let _ = swarm.listen_on(a0);
            }
        }
    }
    if let Some(k) = swarm.behaviour_mut().kad.as_mut() {
        for b in BOOT {
            if let Ok(a) = b.parse::<Multiaddr>() {
                if let Some(Protocol::P2p(p)) = a.iter().last() {
                    k.add_address(&p, a.clone());
                }
            }
        }
    }

    let me = *swarm.local_peer_id();
    let (tx, rx) = mpsc::unbounded_channel();
    let (ctx, crx) = mpsc::unbounded_channel::<Cmd>();
    let node = Node {
        swarm,
        key,
        me,
        me_s: me.to_string(),
        st,
        opts,
        tx,
        allow,
        online: HashMap::new(),
        conns: HashMap::new(),
        pending: HashMap::new(),
        hello_inflight: HashSet::new(),
        dialing: HashMap::new(),
        lookups: HashMap::new(),
        lookup_q: HashMap::new(),
        join_cands: HashSet::new(),
        join_sent: HashMap::new(),
        hunty_peers: HashSet::new(),
        find_want: HashMap::new(),
        check_want: HashMap::new(),
        checks: HashMap::new(),
        ui_log: (Instant::now(), 0),
        lan: HashMap::new(),
        lan_probed: HashSet::new(),
        nearby: BTreeMap::new(),
        nat: "unknown".into(),
        upnp_state: if use_upnp { "ищу роутер".into() } else { "выключен".into() },
        relays: HashMap::new(),
        relay_cands: HashMap::new(),
        relay_bad: HashSet::new(),
        voice: None,
        voices: HashMap::new(),
        bootstrapped: false,
        last_boot: None,
        last_provide: None,
        provide_n: 0,
        addr_dirty: None,
        last_hb: Instant::now(),
        peers_dirty: false,
        started: Instant::now(),
        net_sig: String::new(),
        quit: false,
        seekers: HashMap::new(),
        intro_recent: HashMap::new(),
        seek_sent: HashMap::new(),
        reserved: HashSet::new(),
        dial_n: HashMap::new(),
        routing_n: 0,
        intros: (0, 0),
        server,
        hub_told: false,
        declined: HashMap::new(),
    };
    node.refresh_allow();
    tracing::info!("hunty {VERSION}: я {}", node.me);
    tokio::spawn(node.run(crx));
    Ok((ctx, rx))
}

impl Node {
    async fn run(mut self, mut rx: mpsc::UnboundedReceiver<Cmd>) {
        let mut tick = tokio::time::interval(Duration::from_secs(3));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                ev = self.swarm.select_next_some() => self.on_swarm(ev),
                cmd = rx.recv() => match cmd {
                    Some((v, reply)) => {
                        let r = self.on_cmd(v);
                        let _ = reply.send(r);
                        if self.quit { break; }
                    }
                    None => break,
                },
                _ = tick.tick() => self.on_tick(),
            }
        }
        self.st.save_peers();
        self.st.save_rooms();
        tracing::info!("узел остановлен");
    }

    // ---------- помощники ----------
    pub(crate) fn emit(&self, ev: &str, mut v: Value) {
        if let Value::Object(ref mut m) = v {
            m.insert("ev".into(), Value::String(ev.into()));
        }
        let _ = self.tx.send(v);
    }
    pub(crate) fn log(&self, k: &str, text: impl Into<String>) {
        let text = text.into();
        tracing::info!("[{k}] {text}");
        self.emit("log", json!({ "k": k, "text": text }));
    }
    pub(crate) fn profile(&self) -> Profile {
        self.st.profile.clone().unwrap_or_default()
    }
    pub(crate) fn nick(&self, peer: &str) -> String {
        if peer == self.me_s {
            return self.profile().nick;
        }
        if let Some(f) = self.st.friends.get(peer) {
            if !f.profile.nick.is_empty() {
                return f.profile.nick.clone();
            }
        }
        for r in self.st.rooms.values() {
            if let Some(m) = r.members.get(peer) {
                if !m.nick.is_empty() {
                    return m.nick.clone();
                }
            }
        }
        if let Some(p) = self.nearby.get(peer) {
            return p.nick.clone();
        }
        short(peer)
    }
    pub(crate) fn is_friend(&self, peer: &str) -> bool {
        self.st.friends.get(peer).map(|f| f.state == FriendState::Friend).unwrap_or(false)
    }
    pub(crate) fn connected(&self, p: &PeerId) -> bool {
        self.conns.contains_key(p)
    }
    pub(crate) fn via(&self, p: &PeerId) -> &'static str {
        let Some(c) = self.conns.get(p) else { return "off" };
        if c.values().all(|(a, _)| is_circuit(a)) {
            "relay"
        } else if c.values().any(|(a, _)| !is_circuit(a) && (is_private(a) || is_loopback(a))) {
            "lan"
        } else {
            "direct"
        }
    }
    pub(crate) fn send(&mut self, peer: PeerId, req: Req, pend: Pend) {
        let id = self.swarm.behaviour_mut().rr.send_request(&peer, req);
        self.pending.insert(id, pend);
    }
    /// Пир, с которым мне есть о чём говорить.
    pub(crate) fn known(&self, p: &PeerId) -> bool {
        let s = p.to_string();
        self.st.friends.contains_key(&s)
            || self.st.rooms.values().any(|r| (!r.pending && r.is_member(&s)) || (r.pending && r.inviter == s))
            || self.join_cands.contains(p)
    }
    /// С кем держу соединение постоянно.
    pub(crate) fn wanted(&self) -> Vec<PeerId> {
        let mut set: HashSet<String> = HashSet::new();
        for f in self.st.friends.values() {
            if f.state != FriendState::Incoming {
                set.insert(f.peer.clone());
            }
        }
        for r in self.st.rooms.values() {
            if r.pending {
                set.insert(r.inviter.clone());
            } else {
                for m in r.live_members() {
                    if r.kind == "dm" && self.st.blocked.contains_key(&m.peer) {
                        continue;
                    }
                    set.insert(m.peer.clone());
                }
            }
        }
        set.remove(&self.me_s);
        set.iter().filter_map(|s| s.parse().ok()).collect()
    }
    pub(crate) fn refresh_allow(&self) {
        let mut s = HashSet::new();
        for f in self.st.friends.values() {
            if f.state == FriendState::Friend {
                if let Ok(p) = f.peer.parse() {
                    s.insert(p);
                }
            }
        }
        for r in self.st.rooms.values() {
            for m in r.live_members() {
                if let Ok(p) = m.peer.parse() {
                    s.insert(p);
                }
            }
        }
        if let Ok(mut w) = self.allow.write() {
            *w = s;
        }
    }
    pub(crate) fn online_members(&self, room: &str) -> Vec<PeerId> {
        let Some(r) = self.st.rooms.get(room) else { return vec![] };
        r.live_members()
            .filter(|m| m.peer != self.me_s)
            .filter_map(|m| m.peer.parse::<PeerId>().ok())
            .filter(|p| self.online.contains_key(p))
            .collect()
    }
    pub(crate) fn bcast(&mut self, room: &str, req: Req) {
        for t in self.online_members(room) {
            self.send(t, req.clone(), Pend::Other);
        }
    }
    /// DHT годится для поиска, как только в таблице набралось пиров —
    /// не жду полного bootstrap (он бывает и по полминуты).
    pub(crate) fn dht_ready(&self) -> bool {
        self.swarm.behaviour().kad.is_enabled() && (self.bootstrapped || self.routing_n >= 16)
    }
    /// Пора ли снова звонить: первые попытки часто, потом реже.
    /// Хаб (друг с белым IP / UPnP или сервер) — каждые 5 секунд первые полчаса, потом раз в 15:
    /// звонок на живой адрес дешёвый, а друг появится в сети через секунды после запуска.
    pub(crate) fn dial_due(&self, p: &PeerId, now: Instant) -> bool {
        let Some(t) = self.dialing.get(p) else { return true };
        let n = self.dial_n.get(p).copied().unwrap_or(0);
        let hub = self.st.peers.get(&p.to_string()).map(|c| c.server || c.hub).unwrap_or(false);
        let friend = self.is_friend(&p.to_string());
        let secs = match n {
            0..=3 => 3,
            _ if hub && n < 360 => 5,
            _ if hub => 15,
            4..=6 => 6,
            7..=9 => 12,
            10..=15 => 20,
            _ if friend => 20,
            _ => 30,
        };
        now.duration_since(*t) >= Duration::from_secs(secs)
    }
    pub(crate) fn remember(&mut self, p: &PeerId, addrs: Vec<Multiaddr>) {
        if *p == self.me || !(self.known(p) || self.hunty_peers.contains(p)) {
            return;
        }
        let e = self.st.peers.entry(p.to_string()).or_default();
        let mut v: Vec<String> = addrs
            .into_iter()
            .map(|a| strip_peer(a, p))
            .filter(|a| ip_of(a).map(|i| !i.is_unspecified()).unwrap_or(true))
            .map(|a| a.to_string())
            .collect();
        for old in e.addrs.iter() {
            if !v.contains(old) {
                v.push(old.clone());
            }
        }
        v.truncate(12);
        if v != e.addrs {
            e.addrs = v;
            self.peers_dirty = true;
        }
        e.seen = now_ms();
    }
    pub(crate) fn dial(&mut self, p: PeerId, extra: &[Multiaddr]) {
        if p == self.me || self.connected(&p) {
            return;
        }
        let ps = p.to_string();
        let mut addrs: Vec<Multiaddr> = extra.to_vec();
        if let Some(l) = self.lan.get(&p) {
            addrs.extend(l.iter().cloned());
        }
        if let Some(c) = self.st.peers.get(&ps) {
            addrs.extend(c.addrs.iter().filter_map(|a| a.parse().ok()));
        }
        if let Some(f) = self.st.friends.get(&ps) {
            addrs.extend(f.hint.iter().filter_map(|a| a.parse().ok()));
        }
        for r in self.st.rooms.values() {
            if r.pending && r.inviter == ps {
                addrs.extend(r.inviter_addrs.iter().filter_map(|a| a.parse().ok()));
            }
        }
        let mut seen = HashSet::new();
        let addrs: Vec<Multiaddr> = addrs
            .into_iter()
            .map(|a| strip_peer(a, &p))
            .filter(|a| self.opts.local_only || !is_loopback(a))
            .filter(|a| seen.insert(a.to_string()))
            .collect();
        self.dialing.insert(p, Instant::now());
        *self.dial_n.entry(p).or_default() += 1;
        let o = DialOpts::peer_id(p)
            .condition(PeerCondition::DisconnectedAndNotDialing)
            .addresses(addrs)
            .extend_addresses_through_behaviour()
            .build();
        if let Err(e) = self.swarm.dial(o) {
            tracing::debug!("dial {p}: {e}");
        }
    }
    pub(crate) fn lookup(&mut self, l: Lookup) {
        if !self.dht_ready() {
            return;
        }
        let (k, key) = match &l {
            Lookup::Peer(p) => (format!("p:{p}"), dht_key("peer", &p.to_string())),
            Lookup::Room(r) => (format!("r:{r}"), dht_key("room", r)),
            Lookup::Nick(n) => (format!("n:{n}"), dht_key("nick", n)),
            Lookup::Check(n) => (format!("c:{n}"), dht_key("nick", n)),
        };
        // первые минуты ищу чаще — друзья как раз запускаются
        let every = if self.started.elapsed() < Duration::from_secs(180) { 15 } else { 45 };
        if self.lookups.get(&k).map(|t| t.elapsed() < Duration::from_secs(every)).unwrap_or(false) || self.lookup_q.len() > 48 {
            return;
        }
        self.lookups.insert(k, Instant::now());
        if let Some(kad) = self.swarm.behaviour_mut().kad.as_mut() {
            let q = kad.get_providers(key);
            self.lookup_q.insert(q, l);
        }
    }
    /// Мои адреса для кодов: публичные, через ретранслятор, в локалке.
    pub(crate) fn my_addrs(&self) -> Vec<String> {
        let mut pubs = vec![];
        let mut circ = vec![];
        let mut lan = vec![];
        for a in self.swarm.external_addresses() {
            if is_circuit(a) {
                circ.push(a.clone())
            } else if is_public(a) {
                pubs.push(a.clone())
            }
        }
        for a in self.swarm.listeners() {
            if is_circuit(a) {
                continue;
            }
            if is_private(a) || (self.opts.local_only && is_loopback(a)) {
                lan.push(a.clone())
            }
        }
        let mut out: Vec<String> = vec![];
        for a in pubs.into_iter().take(2).chain(circ.into_iter().take(2)).chain(lan.into_iter().take(3)) {
            let s = strip_peer(a, &self.me).to_string();
            if !out.contains(&s) {
                out.push(s);
            }
        }
        out
    }
    pub(crate) fn went_offline(&mut self, p: PeerId) {
        self.hello_inflight.remove(&p);
        self.reserved.remove(&p);
        self.seek_sent.remove(&p);
        // вдруг это просто моргнула сеть — перезвоню сразу
        self.dial_n.remove(&p);
        self.dialing.remove(&p);
        let ps = p.to_string();
        if self.online.remove(&p).is_some() {
            self.emit("presence", json!({ "peer": ps, "online": false }));
            let mut gone = vec![];
            for (room, m) in self.voices.iter_mut() {
                if m.remove(&ps).is_some() {
                    gone.push(room.clone());
                }
            }
            for room in gone {
                self.emit("voice", json!({ "room": room, "peer": ps, "state": null }));
            }
            if self.is_friend(&ps) {
                self.log("warn", format!("{} отключился", self.nick(&ps)));
            }
        }
    }
    pub(crate) fn send_hello(&mut self, p: PeerId) {
        if self.st.profile.is_none() || self.hello_inflight.contains(&p) {
            return;
        }
        self.hello_inflight.insert(p);
        let req = self.hello_req(&p);
        self.send(p, req, Pend::Hello);
    }

    // ---------- уникальность ников ----------
    /// Кто из знакомых уже носит этот ник (друзья, участники хат, соседи по локалке).
    pub(crate) fn nick_known(&self, n: &str) -> Option<String> {
        if let Some(f) = self.st.friends.values().find(|f| f.profile.nick == n) {
            return Some(f.peer.clone());
        }
        for r in self.st.rooms.values() {
            if let Some(m) = r.live_members().find(|m| m.nick == n && m.peer != self.me_s) {
                return Some(m.peer.clone());
            }
        }
        self.nearby.iter().find(|(_, p)| p.nick == n).map(|(k, _)| k.clone())
    }

    /// Ищу в DHT, кто опубликовал ник, и спрашиваю каждого «как тебя зовут».
    pub(crate) fn start_check(&mut self, n: &str, own: bool) -> bool {
        if !self.dht_ready() {
            return false;
        }
        let mut qs = vec![];
        if let Some(k) = self.swarm.behaviour_mut().kad.as_mut() {
            qs.push(k.get_providers(dht_key("nick", n)));
            qs.push(k.get_providers(dht_key("nickreg", n)));
        }
        for q in &qs {
            self.lookup_q.insert(*q, Lookup::Check(n.to_string()));
        }
        let now = Instant::now();
        self.checks.insert(
            n.to_string(),
            NickCheck { started: now, providers: HashSet::new(), query_done: None, done: None, peer: String::new(), at: now, own, queries: qs.len() as u8 },
        );
        true
    }

    pub(crate) fn finish_check(&mut self, n: &str, state: &str, peer: &str) {
        let Some(c) = self.checks.get_mut(n) else { return };
        if c.done.is_some() {
            return;
        }
        c.done = Some(state.to_string());
        c.peer = peer.to_string();
        c.at = Instant::now();
        let own = c.own;
        self.emit("nick_status", json!({ "nick": n, "state": state, "peer": peer, "own": own }));
        if own && state == "taken" {
            self.log("warn", format!("ник @{n} уже занят кем-то ещё — смени его в настройках, чтобы вас не путали"));
        }
    }

    fn tick_checks(&mut self, now: Instant) {
        let mut fin = vec![];
        for (n, c) in &self.checks {
            if c.done.is_some() {
                continue;
            }
            let qd = c.query_done.map(|t| now.duration_since(t));
            if c.providers.is_empty() && qd.is_some() {
                fin.push((n.clone(), "free"));
            } else if !c.providers.is_empty() && qd.map(|d| d > Duration::from_secs(12)).unwrap_or(false) {
                // опубликовал кто-то, кто сейчас не отвечает — скорее всего, ник его
                fin.push((n.clone(), "maybe"));
            } else if now.duration_since(c.started) > Duration::from_secs(50) {
                fin.push((n.clone(), if c.providers.is_empty() { "free" } else { "maybe" }));
            }
        }
        for (n, st) in fin {
            self.finish_check(&n, st, "");
        }
        self.checks.retain(|_, c| c.done.is_none() || now.duration_since(c.at) < Duration::from_secs(1800));
        self.check_want.retain(|_, (_, t)| now.duration_since(*t) < Duration::from_secs(60));
        self.find_want.retain(|_, (_, t)| now.duration_since(*t) < Duration::from_secs(120));
    }

    // ---------- события Swarm ----------
    fn on_swarm(&mut self, ev: SwarmEvent<BehaviourEvent>) {
        match ev {
            SwarmEvent::Behaviour(b) => self.on_behaviour(b),
            SwarmEvent::NewListenAddr { address, .. } => {
                tracing::debug!("слушаю {address}");
                if is_circuit(&address) {
                    if let Some(r) = relay_of(&address) {
                        let first = self.relays.get(&r).map(|u| !u.logged).unwrap_or(false);
                        if let Some(u) = self.relays.get_mut(&r) {
                            u.ok = true;
                            u.logged = true;
                        }
                        if first {
                            let n = if self.is_friend(&r.to_string()) { format!("друга {}", self.nick(&r.to_string())) } else { format!("IPFS-узел {}", short(&r.to_string())) };
                            self.log("ok", format!("до меня можно достучаться через ретранслятор: {n}"));
                        }
                    }
                }
                self.addr_dirty = Some(Instant::now());
            }
            SwarmEvent::ListenerClosed { listener_id, .. } => {
                self.relays.retain(|_, r| r.listener != listener_id);
            }
            SwarmEvent::ExternalAddrConfirmed { address } => {
                tracing::info!("внешний адрес подтверждён: {address}");
                self.addr_dirty = Some(Instant::now());
                // меня теперь видно иначе — перезвоню всем, кого ещё нет, не дожидаясь расписания
                self.dial_n.clear();
                self.dialing.clear();
            }
            SwarmEvent::ExternalAddrExpired { .. } => {
                self.addr_dirty = Some(Instant::now());
            }
            SwarmEvent::ConnectionEstablished { peer_id, connection_id, endpoint, .. } => {
                let addr = endpoint.get_remote_address().clone();
                let dialer = endpoint.is_dialer();
                self.conns.entry(peer_id).or_default().insert(connection_id, (addr.clone(), dialer));
                self.dial_n.remove(&peer_id);
                if self.known(&peer_id) {
                    if dialer {
                        self.remember(&peer_id, vec![addr]);
                    }
                    if !self.online.contains_key(&peer_id) {
                        self.send_hello(peer_id);
                    } else {
                        self.presence(&peer_id);
                    }
                    self.try_joins(Some(peer_id));
                }
            }
            SwarmEvent::ConnectionClosed { peer_id, connection_id, num_established, .. } => {
                if let Some(m) = self.conns.get_mut(&peer_id) {
                    m.remove(&connection_id);
                    if m.is_empty() {
                        self.conns.remove(&peer_id);
                    }
                }
                if num_established == 0 {
                    self.conns.remove(&peer_id);
                    self.went_offline(peer_id);
                } else if self.online.contains_key(&peer_id) {
                    self.presence(&peer_id);
                }
            }
            SwarmEvent::OutgoingConnectionError { peer_id: Some(p), error, .. } => {
                if self.known(&p) {
                    tracing::debug!("не дозвонился до {p}: {error}");
                }
            }
            _ => {}
        }
    }

    pub(crate) fn presence(&mut self, p: &PeerId) {
        let via = self.via(p);
        let o = self.online.get(p);
        let rtt = o.and_then(|o| o.rtt);
        self.emit("presence", json!({ "peer": p.to_string(), "online": o.is_some(), "rtt": rtt, "via": via }));
    }

    fn on_behaviour(&mut self, ev: BehaviourEvent) {
        match ev {
            BehaviourEvent::Identify(identify::Event::Received { peer_id, info, .. }) => self.on_identify(peer_id, info),
            BehaviourEvent::Ping(ping::Event { peer, result: Ok(rtt), .. }) => {
                let ms = rtt.as_millis().min(60_000) as u32;
                let mut changed = false;
                if let Some(o) = self.online.get_mut(&peer) {
                    o.rtt = Some(ms);
                    let prev = o.rtt_sent.unwrap_or(0);
                    if o.rtt_sent.is_none() || prev.abs_diff(ms) > 4 {
                        o.rtt_sent = Some(ms);
                        changed = true;
                    }
                }
                if changed {
                    self.presence(&peer);
                }
            }
            BehaviourEvent::Kad(e) => self.on_kad(e),
            BehaviourEvent::Mdns(mdns::Event::Discovered(list)) => {
                let mut peers = HashSet::new();
                for (p, a) in list {
                    if p == self.me {
                        continue;
                    }
                    let v = self.lan.entry(p).or_default();
                    if !v.contains(&a) {
                        v.push(a);
                    }
                    peers.insert(p);
                }
                for p in peers {
                    if self.connected(&p) {
                        continue;
                    }
                    if self.known(&p) || self.lan_probed.insert(p) {
                        self.dial(p, &[]);
                    }
                }
            }
            BehaviourEvent::Mdns(mdns::Event::Expired(list)) => {
                for (p, a) in list {
                    if let Some(v) = self.lan.get_mut(&p) {
                        v.retain(|x| *x != a);
                        if v.is_empty() {
                            self.lan.remove(&p);
                            if self.nearby.remove(&p.to_string()).is_some() {
                                self.emit("nearby", json!({ "peer": p.to_string(), "profile": null }));
                            }
                        }
                    }
                }
            }
            BehaviourEvent::Autonat(autonat::Event::StatusChanged { new, .. }) => {
                let s = match new {
                    autonat::NatStatus::Public(_) => "public",
                    autonat::NatStatus::Private => "private",
                    autonat::NatStatus::Unknown => "unknown",
                };
                if s != self.nat {
                    self.nat = s.into();
                    self.log(
                        if s == "public" { "ok" } else { "warn" },
                        match s {
                            "public" => "NAT: меня видно из интернета напрямую".to_string(),
                            "private" => "NAT: я за роутером — подключаюсь через ретрансляторы и пробиваю дырки".to_string(),
                            _ => "NAT: пока не понял".to_string(),
                        },
                    );
                }
            }
            BehaviourEvent::RelayClient(relay::client::Event::ReservationReqAccepted { relay_peer_id, renewal, .. }) => {
                let mut keep = None;
                if let Some(u) = self.relays.get_mut(&relay_peer_id) {
                    u.ok = true;
                    keep = Some(u.addr.clone());
                }
                if !renewal {
                    tracing::info!("резерв на ретрансляторе {relay_peer_id}");
                    // публичный ретранслятор — запомню: в следующий раз резервируюсь у него первым
                    if let Some(a) = keep.filter(|_| !self.known(&relay_peer_id)) {
                        let full = a.with(Protocol::P2p(relay_peer_id)).to_string();
                        if self.st.relays.first() != Some(&full) {
                            let ps = relay_peer_id.to_string();
                            self.st.relays.retain(|x| !x.ends_with(&ps));
                            self.st.relays.insert(0, full);
                            self.st.relays.truncate(3);
                            self.st.save_relays();
                        }
                    }
                }
                self.addr_dirty = Some(Instant::now());
            }
            BehaviourEvent::Relay(relay::Event::ReservationReqAccepted { src_peer_id, renewed }) => {
                if !renewed && !self.reserved.contains(&src_peer_id) {
                    let n = self.nick(&src_peer_id.to_string());
                    self.log("ok", format!("держу ретранслятор для {n}"));
                }
                self.on_reserved(src_peer_id);
            }
            BehaviourEvent::Relay(relay::Event::ReservationClosed { src_peer_id })
            | BehaviourEvent::Relay(relay::Event::ReservationTimedOut { src_peer_id }) => {
                self.reserved.remove(&src_peer_id);
            }
            BehaviourEvent::Dcutr(dcutr::Event { remote_peer_id, result }) => match result {
                Ok(_) => {
                    let n = self.nick(&remote_peer_id.to_string());
                    self.log("ok", format!("пробил NAT до {n} — теперь напрямую"));
                }
                Err(e) => tracing::debug!("dcutr {remote_peer_id}: {e}"),
            },
            BehaviourEvent::Upnp(e) => {
                let s = match e {
                    upnp::Event::NewExternalAddr { .. } => {
                        self.log("ok", "UPnP: роутер пробросил порт");
                        "порт проброшен"
                    }
                    upnp::Event::GatewayNotFound => "роутер без UPnP",
                    upnp::Event::NonRoutableGateway => "роутер за ещё одним NAT",
                    upnp::Event::ExpiredExternalAddr { .. } => "проброс истёк",
                };
                self.upnp_state = s.into();
            }
            BehaviourEvent::Rr(e) => self.on_rr(e),
            _ => {}
        }
    }

    fn on_identify(&mut self, peer: PeerId, info: identify::Info) {
        let hunty = info.protocols.iter().any(|p| p.as_ref() == PROTOCOL);
        if hunty {
            self.hunty_peers.insert(peer);
            let addrs: Vec<Multiaddr> =
                info.listen_addrs.iter().filter(|a| self.opts.local_only || !is_loopback(a)).cloned().collect();
            self.remember(&peer, addrs);
            if let Some((nick, _)) = self.check_want.remove(&peer) {
                self.send(peer, Req::Whois, Pend::Check(nick));
            }
            if let Some((nick, _)) = self.find_want.remove(&peer) {
                self.send(peer, Req::Whois, Pend::Find(nick));
            } else if self.known(&peer) {
            } else if self.lan.contains_key(&peer) && !self.nearby.contains_key(&peer.to_string()) && self.st.profile.is_some() {
                self.send(peer, Req::Whois, Pend::Whois);
            }
            return;
        }
        if info.protocols.iter().any(|p| *p == kad::PROTOCOL_NAME) {
            if let Some(k) = self.swarm.behaviour_mut().kad.as_mut() {
                for a in info.listen_addrs.iter().filter(|a| is_public(a) && !is_circuit(a)) {
                    k.add_address(&peer, a.clone());
                }
            }
        }
        if info.protocols.iter().any(|p| p.as_ref() == HOP) && self.relay_cands.len() < 64 {
            let pubs: Vec<Multiaddr> =
                info.listen_addrs.into_iter().filter(|a| is_public(a) && !is_circuit(a) && ip_of(a).map(|i| i.is_ipv4()).unwrap_or(false)).collect();
            if !pubs.is_empty() {
                self.relay_cands.insert(peer, pubs);
            }
        }
    }

    fn on_kad(&mut self, e: kad::Event) {
        if let kad::Event::RoutingUpdated { is_new_peer: true, .. } = e {
            self.routing_n += 1;
            return;
        }
        if let kad::Event::OutboundQueryProgressed { id, result, step, .. } = e {
            match result {
                kad::QueryResult::Bootstrap(Ok(_)) => {
                    if !self.bootstrapped {
                        self.bootstrapped = true;
                        self.log("ok", "DHT: подключился к публичной сети IPFS");
                        // регистрировался без сети — проверю, не занял ли кто мой ник раньше
                        if let Some(n) = self.st.profile.as_ref().map(|p| p.nick.clone()) {
                            self.start_check(&n, true);
                        }
                    }
                }
                kad::QueryResult::GetProviders(Ok(kad::GetProvidersOk::FoundProviders { providers, .. })) => {
                    if let Some(l) = self.lookup_q.get(&id).cloned() {
                        tracing::info!("DHT providers: {} шт", providers.len());
                        match l {
                            Lookup::Peer(t) => {
                                if providers.contains(&t) && !self.connected(&t) {
                                    tracing::info!("DHT нашёл {t}");
                                    self.dial(t, &[]);
                                }
                            }
                            Lookup::Nick(n) => {
                                for p in providers {
                                    if p == self.me {
                                        continue;
                                    }
                                    if self.connected(&p) && self.hunty_peers.contains(&p) {
                                        self.send(p, Req::Whois, Pend::Find(n.clone()));
                                    } else {
                                        self.find_want.insert(p, (n.clone(), Instant::now()));
                                        self.dial(p, &[]);
                                    }
                                }
                            }
                            Lookup::Room(_) => {
                                for p in providers {
                                    if p != self.me && !self.connected(&p) {
                                        self.join_cands.insert(p);
                                        self.dial(p, &[]);
                                    }
                                }
                            }
                            Lookup::Check(n) => {
                                for p in providers {
                                    if p == self.me || self.checks.get(&n).map(|c| c.done.is_some()).unwrap_or(true) {
                                        continue;
                                    }
                                    if let Some(c) = self.checks.get_mut(&n) {
                                        c.providers.insert(p);
                                    }
                                    if self.connected(&p) && self.hunty_peers.contains(&p) {
                                        self.send(p, Req::Whois, Pend::Check(n.clone()));
                                    } else {
                                        self.check_want.insert(p, (n.clone(), Instant::now()));
                                        self.dial(p, &[]);
                                    }
                                }
                            }
                        }
                    }
                }
                kad::QueryResult::StartProviding(r) => tracing::info!("DHT provide: {:?}", r.as_ref().map(|_| ()).map_err(|e| e.to_string())),
                kad::QueryResult::GetProviders(Ok(kad::GetProvidersOk::FinishedWithNoAdditionalRecord { .. })) => {
                    tracing::info!("DHT get_providers: конец поиска (шаг {})", step.count);
                }
                kad::QueryResult::GetProviders(Err(e)) => tracing::info!("DHT get_providers ошибка: {e}"),
                _ => {}
            }
            if step.last {
                if let Some(Lookup::Check(n)) = self.lookup_q.remove(&id) {
                    if let Some(c) = self.checks.get_mut(&n) {
                        c.queries = c.queries.saturating_sub(1);
                        if c.queries == 0 {
                            c.query_done = Some(Instant::now());
                        }
                    }
                }
            }
        }
    }

    fn on_rr(&mut self, e: request_response::Event<Req, Resp>) {
        use request_response::{Event as E, Message};
        match e {
            E::Message { peer, message, .. } => match message {
                Message::Request { request, channel, .. } => {
                    let resp = self.on_req(peer, request);
                    let _ = self.swarm.behaviour_mut().rr.send_response(channel, resp);
                }
                Message::Response { request_id, response } => {
                    if let Some(p) = self.pending.remove(&request_id) {
                        self.on_resp(peer, p, response);
                    }
                }
            },
            E::OutboundFailure { peer, request_id, error, .. } => {
                if let Some(Pend::Hello) = self.pending.remove(&request_id) {
                    self.hello_inflight.remove(&peer);
                }
                tracing::debug!("запрос к {peer} не прошёл: {error}");
            }
            _ => {}
        }
    }

    // ---------- таймер ----------
    fn on_tick(&mut self) {
        let now = Instant::now();
        // DHT поднимаю ещё до регистрации — чтобы проверить ник на уникальность
        if self.swarm.behaviour().kad.is_enabled() {
            let need = match self.last_boot {
                None => true,
                Some(t) => now.duration_since(t) > if self.bootstrapped { Duration::from_secs(600) } else { Duration::from_secs(30) },
            };
            if need {
                self.last_boot = Some(now);
                if let Some(k) = self.swarm.behaviour_mut().kad.as_mut() {
                    let _ = k.bootstrap();
                }
            }
        }
        self.tick_checks(now);
        // переписать файл, где удалили сообщения (по одному за тик — не тормозить сеть)
        if let Some(room) = self.st.dirty().into_iter().next() {
            self.st.compact(&room);
        }
        if self.st.profile.is_none() {
            return;
        }
        // 1. держу связь с друзьями и участниками
        for p in self.wanted() {
            if self.connected(&p) {
                if !self.online.contains_key(&p) {
                    self.send_hello(p);
                }
                continue;
            }
            if self.dial_due(&p, now) {
                self.dial(p, &[]);
            }
            self.lookup(Lookup::Peer(p));
        }
        // 1б. мини-сервер знакомств: переспрашиваю друзей в сети, кого не хватает
        self.tick_intro(now);
        // 2. инвайты в ожидании
        self.try_joins(None);
        let pend: Vec<String> = self.st.rooms.values().filter(|r| r.pending).map(|r| r.id.clone()).collect();
        for r in pend {
            self.lookup(Lookup::Room(r));
        }
        // 3. DHT: публикую себя
        if self.swarm.behaviour().kad.is_enabled() {
            let settle = self.addr_dirty.map(|t| now.duration_since(t) > Duration::from_secs(8)).unwrap_or(false);
            // первые публикации чаще: DHT капризный, адреса за NAT ещё плывут
            let every = match self.provide_n { 0..=1 => 60, 2..=3 => 300, _ => 20 * 60 };
            let stale = self.last_provide.map(|t| now.duration_since(t) > Duration::from_secs(every)).unwrap_or(true);
            if self.dht_ready() && (settle || stale) && self.swarm.external_addresses().next().is_some() {
                self.last_provide = Some(now);
                self.provide_n += 1;
                self.addr_dirty = None;
                let mut keys = vec![dht_key("peer", &self.me_s)];
                if let Some(p) = &self.st.profile {
                    // nickreg — «ник занят» (для проверки уникальности), nick — «можно найти по нику»
                    keys.push(dht_key("nickreg", &p.nick));
                    if self.st.config.findable {
                        keys.push(dht_key("nick", &p.nick));
                    }
                }
                for r in self.st.rooms.values() {
                    if r.kind == "group" && !r.pending {
                        keys.push(dht_key("room", &r.id));
                    }
                }
                if let Some(k) = self.swarm.behaviour_mut().kad.as_mut() {
                    for key in keys {
                        let _ = k.start_providing(key);
                    }
                }
                tracing::info!("опубликовал себя в DHT: {:?}", self.swarm.external_addresses().map(|a| a.to_string()).collect::<Vec<_>>());
            }
        }
        // 4. сердцебиение — держит соединения открытыми
        if now.duration_since(self.last_hb) > Duration::from_secs(25) {
            self.last_hb = now;
            let ps: Vec<PeerId> = self.online.keys().cloned().collect();
            for p in ps {
                self.send(p, Req::Ping, Pend::Other);
            }
        }
        // 5. ретрансляторы
        self.manage_relays();
        // 5б. стал (или перестал быть) достижим напрямую — расскажу друзьям, они будут стучаться ко мне первым
        if self.reachable() != self.hub_told {
            self.hub_told = self.reachable();
            let ps: Vec<PeerId> = self.online.iter().filter(|(_, o)| o.lvl >= LEVEL).map(|(p, _)| *p).collect();
            for p in ps {
                self.hello_inflight.remove(&p);
                self.send_hello(p);
            }
        }
        // 6. диск
        if self.peers_dirty {
            self.peers_dirty = false;
            self.st.save_peers();
        }
        self.net_changed();
    }

    pub(crate) fn try_joins(&mut self, only: Option<PeerId>) {
        let pend: Vec<(String, String, String)> =
            self.st.rooms.values().filter(|r| r.pending).map(|r| (r.id.clone(), r.secret.clone(), r.inviter.clone())).collect();
        for (room, secret, inviter) in pend {
            if self.join_sent.get(&room).map(|t| t.elapsed() < Duration::from_secs(12)).unwrap_or(false) {
                continue;
            }
            let mut targets: Vec<PeerId> = vec![];
            if let Ok(p) = inviter.parse::<PeerId>() {
                targets.push(p);
            }
            targets.extend(self.join_cands.iter().cloned());
            let targets: Vec<PeerId> =
                targets.into_iter().filter(|p| self.connected(p) && only.map(|o| o == *p).unwrap_or(true)).collect();
            if let Some(t) = targets.first().cloned() {
                self.join_sent.insert(room.clone(), Instant::now());
                let profile = self.profile();
                self.send(t, Req::Join { room: room.clone(), secret, profile }, Pend::Join(room));
            }
        }
    }

    fn manage_relays(&mut self) {
        if self.opts.local_only {
            return;
        }
        let stale: Vec<PeerId> =
            self.relays.iter().filter(|(_, r)| !r.ok && r.at.elapsed() > Duration::from_secs(45)).map(|(p, _)| *p).collect();
        for p in stale {
            if let Some(r) = self.relays.remove(&p) {
                self.swarm.remove_listener(r.listener);
                self.relay_bad.insert(p);
                let ps = p.to_string();
                let n = self.st.relays.len();
                self.st.relays.retain(|a| !a.ends_with(&ps));
                if self.st.relays.len() != n {
                    self.st.save_relays();
                }
            }
        }
        if self.started.elapsed() > Duration::from_secs(1800) && self.relay_bad.len() > 32 {
            self.relay_bad.clear();
        }
        if self.nat == "public" {
            return;
        }
        // до 2 резервов у друзей (сервер друга, белый IP) — сразу, NAT ещё не ясен, а это дёшево;
        // и 1 у публичного IPFS-ретранслятора — чтобы достучался и незнакомый (заявка в друзья)
        let mine = self.relays.keys().filter(|p| self.known(p)).count();
        let public = self.relays.len() - mine;
        let mut cands: Vec<(u8, PeerId, Multiaddr)> = vec![];
        if mine < 2 {
            for (p, o) in self.online.iter() {
                if !o.relay || self.relays.contains_key(p) || self.relay_bad.contains(p) {
                    continue;
                }
                if let Some(c) = self.conns.get(p) {
                    // соединение уже есть — резерв пойдёт по нему; адрес нужен только для формы
                    if let Some((a, _)) = c.values().filter(|(a, _)| !is_circuit(a)).max_by_key(|(a, d)| (*d && is_public(a), *d)) {
                        cands.push((if o.server { 0 } else { 1 }, *p, strip_peer(a.clone(), p)));
                    }
                }
            }
            cands.sort_by_key(|c| c.0);
            cands.truncate(2 - mine);
        }
        // публичный: «живой» — уже подтвердил резерв или ждём его меньше 12 с (иначе параллельно пробую следующий)
        let public_live = self.relays.iter().filter(|(p, r)| !self.known(p) && (r.ok || r.at.elapsed() < Duration::from_secs(12))).count();
        let _ = public;
        if public_live < 1 {
            // сначала тот, где резервировался в прошлый раз (адрес через него у друзей в кеше), — сразу, без DHT
            let sticky = self.st.relays.iter().filter_map(|a| a.parse::<Multiaddr>().ok()).find_map(|a| {
                let p = relay_of(&a.clone().with(Protocol::P2pCircuit))?;
                (!self.relays.contains_key(&p) && !self.relay_bad.contains(&p) && !self.known(&p)).then(|| (p, strip_peer(a, &p)))
            });
            if let Some((p, a)) = sticky {
                cands.push((2, p, a));
            } else if self.started.elapsed() > Duration::from_secs(6) {
                if let Some((p, a)) = self.relay_cands.iter().filter(|(p, _)| !self.relays.contains_key(p) && !self.relay_bad.contains(p)).find_map(|(p, addrs)| {
                    addrs.iter().find(|a| a.iter().any(|x| matches!(x, Protocol::Tcp(_)))).map(|a| (*p, strip_peer(a.clone(), p)))
                }) {
                    cands.push((2, p, a));
                }
            }
        }
        for (_, p, a) in cands {
            let addr = a.clone().with(Protocol::P2p(p)).with(Protocol::P2pCircuit);
            match self.swarm.listen_on(addr) {
                Ok(id) => {
                    self.relays.insert(p, RelayUse { listener: id, ok: false, logged: false, at: Instant::now(), addr: a });
                }
                Err(e) => {
                    tracing::debug!("relay {p}: {e}");
                    self.relay_bad.insert(p);
                }
            }
        }
    }

    /// Я ему отказал / удалил его: его «хочу дружить» старше отказа — повтор (или авто-переспрос) → снова говорю «нет»
    /// и считаю hello обычным. Заявка, отправленная уже после отказа (want новее), — настоящая: забываю отказ.
    pub(crate) fn said_no(&mut self, peer: PeerId, want: u64) -> bool {
        let ps = peer.to_string();
        let Some(&cut) = self.declined.get(&ps) else { return false };
        if self.st.friends.contains_key(&ps) || want > cut {
            self.declined.remove(&ps);
            return false;
        }
        self.send(peer, Req::FriendRemove, Pend::Other);
        true
    }

    pub(crate) fn net_json(&self) -> Value {
        let ext: Vec<String> = self.swarm.external_addresses().map(|a| a.to_string()).collect();
        let listen: Vec<String> = self.swarm.listeners().map(|a| a.to_string()).collect();
        let relays: Vec<Value> = self
            .relays
            .iter()
            .map(|(p, r)| json!({ "peer": p.to_string(), "nick": self.nick(&p.to_string()), "ok": r.ok, "friend": self.is_friend(&p.to_string()) }))
            .collect();
        let mut peers: Vec<Value> = vec![];
        for (p, o) in self.online.iter() {
            let ps = p.to_string();
            let addr = self.conns.get(p).and_then(|c| c.values().next().map(|(a, _)| a.to_string())).unwrap_or_default();
            peers.push(json!({ "peer": ps, "nick": self.nick(&ps), "rtt": o.rtt, "via": self.via(p), "addr": addr, "relay": o.relay }));
        }
        json!({
            "peer": self.me_s,
            "nat": self.nat,
            "upnp": self.upnp_state,
            "external": ext,
            "listen": listen,
            "relays": relays,
            "online": peers,
            "connections": self.conns.values().map(|c| c.len()).sum::<usize>(),
            "dht": { "on": self.swarm.behaviour().kad.is_enabled(), "ready": self.bootstrapped },
            "mdns": self.swarm.behaviour().mdns.is_enabled(),
            "relay_server": self.swarm.behaviour().relay.is_enabled(),
            "lan": self.lan.len(),
            // серверы друзей: сколько знаю и сколько сейчас в сети
            "servers": self.online.values().filter(|o| o.server).count(),
            "servers_known": self.st.peers.values().filter(|c| c.server).count(),
            "server": self.server,
            "port": self.listen_port(),
            "reachable": self.nat == "public" || self.upnp_state == "порт проброшен",
            "intros": { "got": self.intros.0, "made": self.intros.1, "waiting": self.seekers.values().map(|m| m.len()).sum::<usize>() },
            "reserved": self.reserved.len(),
        })
    }

    /// Порт, который реально слушаю (его и пробрасывать на роутере).
    pub(crate) fn listen_port(&self) -> u16 {
        for a in self.swarm.listeners() {
            if is_circuit(a) {
                continue;
            }
            for p in a.iter() {
                match p {
                    Protocol::Tcp(x) | Protocol::Udp(x) => return x,
                    _ => {}
                }
            }
        }
        self.opts.port.unwrap_or(self.st.config.port)
    }

    fn net_changed(&mut self) {
        let sig = format!(
            "{}|{}|{}|{}|{}|{}|{}",
            self.online.values().filter(|o| o.server).count(),
            self.nat,
            self.upnp_state,
            self.relays.values().filter(|r| r.ok).count(),
            self.bootstrapped,
            self.swarm.external_addresses().count(),
            self.online.len()
        );
        if sig != self.net_sig {
            self.net_sig = sig;
            let v = self.net_json();
            self.emit("net", json!({ "net": v }));
        }
    }

    #[allow(dead_code)]
    pub fn me(&self) -> &PeerId {
        &self.me
    }
    #[allow(dead_code)]
    pub fn keypair(&self) -> &Keypair {
        &self.key
    }
}
