//! Протокол /hunty/1.0.0 — запрос/ответ JSON поверх libp2p-стримов.
use crate::store::{Member, Msg, Profile};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL: &str = "/hunty/1.0.0";

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
    },
    Profile { profile: Profile },
    Joined { room: RoomWire },
    Sync { msgs: Vec<Msg>, more: bool },
}
