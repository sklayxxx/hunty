//! hunty-core — P2P-ядро мессенджера Hunty.
//!
//! Без серверов: личность — ключ ed25519, друзья находятся через публичный IPFS DHT,
//! mDNS в локалке, UPnP/hole punching (DCUtR) и ретрансляторы (в т.ч. через друзей).
//! UI общается с ядром JSON-командами (`Handle::cmd`) и получает поток событий.
mod api;
mod backup;
pub mod codes;
mod node;
pub mod proto;
pub mod store;
pub mod util;
mod wire;

#[cfg(test)]
mod testutil {
    use crate::store::{Member, Room};
    use std::path::{Path, PathBuf};

    pub struct TestDir(PathBuf);
    impl TestDir {
        pub fn new() -> Self {
            let path = std::env::temp_dir().join(format!("hunty-regression-{}", crate::util::rand_hex(10)));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        pub fn path(&self) -> &Path { &self.0 }
    }
    impl Drop for TestDir {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }
    pub fn member(peer: &str, role: &str) -> Member {
        Member { peer: peer.into(), role: role.into(), ts: 1, nick: peer.into(), ava: "mob:pig".into(), gone: false }
    }
    pub fn room() -> Room {
        serde_json::from_value(serde_json::json!({
            "id":"r", "kind":"group", "name":"Test", "owner":"owner", "created":1,
            "invite":"admin", "secret":"secret", "members": {
                "owner":member("owner","owner"), "admin":member("admin","admin"), "user":member("user","member")
            }
        })).unwrap()
    }
}

pub use node::{Opts, VERSION};
use serde_json::Value;
use std::path::PathBuf;
use tokio::sync::{mpsc, oneshot};

#[derive(Clone)]
pub struct Handle {
    tx: mpsc::UnboundedSender<node::Cmd>,
}

impl Handle {
    /// Выполнить команду ядра. `v` — объект вида `{"cmd":"send","room":"…","text":"…"}`.
    pub async fn cmd(&self, v: Value) -> Result<Value, String> {
        let (tx, rx) = oneshot::channel();
        self.tx.send((v, tx)).map_err(|_| "ядро остановлено".to_string())?;
        rx.await.map_err(|_| "ядро остановлено".to_string())?
    }
    pub fn is_closed(&self) -> bool {
        self.tx.is_closed()
    }
}

/// Запуск ядра. Нужен работающий tokio-рантайм.
/// Возвращает ручку для команд и поток событий (`{"ev":"msg",…}`).
pub async fn start(dir: PathBuf, opts: Opts) -> anyhow::Result<(Handle, mpsc::UnboundedReceiver<Value>)> {
    let (tx, rx) = node::spawn(dir, opts).await?;
    Ok((Handle { tx }, rx))
}
