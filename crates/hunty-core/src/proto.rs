//! Протокол /hunty/1.0.0 — запрос/ответ JSON поверх libp2p-стримов.
use crate::store::{Member, Msg, Profile};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL: &str = "/hunty/1.0.0";
/// Уровень протокола: 2 — умеет Seek/Intro (v0.5). Старые узлы присылают 0.
pub const LEVEL: u8 = 2;

/// Как достучаться до пира, которого видит общий друг (мини-сервер).
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Seen {
    pub peer: String,
    /// как его вижу я (наблюдаемый адрес — дырка в его NAT) + его собственные адреса
    #[serde(default)]
    pub addrs: Vec<String>,
    /// у него резерв на мне — можно пройти цепочкой через меня (p2p-circuit)
    #[serde(default)]
    pub hop: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct VoiceState {
    #[serde(default)]
    pub mic: bool,
    #[serde(default)]
    pub deaf: bool,
    #[serde(default)]
    pub cam: bool,
    #[serde(default)]
    pub share: bool,
    #[serde(default)]
    pub since: u64,
}

/// Что я знаю про общую хату (для синхронизации).
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RoomSync {
    pub id: String,
    pub last: u64,
    pub rev: u64,
}

/// Хата «по проводу»: всё, кроме локальных флажков.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RoomWire {
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
    pub members: Vec<Member>,
    pub created: u64,
    #[serde(default)]
    pub invite: String,
    #[serde(default)]
    pub voice: bool,
    #[serde(default)]
    pub meta_ts: u64,
    /// адреса участников, которые знает отправитель: peer -> [multiaddr]
    #[serde(default)]
    pub addrs: Vec<(String, Vec<String>)>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum Req {
    /// Знакомство при подключении. rel: как я тебя вижу: friend | want | none
    Hello {
        profile: Profile,
        rel: String,
        rooms: Vec<RoomSync>,
        #[serde(default)]
        relay: bool,
        #[serde(default)]
        voice: Option<(String, VoiceState)>,
        /// уровень протокола (см. LEVEL)
        #[serde(default)]
        lvl: u8,
        /// этот ПК — сервер для друзей: всегда в сети, знакомит и ретранслирует
        #[serde(default)]
        server: bool,
        /// до меня можно достучаться напрямую (белый IP / UPnP) — я «хаб»: ко мне стучатся первым
        #[serde(default)]
        hub: bool,
        /// rel = "want": когда я отправил заявку (мои часы). Новая заявка после отказа — свежее, авто-переспрос — нет
        #[serde(default)]
        want: u64,
    },
    Whois,
    Profile { profile: Profile },
    FriendReq { profile: Profile },
    FriendAccept { profile: Profile },
    FriendRemove,
    Join { room: String, secret: String, profile: Profile },
    RoomPush { room: RoomWire },
    Msg { msg: Msg },
    SyncReq { room: String, since: u64, have: Vec<String> },
    Ev { room: String, kind: String, data: Value },
    Voice { room: String, state: Option<VoiceState> },
    Rtc { room: String, data: Value },
    Ping,
    /// «ищу вот этих — кого-нибудь видишь?» — друг работает мини-сервером знакомств
    Seek { want: Vec<String> },
    /// знакомство от общего друга: вот он, в сети, звони навстречу
    Intro { seen: Seen },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum Resp {
    Ok,
    Err { e: String },
    Hello {
        profile: Profile,
        rel: String,
        rooms: Vec<RoomSync>,
        #[serde(default)]
        relay: bool,
        #[serde(default)]
        voice: Option<(String, VoiceState)>,
        /// уровень протокола (см. LEVEL)
        #[serde(default)]
        lvl: u8,
        /// этот ПК — сервер для друзей: всегда в сети, знакомит и ретранслирует
        #[serde(default)]
        server: bool,
        /// до меня можно достучаться напрямую (белый IP / UPnP) — я «хаб»: ко мне стучатся первым
        #[serde(default)]
        hub: bool,
        /// rel = "want": когда я отправил заявку (мои часы). Новая заявка после отказа — свежее, авто-переспрос — нет
        #[serde(default)]
        want: u64,
    },
    Profile { profile: Profile },
    Joined { room: RoomWire },
    Sync { msgs: Vec<Msg>, more: bool },
    /// ответ на Seek: кого из искомых я вижу прямо сейчас
    Seen { found: Vec<Seen> },
}
