//! hunty-node — Hunty без окна: P2P-узел + встроенный веб-интерфейс в браузере.
//! Так Hunty работает на Linux/macOS (и в тестах), а тот же узел говорит с Windows-приложением на одном протоколе.
//!
//!   hunty                                     запустить и открыть интерфейс (данные — в папке пользователя)
//!   hunty --install                           Linux: поставить в ~/.local/bin + ярлык в меню
//!   hunty-node --data ./a --ws 7457 --http 8457 --ui ui     режим разработки/тестов
use futures::{SinkExt, StreamExt};
use hunty_core::{start, Handle, Opts};
use include_dir::{include_dir, Dir};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::{http::StatusCode, Message};

/// интерфейс вшит в бинарник: один файл — и всё работает
static UI: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/../../ui");
#[cfg(all(unix, not(target_os = "macos")))]
static ICON: &[u8] = include_bytes!("../../../src-tauri/icons/128x128@2x.png");
/// перезапуск по просьбе UI (восстановление из бэкапа, сетевые настройки)
static RESTART: AtomicBool = AtomicBool::new(false);

const HELP: &str = "Hunty — свой P2P-мессенджер для друзей (браузерный режим: Linux, macOS)

  hunty                         запустить и открыть Hunty в браузере
  hunty --install               Linux: поставить в ~/.local/bin + ярлык «Hunty» в меню приложений
  hunty --install --autostart   ...и запускать в фоне при входе в систему
  hunty --uninstall             убрать ярлык, автозапуск и бинарник (данные остаются)

  --data DIR      папка данных: ключ, друзья, группы, история   [~/.local/share/hunty]
  --web PORT      порт интерфейса (http + ws)                    [7457, занят — следующий]
  --port PORT     p2p-порт (tcp + quic)
  --tab           открыть обычной вкладкой (по умолчанию — отдельным окном Chrome/Chromium, если есть)
  --no-open       не открывать браузер
  --background    работать в фоне без окна (для автозапуска)
  HUNTY_BROWSER=firefox hunty   открыть в конкретном браузере

Разработка и тесты:
  --ws PORT --http PORT [--ui DIR]   отдельные порты и UI с диска
  --allow-origin URL                 пустить WS со своего dev-сервера
  --local --no-mdns --no-dht --no-upnp --no-relay
  --nick NICK [--ava MOB]            сразу зарегаться (тесты, боты)
  --events                           печатать события в stdout";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let a: Vec<String> = std::env::args().collect();
    let arg = |k: &str| a.iter().position(|x| x == k).and_then(|i| a.get(i + 1)).cloned();
    let flag = |k: &str| a.iter().any(|x| x == k);
    if flag("--help") || flag("-h") {
        println!("{HELP}");
        return Ok(());
    }
    if flag("--version") || flag("-V") {
        println!("hunty {}", hunty_core::VERSION);
        return Ok(());
    }
    if flag("--install") {
        return install(flag("--autostart"));
    }
    if flag("--uninstall") {
        return uninstall();
    }
    let dev = arg("--ws").is_some() || arg("--http").is_some();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            if dev { "info,libp2p_mdns=warn,libp2p_kad=warn,libp2p_swarm=warn" } else { "warn,hunty_core=info,hunty_node=info,quinn_udp=error" }.into()
        }))
        .with_writer(std::io::stderr)
        .with_ansi(std::io::IsTerminal::is_terminal(&std::io::stderr()))
        .init();
    let background = flag("--background");
    let restarted = std::env::var_os("HUNTY_RESTARTED").is_some();
    let data = arg("--data")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HUNTY_DATA").filter(|v| !v.is_empty()).map(PathBuf::from))
        .unwrap_or_else(default_data);
    std::fs::create_dir_all(&data)?;

    // одна папка данных — один узел; повторный запуск просто открывает уже работающий Hunty
    let lock = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(data.join("hunty.lock"))?;
    let mut tries = if restarted { 75 } else { 1 };
    loop {
        match lock.try_lock() {
            Ok(()) => break,
            Err(_) if tries > 1 => {
                tries -= 1;
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            Err(_) => {
                let url = std::fs::read_to_string(data.join("web.url")).unwrap_or_default();
                let url = url.trim();
                if dev || url.is_empty() {
                    anyhow::bail!("папкой {} уже пользуется другой запущенный Hunty", data.display());
                }
                println!("Hunty уже запущен: {url}");
                if !background && !flag("--no-open") {
                    open_browser(url, flag("--tab"));
                }
                return Ok(());
            }
        }
    }

    let opts = Opts {
        mdns: flag("--no-mdns").then_some(false),
        dht: flag("--no-dht").then_some(false),
        upnp: flag("--no-upnp").then_some(false),
        relay_server: flag("--no-relay").then_some(false),
        port: arg("--port").and_then(|x| x.parse().ok()),
        local_only: flag("--local"),
    };
    let (h, mut rx) = start(data.clone(), opts).await?;
    if let Some(nick) = arg("--nick") {
        let st = h.cmd(json!({ "cmd": "state" })).await.unwrap_or(Value::Null);
        if st["me"]["onboarded"] != json!(true) {
            // без --ava UI сам выберет моба по ключу; «pig» и «mob:pig» — одно и то же
            let ava = arg("--ava").map(|a| if a.contains(':') { a } else { format!("mob:{a}") }).unwrap_or_else(|| "steve".into());
            if let Err(e) = h.cmd(json!({ "cmd": "onboard", "nick": nick, "ava": ava })).await {
                eprintln!("onboard: {e}");
            }
        }
    }
    let (btx, _) = broadcast::channel::<String>(4096);
    let btx2 = btx.clone();
    let print = flag("--events");
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            let s = ev.to_string();
            if print {
                println!("{s}");
            }
            let _ = btx2.send(s);
        }
        if RESTART.load(Ordering::SeqCst) {
            respawn();
        } else {
            eprintln!("ядро остановилось — выхожу");
        }
        std::process::exit(0);
    });
    // Ctrl+C / выключение системы — аккуратно сохраняемся и выходим
    {
        let h = h.clone();
        tokio::spawn(async move {
            if tokio::signal::ctrl_c().await.is_ok() {
                eprintln!("выключаюсь…");
                quit(&h).await;
            }
        });
    }
    #[cfg(unix)]
    {
        let h = h.clone();
        tokio::spawn(async move {
            use tokio::signal::unix::{signal, SignalKind};
            if let Ok(mut t) = signal(SignalKind::terminate()) {
                t.recv().await;
                quit(&h).await;
            }
        });
    }

    let mut origins: Vec<String> = a.windows(2).filter(|w| w[0] == "--allow-origin").map(|w| w[1].trim_end_matches('/').to_string()).collect();
    let local = |p: u16| [format!("http://127.0.0.1:{p}"), format!("http://localhost:{p}")];
    let ui = arg("--ui").map(PathBuf::from);
    let clients = Arc::new(AtomicUsize::new(0));
    let me = h.cmd(json!({ "cmd": "state" })).await.ok().and_then(|v| v["me"]["peer"].as_str().map(String::from)).unwrap_or_default();

    if dev {
        let ws_port: u16 = arg("--ws").and_then(|x| x.parse().ok()).unwrap_or(7457);
        let http_port: Option<u16> = arg("--http").and_then(|x| x.parse().ok());
        if let Some(p) = http_port {
            origins.extend(local(p));
        }
        let ctx = Ctx { h: h.clone(), btx: btx.clone(), clients: clients.clone(), origins: Arc::new(origins), ui };
        if let Some(p) = http_port {
            let (l, _) = bind_web(&[p], restarted).await?;
            eprintln!("UI: http://127.0.0.1:{p}/?ws={ws_port}");
            tokio::spawn(web(l, ctx.clone()));
        }
        let (l, _) = bind_web(&[ws_port], restarted).await?;
        eprintln!("hunty-node {} · peer {me} · ws://127.0.0.1:{ws_port}", hunty_core::VERSION);
        loop {
            let (s, _) = l.accept().await?;
            tokio::spawn(ws_client(s, ctx.clone()));
        }
    }

    // обычный запуск: интерфейс и мост к ядру на одном порту, браузер открываем сами
    let saved: Option<u16> = std::fs::read_to_string(data.join("web.url"))
        .ok()
        .and_then(|u| u.trim().trim_end_matches('/').rsplit(':').next().and_then(|p| p.parse().ok()));
    let mut cands: Vec<u16> = match arg("--web").and_then(|x| x.parse().ok()) {
        Some(p) => vec![p],
        None => saved.into_iter().chain(7457..=7466).chain([0]).collect(),
    };
    cands.dedup();
    let (l, port) = bind_web(&cands, restarted).await?;
    let url = format!("http://127.0.0.1:{port}/");
    origins.extend(local(port));
    let _ = std::fs::write(data.join("web.url"), &url);
    println!(
        "\n  Hunty {} · peer …{} · серверов: 0\n  ▸ интерфейс: {url}\n  ▸ данные:    {}\n  {}\n",
        hunty_core::VERSION,
        &me[me.len().saturating_sub(6)..],
        data.display(),
        if background {
            "фоновый режим: окно открывается ярлыком Hunty или командой hunty"
        } else {
            "закроешь окно — Hunty выключится через минуту · Ctrl+C — сразу"
        }
    );
    if !background && !flag("--no-open") && !restarted {
        open_browser(&url, flag("--tab"));
    }
    if !background {
        tokio::spawn(auto_exit(clients.clone(), h.clone()));
    }
    web(l, Ctx { h, btx, clients, origins: Arc::new(origins), ui }).await;
    Ok(())
}

#[derive(Clone)]
struct Ctx {
    h: Handle,
    btx: broadcast::Sender<String>,
    clients: Arc<AtomicUsize>,
    origins: Arc<Vec<String>>,
    ui: Option<PathBuf>,
}

/// http + ws на одном порту
async fn web(l: TcpListener, c: Ctx) {
    loop {
        let Ok((s, _)) = l.accept().await else { continue };
        let c = c.clone();
        tokio::spawn(async move {
            match tokio::time::timeout(Duration::from_secs(10), wants_ws(&s)).await {
                Ok(true) => ws_client(s, c).await,
                Ok(false) => http(s, c.ui.as_deref()).await,
                Err(_) => {}
            }
        });
    }
}

/// заглядываем в заголовки, не вычитывая их: это апгрейд до WebSocket или обычный GET?
async fn wants_ws(s: &TcpStream) -> bool {
    let mut buf = [0u8; 4096];
    loop {
        let n = match s.peek(&mut buf).await {
            Ok(n) if n > 0 => n,
            _ => return false,
        };
        if buf[..n].windows(4).any(|w| w == b"\r\n\r\n") || n == buf.len() {
            let head = String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase();
            return head.lines().any(|l| l.split_once(':').is_some_and(|(k, v)| k.trim() == "upgrade" && v.trim() == "websocket"));
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

async fn ws_client(s: TcpStream, c: Ctx) {
    // браузер сам подписывает Origin: чужой сайт из соседней вкладки к ядру не подключится
    let origins = c.origins.clone();
    let check = move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        let o = req.headers().get("origin").and_then(|v| v.to_str().ok()).map(|v| v.trim_end_matches('/').to_string());
        match o {
            None => Ok(resp),
            Some(o) if origins.iter().any(|x| *x == o) => Ok(resp),
            Some(o) => {
                tracing::warn!("не пустил к ядру страницу с чужого адреса: {o}");
                let mut r = ErrorResponse::new(Some("hunty: chuzhoy sayt".into()));
                *r.status_mut() = StatusCode::FORBIDDEN;
                Err(r)
            }
        }
    };
    let Ok(ws) = tokio_tungstenite::accept_hdr_async(s, check).await else { return };
    c.clients.fetch_add(1, Ordering::SeqCst);
    serve(ws, c.h.clone(), c.btx.subscribe()).await;
    // окно закрылось: если других окон нет — выходим из голоса, иначе друзья будут ждать «призрака»
    if c.clients.fetch_sub(1, Ordering::SeqCst) == 1 {
        let _ = c.h.cmd(json!({ "cmd": "voice_leave" })).await;
    }
}

async fn serve(ws: tokio_tungstenite::WebSocketStream<TcpStream>, h: Handle, mut brx: broadcast::Receiver<String>) {
    let (mut wtx, mut wrx) = ws.split();
    let (otx, mut orx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        loop {
            let m = tokio::select! {
                m = orx.recv() => match m { Some(m) => m, None => break },
                e = brx.recv() => match e {
                    Ok(m) => m,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                },
            };
            if wtx.send(Message::text(m)).await.is_err() {
                break;
            }
        }
    });
    while let Some(Ok(m)) = wrx.next().await {
        let Message::Text(t) = m else { continue };
        let v: Value = serde_json::from_str(t.as_str()).unwrap_or(Value::Null);
        let id = v.get("id").cloned().unwrap_or(Value::Null);
        let (h, otx) = (h.clone(), otx.clone());
        tokio::spawn(async move {
            let out = if v["cmd"] == "node_restart" {
                restart_soon(h);
                json!({ "id": id, "ok": true })
            } else {
                match h.cmd(v).await {
                    Ok(x) => json!({ "id": id, "ok": x }),
                    Err(e) => json!({ "id": id, "err": e }),
                }
            };
            let _ = otx.send(out.to_string());
        });
    }
    writer.abort();
}

/// выйти и запустить себя заново с теми же флагами (ядро перечитает ключ/настройки)
fn restart_soon(h: Handle) {
    RESTART.store(true, Ordering::SeqCst);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        let _ = tokio::time::timeout(Duration::from_secs(3), h.cmd(json!({ "cmd": "quit" }))).await;
        // обычно процесс уже завершился из цикла событий; это запасной путь
        tokio::time::sleep(Duration::from_secs(3)).await;
        respawn();
        std::process::exit(0);
    });
}

fn respawn() {
    let Ok(exe) = std::env::current_exe() else { return };
    let args: Vec<String> = std::env::args().skip(1).filter(|a| a != "--no-open").collect();
    match Command::new(exe).args(&args).arg("--no-open").env("HUNTY_RESTARTED", "1").stdin(Stdio::null()).spawn() {
        Ok(_) => eprintln!("перезапускаюсь…"),
        Err(e) => eprintln!("не смог перезапуститься: {e}"),
    }
}

async fn quit(h: &Handle) -> ! {
    let _ = tokio::time::timeout(Duration::from_secs(3), h.cmd(json!({ "cmd": "quit" }))).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    std::process::exit(0)
}

/// окно закрыли и минуту никто не вернулся — выключаемся, чтобы не висеть невидимкой (в фоне живёт только --background)
async fn auto_exit(clients: Arc<AtomicUsize>, h: Handle) {
    let (mut seen, mut idle) = (false, 0u64);
    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;
        if clients.load(Ordering::SeqCst) > 0 {
            seen = true;
            idle = 0;
            continue;
        }
        if !seen {
            continue;
        }
        idle += 5;
        if idle >= 60 {
            println!("окно Hunty закрыто уже минуту — выключаюсь (hunty --background — чтобы оставаться в сети)");
            quit(&h).await;
        }
    }
}

async fn bind_web(cands: &[u16], retry: bool) -> anyhow::Result<(TcpListener, u16)> {
    for (i, p) in cands.iter().enumerate() {
        // после перезапуска старый процесс ещё может держать порт пару секунд
        let tries = if retry && i == 0 { 50 } else { 1 };
        for t in 0..tries {
            if let Ok(l) = TcpListener::bind(("127.0.0.1", *p)).await {
                let port = l.local_addr()?.port();
                return Ok((l, port));
            }
            if t + 1 < tries {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
    anyhow::bail!("порт {:?} занят — запусти с --web ДРУГОЙ_ПОРТ", cands.first())
}

fn ctype(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        "json" => "application/json",
        "webmanifest" => "application/manifest+json",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "ico" => "image/x-icon",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// статика интерфейса: с диска (--ui, удобно править) или вшитая в бинарник
async fn http(mut s: TcpStream, dir: Option<&Path>) {
    let mut buf = vec![0u8; 16384];
    let n = s.read(&mut buf).await.unwrap_or(0);
    let head = String::from_utf8_lossy(&buf[..n]);
    let path = head.split_whitespace().nth(1).unwrap_or("/").split(['?', '#']).next().unwrap_or("/");
    let mut rel = path.trim_start_matches('/').to_string();
    if rel.is_empty() || rel.ends_with('/') {
        rel.push_str("index.html");
    }
    let file = if rel.contains("..") || rel.contains('\\') || rel.starts_with("tools/") {
        None
    } else if let Some(d) = dir {
        tokio::fs::read(d.join(&rel)).await.ok()
    } else {
        UI.get_file(&rel).map(|f| f.contents().to_vec())
    };
    let (code, body, ct) = match file {
        Some(b) => ("200 OK", b, ctype(Path::new(&rel))),
        None => ("404 Not Found", b"not found".to_vec(), "text/plain; charset=utf-8"),
    };
    let hdr = format!(
        "HTTP/1.1 {code}\r\nContent-Type: {ct}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = s.write_all(hdr.as_bytes()).await;
    let _ = s.write_all(&body).await;
}

/// открыть интерфейс: отдельным окном Chrome/Chromium (как программа), иначе — браузером по умолчанию
fn open_browser(url: &str, tab: bool) {
    let _ = tab;
    let spawn = |prog: &str, args: &[&str]| -> bool {
        match Command::new(prog).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
            Ok(mut ch) => {
                std::thread::spawn(move || {
                    let _ = ch.wait();
                });
                true
            }
            Err(_) => false,
        }
    };
    if let Ok(b) = std::env::var("HUNTY_BROWSER") {
        if !b.is_empty() && spawn(&b, &[url]) {
            return;
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if !tab {
            let app = format!("--app={url}");
            for b in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser", "microsoft-edge", "vivaldi"] {
                if spawn(b, &[&app]) {
                    return;
                }
            }
        }
        if spawn("xdg-open", &[url]) {
            return;
        }
    }
    #[cfg(target_os = "macos")]
    if spawn("open", &[url]) {
        return;
    }
    #[cfg(windows)]
    if spawn("cmd", &["/C", "start", "", url]) {
        return;
    }
    println!("открой в браузере: {url}");
}

fn default_data() -> PathBuf {
    let env = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    #[cfg(windows)]
    if let Some(p) = env("APPDATA") {
        return p.join("Hunty").join("web");
    }
    #[cfg(target_os = "macos")]
    if let Some(h) = env("HOME") {
        return h.join("Library/Application Support/Hunty");
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(x) = env("XDG_DATA_HOME") {
            return x.join("hunty");
        }
        if let Some(h) = env("HOME") {
            return h.join(".local/share/hunty");
        }
    }
    let _ = env;
    PathBuf::from("hunty-data")
}

#[cfg(all(unix, not(target_os = "macos")))]
fn xdg(var: &str, fallback: &str) -> anyhow::Result<PathBuf> {
    if let Some(v) = std::env::var_os(var).filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(v));
    }
    let home = std::env::var_os("HOME").ok_or_else(|| anyhow::anyhow!("не знаю домашнюю папку ($HOME)"))?;
    Ok(PathBuf::from(home).join(fallback))
}

/// Linux: бинарник в ~/.local/bin, иконка и ярлык в меню приложений, по желанию — автозапуск в фоне
#[cfg(all(unix, not(target_os = "macos")))]
fn install(autostart: bool) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let bin = xdg("HUNTY_BIN_DIR", ".local/bin")?;
    std::fs::create_dir_all(&bin)?;
    let dst = bin.join("hunty");
    let exe = std::env::current_exe()?;
    if exe.canonicalize().ok() != dst.canonicalize().ok() {
        let tmp = bin.join(".hunty.new");
        std::fs::copy(&exe, &tmp)?;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
        std::fs::rename(&tmp, &dst)?;
    }
    let share = xdg("XDG_DATA_HOME", ".local/share")?;
    let icons = share.join("icons/hicolor/256x256/apps");
    std::fs::create_dir_all(&icons)?;
    std::fs::write(icons.join("hunty.png"), ICON)?;
    let apps = share.join("applications");
    std::fs::create_dir_all(&apps)?;
    let exec = {
        let s = dst.display().to_string();
        if s.contains(' ') { format!("\"{s}\"") } else { s }
    };
    let entry = |exec: String, extra: &str| {
        format!(
            "[Desktop Entry]\nType=Application\nName=Hunty\nGenericName=Мессенджер\nComment=Свой P2P-мессенджер для друзей: чат, голос, демка экрана\nExec={exec}\nIcon=hunty\nTerminal=false\nCategories=Network;InstantMessaging;Chat;\nKeywords=chat;voice;p2p;messenger;\n{extra}"
        )
    };
    std::fs::write(apps.join("hunty.desktop"), entry(exec.clone(), ""))?;
    if autostart {
        let auto = xdg("XDG_CONFIG_HOME", ".config")?.join("autostart");
        std::fs::create_dir_all(&auto)?;
        std::fs::write(auto.join("hunty.desktop"), entry(format!("{exec} --background"), "NoDisplay=true\nX-GNOME-Autostart-enabled=true\n"))?;
    }
    let _ = Command::new("update-desktop-database").arg(&apps).stdout(Stdio::null()).stderr(Stdio::null()).status();
    println!("✓ Hunty установлен: {}", dst.display());
    println!("✓ ярлык «Hunty» — в меню приложений");
    if autostart {
        println!("✓ автозапуск в фоне при входе: друзья видят тебя в сети, окно открывается ярлыком");
    }
    let in_path = std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|x| x == bin));
    if !in_path {
        println!("· чтобы запускать командой «hunty», добавь {} в PATH", bin.display());
    }
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn uninstall() -> anyhow::Result<()> {
    let share = xdg("XDG_DATA_HOME", ".local/share")?;
    let files = [
        xdg("HUNTY_BIN_DIR", ".local/bin")?.join("hunty"),
        share.join("applications/hunty.desktop"),
        share.join("icons/hicolor/256x256/apps/hunty.png"),
        xdg("XDG_CONFIG_HOME", ".config")?.join("autostart/hunty.desktop"),
    ];
    for p in files {
        if std::fs::remove_file(&p).is_ok() {
            println!("убрал {}", p.display());
        }
    }
    println!("данные (ключ, друзья, история) остались в {} — сотри папку руками, если надо", default_data().display());
    Ok(())
}

#[cfg(not(all(unix, not(target_os = "macos"))))]
fn install(_autostart: bool) -> anyhow::Result<()> {
    anyhow::bail!("--install есть только для Linux; на Windows ставь Hunty_…_x64-setup.exe")
}

#[cfg(not(all(unix, not(target_os = "macos"))))]
fn uninstall() -> anyhow::Result<()> {
    anyhow::bail!("--uninstall есть только для Linux")
}
