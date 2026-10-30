//! Коды дружбы и инвайты: hunty://add/… и hunty://join/…
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FriendCode {
    pub p: String,
    #[serde(default)]
    pub n: String,
    #[serde(default)]
    pub a: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct JoinCode {
    pub r: String,
    pub s: String,
    #[serde(default)]
    pub n: String,
    #[serde(default)]
    pub c: String,
    pub p: String,
    #[serde(default)]
    pub a: Vec<String>,
}

fn body<'a>(s: &'a str, kind: &str) -> &'a str {
    let s = s.trim();
    for pre in [format!("hunty://{kind}/"), format!("hunty:{kind}/"), format!("{kind}/")] {
        if let Some(r) = s.strip_prefix(pre.as_str()) {
            return r.trim_end_matches('/');
        }
    }
    s
}

pub fn friend_encode(c: &FriendCode) -> String {
    format!("hunty://add/{}", B64.encode(serde_json::to_vec(c).unwrap_or_default()))
}

pub fn friend_decode(s: &str) -> Option<FriendCode> {
    let b = body(s, "add");
    // голый peer id тоже принимаю
    if b.starts_with("12D3Koo") && b.parse::<libp2p::PeerId>().is_ok() {
        return Some(FriendCode { p: b.to_string(), n: String::new(), a: vec![] });
    }
    let raw = B64.decode(b.trim()).ok()?;
    let c: FriendCode = serde_json::from_slice(&raw).ok()?;
    c.p.parse::<libp2p::PeerId>().ok()?;
    Some(c)
}

pub fn join_encode(c: &JoinCode) -> String {
    format!("hunty://join/{}", B64.encode(serde_json::to_vec(c).unwrap_or_default()))
}

pub fn join_decode(s: &str) -> Option<JoinCode> {
    let raw = B64.decode(body(s, "join").trim()).ok()?;
    let c: JoinCode = serde_json::from_slice(&raw).ok()?;
    c.p.parse::<libp2p::PeerId>().ok()?;
    Some(c)
}
