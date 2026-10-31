# Hunty — рабочие заметки

Стек: Rust-ядро (libp2p 0.57, Tokio) + Tauri 2 (окно, WebView2) + UI на ES-модулях без сборщика (дизайн из прототипа v7).

## Структура
- crates/hunty-core — личность (ed25519), друзья, комнаты/инвайты, история (JSON/JSONL), libp2p (tcp+quic+noise+yamux, mdns, kad(IPFS DHT), relay client+server, dcutr, autonat, upnp, identify, ping), протокол request-response JSON `/hunty/1`, сигналинг WebRTC.
  API: `hunty_core::start(dir, Opts) -> (Handle{cmd(json)->json}, events rx)`.
- crates/hunty-node — бинарник `hunty` для Linux/macOS (браузерный режим): UI вшит (`include_dir`), http+ws на одном порту 127.0.0.1:7457.. (Origin-проверка WS), лок `hunty.lock` (вторая копия открывает первую), автооткрытие браузера (`--app` Chrome/Chromium, `HUNTY_BROWSER`, `--tab`, `--no-open`), выход через 60 с после закрытия последней вкладки (кроме `--background`), `node_restart`/`quit` из UI, `--install [--autostart]`/`--uninstall` (Linux: ~/.local/bin, .desktop, автозапуск). Данные: ~/.local/share/hunty | ~/Library/Application Support/Hunty | `--data`/`HUNTY_DATA`.
  Dev-режим (`--ws --http --ui`) — для разработки и e2e, флаги `--local --no-dht --no-mdns --no-upnp --no-relay --nick --ava --events`. При закрытии последнего окна выходит из голоса.
- src-tauri — пакет `hunty`: ядро в процессе, команды `hunty`, `hunty_open`, `hunty_save`, `hunty_restart`, `hunty_attention`, `hunty_focused`; событие `hunty`. WebView2: авторазрешение только мика и вебки. Single-instance (кроме `HUNTY_DATA`). Лог: `%APPDATA%\app.hunty\hunty.log`.
- ui — index.html (собирается `ui/tools/build.py` из `tools/index.src.html`), css/proto.css (дизайн v7) + css/app.css, js/*: core, api, state, ui, chat, friends, groups, voice (WebRTC mesh, perfect negotiation, сторож ICE), demo (демка/вебки/рисование), layout (колонки, мини-окно, стекло), settings, onboard, afk, eggs, mobs, stickers, main.
- .github/workflows/release.yml — по тегу `v*`: windows-latest (tauri build → NSIS setup + portable exe) + ubuntu-22.04 (статический musl `hunty` → hunty-linux-x64.tar.gz с docs/README-linux.txt) → общий GitHub Release. REPO для проверки обновлений подставляется sed'ом.

## Команды ядра
state net onboard profile_set friend_code friend_add friend_accept friend_decline friend_remove nick_find nearby dm_open
room_create room_add room_invite room_join room_leave room_update room_kick room_admin msgs send(reply) react edit del msg_hide room_clear media read ev rtc
storage nick_check block unblock log_ui
voice_join voice_state voice_leave config_set backup_export backup_import quit
События: msg msg_upd msgs room room_removed friend friend_removed presence profile ev voice rtc net log nearby me join_failed found nick_status blocked
WS (браузерный режим): запрос `{cmd, rid, ...}` → ответ `{rid, ok|err}`, события без rid.

## Статус
- [x] ядро + e2e (tests/core.mjs, tests/dht.mjs)
- [x] UI: онбординг, друзья (ник/код/QR/локалка), лички, группы, инвайты, стикеры/картинки/файлы, голос, вебки, демка с рисованием/метками/реакциями, мини-окно, звонки в личке, настройки (акк, звук, вебка, демка, вид, уведомления, хоткеи, приватность, сеть, о программе), бэкап/восстановление, AFK-мобы, пасхалки
- [x] UI e2e через Playwright на трёх узлах: tests/ui.mjs (онбординг, голос, вебка, демка+рисование, мини-окно, звонок в личке, окна)
- [x] src-tauri: `cargo check --target x86_64-pc-windows-gnu` проходит
- [x] браузерный режим для Linux (hunty-node с вшитым UI), e2e: регистрация/выключение/перезапуск из UI, Chromium ⇄ Firefox (голос, вебка, демка — `node tests/ui.mjs voice dm ff`; тест проверяет, что звук реально идёт в обе стороны).
  Мик: пока AudioContext спит (Firefox до клика / без аудиовыхода), трек уходит напрямую, без гейна, потом подменяется на обработанный
- [x] 0.2.0: ответы/реакции/правка/удаление/разметка, контекстные меню, громкость 0–200% и локальный мьют, проверка мика, шумодав, блокировка, хранилище, журнал вместо tmux-строки, уникальные ники; e2e: tests/core.mjs + tests/v2.mjs
- [ ] проверка на живом Windows (WebView2: getDisplayMedia, разрешения, NSIS)
- [ ] проверка на живом Linux-десктопе (Wayland: показ экрана через портал, .desktop/автозапуск в GNOME/KDE)
- [ ] macOS: собрать и проверить браузерный режим (в CI пока нет)
- [ ] TURN (нет — симметричный NAT с обеих сторон не пробивается для медиа)
