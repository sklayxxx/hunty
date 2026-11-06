//! Attachment encoding matches the existing P2P client; no network paths are trusted.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{fs, io::Read, path::Path};

const MAX_SEND: u64 = 6 * 1024 * 1024;
const MAX_RECEIVE_B64: usize = 128 * 1024 * 1024;

pub fn safe_name(name: &str) -> String {
    let name: String = name
        .chars()
        .filter(|c| !c.is_control() && !"/\\<>:\"|?*".contains(*c))
        .take(150)
        .collect();
    let name = name.trim().trim_matches('.');
    if name.is_empty() {
        "attachment".into()
    } else {
        name.into()
    }
}

pub fn send_data(path: &Path) -> Result<Value, String> {
    let file = fs::File::open(path).map_err(|e| format!("Не удалось прочитать файл: {e}"))?;
    let meta = file
        .metadata()
        .map_err(|e| format!("Не удалось прочитать файл: {e}"))?;
    if !meta.is_file() {
        return Err("Выбери обычный файл".into());
    }
    if meta.len() > MAX_SEND {
        return Err("Файл больше 6 МБ — для P2P-чата пока многовато".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_SEND + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Не удалось прочитать файл: {e}"))?;
    if bytes.len() as u64 > MAX_SEND {
        return Err("Файл больше 6 МБ — для P2P-чата пока многовато".into());
    }
    let name = safe_name(&path.file_name().unwrap_or_default().to_string_lossy());
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();
    Ok(json!({"name": name, "size": bytes.len(), "mime": mime,
        "src": format!("data:{mime};base64,{}", STANDARD.encode(bytes))}))
}

pub fn decode_media(value: &Value) -> Result<Vec<u8>, String> {
    let b64 = value["b64"].as_str().ok_or("Вложение не найдено")?;
    if b64.len() > MAX_RECEIVE_B64 {
        return Err("Вложение слишком большое".into());
    }
    STANDARD
        .decode(b64)
        .map_err(|_| "Вложение повреждено".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_filename_is_only_a_suggestion() {
        assert_eq!(safe_name("../path\\evil\n.txt"), "pathevil.txt");
        assert_eq!(safe_name("..."), "attachment");
        assert_eq!(safe_name("клип.webm"), "клип.webm");
        assert_eq!(safe_name("bad:name?.txt"), "badname.txt");
    }
    #[test]
    fn encoding_matches_existing_media_protocol() {
        let path = std::env::temp_dir().join(format!("hunty-iced-{}.txt", std::process::id()));
        std::fs::write(&path, b"hello\0world").unwrap();
        let data = send_data(&path).unwrap();
        std::fs::remove_file(path).unwrap();
        assert_eq!(data["size"], 11);
        assert_eq!(data["mime"], "text/plain");
        let payload = data["src"].as_str().unwrap().split_once(',').unwrap().1;
        assert_eq!(
            decode_media(&json!({"b64": payload})).unwrap(),
            b"hello\0world"
        );
        assert!(decode_media(&json!({"b64":"not base64!"})).is_err());
    }
    #[test]
    fn oversized_file_is_rejected_before_read() {
        let path = std::env::temp_dir().join(format!("hunty-iced-large-{}", std::process::id()));
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_SEND + 1).unwrap();
        assert!(send_data(&path).is_err());
        std::fs::remove_file(path).unwrap();
    }
    #[tokio::test]
    async fn self_chat_file_round_trip_uses_real_core() {
        let dir = std::env::temp_dir().join(format!("hunty-iced-roundtrip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("sample.txt");
        let original = vec![0x5a; 10_000];
        std::fs::write(&source, &original).unwrap();
        let options = hunty_core::Opts {
            local_only: true,
            mdns: Some(false),
            dht: Some(false),
            upnp: Some(false),
            relay_server: Some(false),
            port: Some(0),
        };
        let (handle, mut events) = hunty_core::start(dir.clone(), options).await.unwrap();
        handle
            .cmd(json!({"cmd":"onboard", "nick":"icedtest", "ava":"mob:pig"}))
            .await
            .unwrap();
        let room = handle.cmd(json!({"cmd":"self_open"})).await.unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let data = send_data(&source).unwrap();
        let sent = handle
            .cmd(json!({"cmd":"send", "room":room, "kind":"file", "text":"", "data":data}))
            .await
            .unwrap();
        let id = sent["id"].as_str().unwrap();
        assert_eq!(
            sent["data"]["ref"], true,
            "large data must use the disk-backed media path"
        );
        let media = handle
            .cmd(json!({"cmd":"media", "room":room, "id":id}))
            .await
            .unwrap();
        assert_eq!(media["name"], "sample.txt");
        assert_eq!(decode_media(&media).unwrap(), original);
        let _ = handle.cmd(json!({"cmd":"quit"})).await;
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while events.recv().await.is_some() {}
        })
        .await
        .expect("test node did not stop");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
