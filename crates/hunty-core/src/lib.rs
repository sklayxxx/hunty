//! hunty-core — P2P-ядро мессенджера Hunty.
//!
//! Без серверов: личность — ключ ed25519, друзья находятся через публичный IPFS DHT,
//! mDNS в локалке, UPnP/hole punching (DCUtR) и ретрансляторы (в т.ч. через друзей).
//! UI общается с ядром JSON-командами (`Handle::cmd`) и получает поток событий.
mod api;
pub mod codes;
mod node;
pub mod proto;
pub mod store;
pub mod util;
mod wire;

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
