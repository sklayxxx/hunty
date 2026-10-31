//! Hunty — оболочка Tauri: окно с UI (../ui) и P2P-ядро hunty-core в том же процессе.
//! UI зовёт `invoke('hunty', {cmd})`, события ядра прилетают в окно как событие "hunty".
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, UserAttentionType, WebviewWindow};
use tokio::sync::RwLock;

#[derive(Default)]
struct Core {
    h: RwLock<Option<hunty_core::Handle>>,
    err: RwLock<Option<String>>,
    restarting: AtomicBool,
}
type CoreS<'a> = State<'a, Arc<Core>>;

/// любая команда ядра: {"cmd":"send","room":…,"text":…}
#[tauri::command]
async fn hunty(cmd: Value, core: CoreS<'_>) -> Result<Value, String> {
    // ядро стартует асинхронно (ключи, сеть) — первые вызовы UI подождут его
    for _ in 0..150 {
        if let Some(h) = core.h.read().await.clone() {
            return h.cmd(cmd).await;
        }
        if let Some(e) = core.err.read().await.clone() {
            return Err(e);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("ядро не запустилось за 15 секунд".into())
}

/// ссылки открываем в обычном браузере (только http/https)
#[tauri::command]
fn hunty_open(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("открываю только http(s)-ссылки".into());
    }
    open::that_detached(&url).map_err(|e| e.to_string())
}

fn save_bytes(app: &AppHandle, name: &str, b64: &str) -> Result<String, String> {
    let data = base64::engine::general_purpose::STANDARD.decode(b64.trim()).map_err(|e| format!("битые данные: {e}"))?;
    let dir = app.path().download_dir().or_else(|_| app.path().home_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = free_name(&dir, &clean_name(name));
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// сохранить файл (бэкап, картинка из чата) в «Загрузки», вернуть путь.
/// async + отдельный поток: большой файл не подвешивает окно
#[tauri::command]
async fn hunty_save(app: AppHandle, name: String, b64: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || save_bytes(&app, &name, &b64)).await.map_err(|e| e.to_string())?
}

/// сохранить вложение из чата прямо из хранилища ядра (без гонки base64 через окно)
#[tauri::command]
async fn hunty_save_media(app: AppHandle, core: CoreS<'_>, room: String, id: String) -> Result<String, String> {
    let h = core.h.read().await.clone().ok_or("ядро ещё запускается")?;
    let v = h.cmd(json!({ "cmd": "media", "room": room, "id": id })).await?;
    let name = v.get("name").and_then(|x| x.as_str()).filter(|x| !x.is_empty()).unwrap_or("hunty-file").to_string();
    let b64 = v.get("b64").and_then(|x| x.as_str()).unwrap_or("").to_string();
    tauri::async_runtime::spawn_blocking(move || save_bytes(&app, &name, &b64)).await.map_err(|e| e.to_string())?
}

/// показать сохранённый файл в проводнике
#[tauri::command]
fn hunty_reveal(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("файла уже нет".into());
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer").arg(format!("/select,{}", p.display())).spawn();
        return Ok(());
    }
    #[allow(unreachable_code)]
    open::that_detached(p.parent().unwrap_or(&p)).map_err(|e| e.to_string())
}

/// hmedia://localhost/<хата>/<id> (в Windows — https://hmedia.localhost/…): картинки из чата
/// грузятся как обычные файлы, а не гигантскими data:-строками через IPC.
fn media_protocol(app: AppHandle, path: String, responder: tauri::UriSchemeResponder) {
    use tauri::http::Response;
    tauri::async_runtime::spawn(async move {
        let p = path.trim_start_matches('/').replace("%2F", "/").replace("%2f", "/");
        let (room, id) = p.split_once('/').unwrap_or((p.as_str(), ""));
        let core = app.state::<Arc<Core>>().inner().clone();
        let h = core.h.read().await.clone();
        let got = match h {
            Some(h) => h.cmd(json!({ "cmd": "media", "room": room, "id": id })).await.ok(),
            None => None,
        };
        let decoded = got.as_ref().and_then(|v| {
            let b = base64::engine::general_purpose::STANDARD.decode(v.get("b64")?.as_str()?.trim()).ok()?;
            Some((v.get("mime")?.as_str()?.to_string(), b))
        });
        let resp = match decoded {
            Some((mime, body)) => Response::builder()
                .status(200)
                .header("Content-Type", if mime.starts_with("image/") { mime.as_str() } else { "application/octet-stream" })
                .header("Access-Control-Allow-Origin", "*")
                .header("Cache-Control", "private, max-age=31536000, immutable")
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "sandbox; default-src 'none'")
                .body(body),
            None => Response::builder().status(404).header("Access-Control-Allow-Origin", "*").body(Vec::new()),
        };
        match resp {
            Ok(r) => responder.respond(r),
            Err(_) => responder.respond(Response::new(Vec::new())),
        }
    });
}

fn clean_name(n: &str) -> String {
    let s: String = n.chars().map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c }).collect();
    let s = s.trim().trim_matches('.').to_string();
    if s.is_empty() { "hunty-file".into() } else { s.chars().take(120).collect() }
}

fn free_name(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (1..1000).map(|i| dir.join(format!("{stem} ({i}){ext}"))).find(|p| !p.exists()).unwrap_or(p)
}

/// перезапуск всего приложения (сетевые настройки, восстановление из бэкапа)
#[tauri::command]
async fn hunty_restart(app: AppHandle, core: CoreS<'_>) -> Result<(), String> {
    core.restarting.store(true, Ordering::SeqCst);
    stop_core(&core).await;
    app.restart();
}

/// мигнуть в панели задач (звонок, упоминание)
#[tauri::command]
fn hunty_attention(window: WebviewWindow) {
    if !window.is_focused().unwrap_or(false) {
        let _ = window.request_user_attention(Some(UserAttentionType::Informational));
    }
}

#[tauri::command]
fn hunty_focused(window: WebviewWindow) -> bool {
    window.is_focused().unwrap_or(true)
}

async fn stop_core(core: &Core) {
    let h = core.h.write().await.take();
    if let Some(h) = h {
        let _ = tokio::time::timeout(Duration::from_millis(800), h.cmd(json!({ "cmd": "voice_leave" }))).await;
        let _ = tokio::time::timeout(Duration::from_millis(1500), h.cmd(json!({ "cmd": "quit" }))).await;
    }
}

fn data_dir(app: &AppHandle) -> PathBuf {
    // HUNTY_DATA — чтобы на одном компе запустить второй Hunty (тесты, второй акк)
    if let Some(d) = std::env::var_os("HUNTY_DATA") {
        return PathBuf::from(d);
    }
    app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("hunty-data"))
}

fn init_log(dir: &Path) {
    use tracing_subscriber::EnvFilter;
    let _ = std::fs::create_dir_all(dir);
    let filter = EnvFilter::try_from_env("HUNTY_LOG").unwrap_or_else(|_| EnvFilter::new("info,libp2p=warn,netlink=warn"));
    match std::fs::File::create(dir.join("hunty.log")) {
        Ok(f) => {
            let _ = tracing_subscriber::fmt().with_env_filter(filter).with_ansi(false).with_writer(std::sync::Mutex::new(f)).try_init();
        }
        Err(_) => {
            let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
        }
    }
}

fn start_core(app: AppHandle, core: Arc<Core>) {
    tauri::async_runtime::spawn(async move {
        let dir = data_dir(&app);
        init_log(&dir);
        tracing::info!("Hunty {} · данные: {}", hunty_core::VERSION, dir.display());
        match hunty_core::start(dir, hunty_core::Opts::default()).await {
            Ok((h, mut rx)) => {
                *core.h.write().await = Some(h);
                while let Some(ev) = rx.recv().await {
                    let _ = app.emit("hunty", ev);
                }
                // ядро остановилось само (восстановление из бэкапа или сбой) — поднимаем всё заново
                if !core.restarting.swap(true, Ordering::SeqCst) {
                    tracing::warn!("ядро остановилось — перезапускаю Hunty");
                    tokio::time::sleep(Duration::from_millis(700)).await;
                    app.restart();
                }
            }
            Err(e) => {
                tracing::error!("ядро не запустилось: {e:#}");
                *core.err.write().await = Some(format!("ядро не запустилось: {e:#}"));
                let _ = app.emit("hunty", json!({ "ev": "log", "k": "err", "text": format!("ядро не запустилось: {e:#}") }));
            }
        }
    });
}

/// WebView2 по умолчанию спрашивает про мик и вебку при каждом звонке — для нашего окна
/// разрешаем только их (голос и вебка) и чтение буфера обмена (своё меню «Вставить»).
/// Остальные запросы идут обычным путём, с вопросом.
/// Экран для демки всё равно выбирается в системном окне WebView2.
/// Заодно делаю окно «приложением», а не браузером: без своего меню по правому клику,
/// без F5/Ctrl+R/Ctrl+P/Alt+← , без строки статуса, зума щипком и свайпов «назад».
#[cfg(windows)]
fn tune_webview(w: &WebviewWindow) {
    let _ = w.with_webview(|wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use webview2_com::PermissionRequestedEventHandler;
        use windows_core::Interface;
        let Ok(cw) = wv.controller().CoreWebView2() else { return };
        if let Ok(st) = cw.Settings() {
            let _ = st.SetAreDefaultContextMenusEnabled(false);
            let _ = st.SetIsStatusBarEnabled(false);
            let _ = st.SetIsZoomControlEnabled(false);
            if let Ok(s3) = st.cast::<ICoreWebView2Settings3>() {
                let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
            }
            if let Ok(s4) = st.cast::<ICoreWebView2Settings4>() {
                let _ = s4.SetIsGeneralAutofillEnabled(false);
                let _ = s4.SetIsPasswordAutosaveEnabled(false);
            }
            if let Ok(s5) = st.cast::<ICoreWebView2Settings5>() {
                let _ = s5.SetIsPinchZoomEnabled(false);
            }
            if let Ok(s6) = st.cast::<ICoreWebView2Settings6>() {
                let _ = s6.SetIsSwipeNavigationEnabled(false);
            }
        }
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            if let Some(a) = args {
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                a.PermissionKind(&mut kind)?;
                if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                    || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
                    || kind == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ
                {
                    a.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = cw.add_PermissionRequested(&handler, &mut token);
    });
}

/// окно никуда не уходит со своего интерфейса: чужие ссылки — в обычный браузер
fn nav_ok(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" | "hmedia" | "about" | "data" | "blob" => true,
        "http" | "https" => {
            let h = url.host_str().unwrap_or("");
            let local = h == "tauri.localhost" || h == "hmedia.localhost" || h == "ipc.localhost" || h == "localhost";
            if !local {
                let _ = open::that_detached(url.as_str());
            }
            local
        }
        _ => false,
    }
}

fn main() {
    let core = Arc::new(Core::default());
    let mut b = tauri::Builder::default();
    if std::env::var_os("HUNTY_DATA").is_none() {
        // второй запуск просто поднимает уже открытое окно
        b = b.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }
    let guard = tauri::plugin::Builder::<tauri::Wry, ()>::new("hunty-guard").on_navigation(|_, url| nav_ok(url)).build();
    let app = b
        .plugin(guard)
        .register_asynchronous_uri_scheme_protocol("hmedia", |ctx, req, responder| {
            media_protocol(ctx.app_handle().clone(), req.uri().path().to_string(), responder);
        })
        .manage(core.clone())
        .invoke_handler(tauri::generate_handler![
            hunty,
            hunty_open,
            hunty_save,
            hunty_save_media,
            hunty_reveal,
            hunty_restart,
            hunty_attention,
            hunty_focused
        ])
        .setup(move |app| {
            #[cfg(windows)]
            if let Some(w) = app.get_webview_window("main") {
                tune_webview(&w);
            }
            start_core(app.handle().clone(), core.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("не удалось запустить окно Hunty");
    app.run(|app, ev| {
        if let RunEvent::ExitRequested { .. } = ev {
            let core = app.state::<Arc<Core>>().inner().clone();
            if !core.restarting.swap(true, Ordering::SeqCst) {
                tauri::async_runtime::block_on(stop_core(&core));
            }
        }
    });
}
