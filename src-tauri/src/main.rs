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

/// сохранить файл (бэкап, картинка из чата) в «Загрузки», вернуть путь
#[tauri::command]
fn hunty_save(app: AppHandle, name: String, b64: String) -> Result<String, String> {
    let data = base64::engine::general_purpose::STANDARD.decode(b64.trim()).map_err(|e| format!("битые данные: {e}"))?;
    let dir = app.path().download_dir().or_else(|_| app.path().home_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = free_name(&dir, &clean_name(&name));
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
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
/// разрешаем только их (голос и вебка). Остальные запросы идут обычным путём, с вопросом.
/// Экран для демки всё равно выбирается в системном окне WebView2.
#[cfg(windows)]
fn allow_media(w: &WebviewWindow) {
    let _ = w.with_webview(|wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use webview2_com::PermissionRequestedEventHandler;
        let Ok(cw) = wv.controller().CoreWebView2() else { return };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            if let Some(a) = args {
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                a.PermissionKind(&mut kind)?;
                if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA {
                    a.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = cw.add_PermissionRequested(&handler, &mut token);
    });
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
    let app = b
        .manage(core.clone())
        .invoke_handler(tauri::generate_handler![hunty, hunty_open, hunty_save, hunty_restart, hunty_attention, hunty_focused])
        .setup(move |app| {
            #[cfg(windows)]
            if let Some(w) = app.get_webview_window("main") {
                allow_media(&w);
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
