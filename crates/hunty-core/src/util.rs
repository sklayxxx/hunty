//! Мелочи: время, id, хэши, ключи DHT.
use libp2p::{kad, PeerId};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn rand_hex(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut b);
    hex::encode(b)
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().into()
}

/// Ключ для публичного IPFS DHT. Делаю его валидным multihash (sha2-256),
/// чтобы go-ноды не отбрасывали запись как «кривой CID».
pub fn dht_key(kind: &str, id: &str) -> kad::RecordKey {
    let d = sha256(format!("hunty/v1/{kind}/{id}").as_bytes());
    let mut mh = Vec::with_capacity(34);
    mh.push(0x12);
    mh.push(0x20);
    mh.extend_from_slice(&d);
    kad::RecordKey::new(&mh)
}

/// id лички = хэш от пары peer id (одинаковый у обоих).
pub fn dm_room_id(a: &PeerId, b: &PeerId) -> String {
    let (x, y) = if a.to_bytes() <= b.to_bytes() { (a, b) } else { (b, a) };
    let mut v = x.to_bytes();
    v.extend(y.to_bytes());
    format!("dm-{}", &hex::encode(sha256(&v))[..24])
}

pub fn short(p: &str) -> String {
    let n = p.len();
    if n > 10 { format!("…{}", &p[n - 6..]) } else { p.to_string() }
}

/// Ник: 2–16 символов, латиница/цифры/._-, в нижнем регистре.
pub fn clean_nick(s: &str) -> Option<String> {
    let n: String = s.trim().trim_start_matches('@').to_lowercase();
    let ok = (2..=16).contains(&n.chars().count())
        && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-');
    ok.then_some(n)
}
