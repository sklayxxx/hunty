//! Restore journal: validate before writing, apply before loading the identity.
//! If a replacement fails, keep the journal and retry on the next startup.
use crate::store::{write_atomic, Blocked, Config, Friend, Profile, Room};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use libp2p::{identity::Keypair, PeerId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, fs, path::Path};

const JOURNAL: &str = "restore.pending.json";

#[derive(Deserialize, Serialize)]
struct Backup {
    hunty_backup: u32,
    peer: String,
    key: String,
    profile: Option<Profile>,
    friends: BTreeMap<String, Friend>,
    rooms: BTreeMap<String, Room>,
    config: Config,
    #[serde(default)]
    blocked: BTreeMap<String, Blocked>,
}

impl Backup {
    fn validate(&self) -> Result<Vec<u8>> {
        if self.hunty_backup != 1 { bail!("неподдерживаемая версия бэкапа"); }
        if !self.profile.as_ref().map(|p| crate::util::clean_nick(&p.nick).is_some()).unwrap_or(false) { bail!("в бэкапе нет корректного профиля"); }
        let key = STANDARD.decode(&self.key).context("битый ключ")?;
        let pair = Keypair::from_protobuf_encoding(&key).context("битый ключ")?;
        if pair.public().to_peer_id().to_string() != self.peer { bail!("ключ не соответствует аккаунту в бэкапе"); }
        for (id, f) in &self.friends {
            id.parse::<PeerId>().context("битый ключ друга")?;
            if id != &f.peer { bail!("несогласованный список друзей"); }
        }
        for (id, r) in &self.rooms {
            if id != &r.id || id.is_empty() || id.len() > 100 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
                bail!("битый идентификатор комнаты");
            }
            if !matches!(r.kind.as_str(), "dm" | "group" | "self") || (!r.pending && !r.is_member(&self.peer)) { bail!("битый состав комнаты"); }
            for (peer, member) in &r.members {
                peer.parse::<PeerId>().context("битый ключ участника")?;
                if peer != &member.peer { bail!("несогласованный состав комнаты"); }
            }
        }
        Ok(key)
    }
}

pub fn stage(dir: &Path, data: &Value) -> Result<()> {
    let backup: Backup = serde_json::from_value(data.clone()).context("неполный или повреждённый бэкап")?;
    backup.validate()?;
    if dir.join(JOURNAL).exists() { bail!("восстановление уже ожидает перезапуска"); }
    write_atomic(&dir.join(JOURNAL), &serde_json::to_vec(&backup)?)
}

pub fn recover(dir: &Path) -> Result<()> {
    let path = dir.join(JOURNAL);
    if !path.exists() { return Ok(()); }
    let mut backup: Backup = serde_json::from_slice(&fs::read(&path)?)?;
    let key = backup.validate()?;
    backup.profile = backup.profile.map(Profile::sanitized);
    for f in backup.friends.values_mut() { f.profile = f.profile.clone().sanitized(); }
    // Replace identity last. A partial restore never starts the network node.
    for (name, data) in [
        ("profile.json", serde_json::to_vec(&backup.profile)?),
        ("friends.json", serde_json::to_vec(&backup.friends)?),
        ("rooms.json", serde_json::to_vec(&backup.rooms)?),
        ("config.json", serde_json::to_vec(&backup.config)?),
        ("blocked.json", serde_json::to_vec(&backup.blocked)?),
        ("peers.json", b"{}".to_vec()),
        ("identity.key", key),
    ] { write_atomic(&dir.join(name), &data)?; }
    fs::remove_file(path)?;
    Ok(())
}

#[cfg(test)]
mod regression_tests {
    use super::*;
    use crate::testutil::TestDir;

    fn fixture() -> Value {
        let key = Keypair::generate_ed25519();
        let peer = key.public().to_peer_id().to_string();
        let mut members = BTreeMap::new();
        members.insert(peer.clone(), crate::testutil::member(&peer, "owner"));
        let r: Room = serde_json::from_value(serde_json::json!({
            "id":"r", "kind":"self", "name":"Saved", "owner":peer, "created":1,
            "members":members
        })).unwrap();
        serde_json::json!({
            "hunty_backup":1, "peer":peer, "key":STANDARD.encode(key.to_protobuf_encoding().unwrap()),
            "profile":{"nick":"restored"}, "friends":{}, "rooms":{"r":r}, "config":Config::default()
        })
    }

    #[test]
    fn restore_is_staged_and_old_shutdown_cannot_overwrite_it() {
        let dir = TestDir::new();
        let data = fixture();
        write_atomic(&dir.path().join("rooms.json"), b"{}").unwrap();
        stage(dir.path(), &data).unwrap();
        assert_eq!(fs::read(dir.path().join("rooms.json")).unwrap(), b"{}");
        // An old in-memory store may still flush before the process exits.
        write_atomic(&dir.path().join("rooms.json"), b"{}").unwrap();
        recover(dir.path()).unwrap();
        let rooms: BTreeMap<String, Room> = serde_json::from_slice(&fs::read(dir.path().join("rooms.json")).unwrap()).unwrap();
        assert!(rooms.contains_key("r"));
        assert!(!dir.path().join(JOURNAL).exists());
    }

    #[test]
    fn invalid_backup_never_changes_identity_or_creates_journal() {
        let dir = TestDir::new();
        write_atomic(&dir.path().join("identity.key"), b"original").unwrap();
        let mut data = fixture(); data["peer"] = Value::String("wrong-peer".into());
        assert!(stage(dir.path(), &data).is_err());
        assert_eq!(fs::read(dir.path().join("identity.key")).unwrap(), b"original");
        assert!(!dir.path().join(JOURNAL).exists());
        data = fixture(); data.as_object_mut().unwrap().remove("rooms");
        assert!(stage(dir.path(), &data).is_err());
    }

    #[test]
    fn interrupted_restore_keeps_journal_and_can_retry() {
        let dir = TestDir::new();
        stage(dir.path(), &fixture()).unwrap();
        fs::create_dir(dir.path().join("config.json")).unwrap();
        assert!(recover(dir.path()).is_err());
        assert!(dir.path().join(JOURNAL).exists());
        fs::remove_dir(dir.path().join("config.json")).unwrap();
        recover(dir.path()).unwrap();
        assert!(!dir.path().join(JOURNAL).exists());
    }
}
