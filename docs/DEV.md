# Hunty для разработчиков

Как устроен код, как собрать Hunty у себя, запустить тесты и выпустить релиз. Для пользователей — [README](../README.md) и [инструкция](GUIDE.md).

## Устройство

| Папка | Что там |
|---|---|
| `crates/hunty-core` | ядро: ключ, друзья, комнаты, история (JSON/JSONL), libp2p-сеть, протокол `/hunty/1`, сигналинг WebRTC |
| `crates/hunty-node` | Hunty для Linux/macOS (ядро + вшитый UI, http + ws на 127.0.0.1) и узел для разработки и e2e-тестов |
| `src-tauri` | приложение для Windows: окно (Tauri 2, WebView2), ядро в том же процессе, трей, хоткеи в играх, обновление |
| `ui` | интерфейс: `index.html`, `css/`, `js/` — обычные ES-модули без сборщика; WebRTC-меш голоса и демок живёт тут |
| `tests` | e2e-тесты ядра и интерфейса (Node + Playwright), генератор скриншотов для документации |
| `tools/denoise` | шумодав RNNoise → WebAssembly (готовый `ui/audio/denoise.wasm` уже в репо) |

- **Сеть**: libp2p (QUIC/TCP, Noise, Kademlia DHT поверх публичного IPFS, mDNS, UPnP, DCUtR hole punching, circuit relay v2).
  Каждый узел знакомит своих друзей между собой и может быть ретранслятором для них (`intro.rs`).
- **Голос, вебки, экран** — WebRTC-меш в интерфейсе (до 6 человек), сигналинг идёт через ядро по P2P. STUN публичный, TURN нет.
- **Данные**: `%APPDATA%\app.hunty` (Windows) или `~/.local/share/hunty` (Linux): `identity.key`, `profile.json`, `friends.json`,
  `rooms.json`, `config.json`, история в JSONL, `relays.json`, `hunty.log`. Другая папка — `HUNTY_DATA=…` или `--data`.

## Сборка

**Windows** — нужны [Rust](https://rustup.rs) (rustup предложит поставить Visual Studio Build Tools — соглашайся) и Node.js 18+:

```
cd src-tauri
npx @tauri-apps/cli@2 build      # → target/release/hunty.exe и target/release/bundle/nsis/*-setup.exe
npx @tauri-apps/cli@2 dev        # запуск в режиме разработки
```

Второй Hunty на том же компе (второй акк для тестов): `set "HUNTY_DATA=C:\temp\hunty2" && hunty.exe`.

**Linux / macOS** (браузерный режим) — нужен только Rust:

```
cargo build --release -p hunty-node      # → target/release/hunty-node, интерфейс вшит внутрь
./target/release/hunty-node              # = hunty: ядро + http://127.0.0.1:7457 в браузере

# статический бинарник, как в релизе (нужен musl-tools)
rustup target add x86_64-unknown-linux-musl
cargo build --release --target x86_64-unknown-linux-musl -p hunty-node
```

macOS собирается так же, но не проверялся.

## Разработка интерфейса

Удобнее запускать узел на отдельных портах и брать UI с диска — правки видны по F5, без пересборки:

```
cargo run -p hunty-node -- --data ./data-a --ws 7457 --http 8457 --ui ui
# открыть http://127.0.0.1:8457/?ws=7457
```

Второй узел рядом — другие `--data`, `--ws` и `--http`. Друг друга они найдут через mDNS или по коду.

После правок разметки или иконок: `python3 ui/tools/build.py` — собирает `ui/index.html` из `ui/tools/index.src.html` и спрайта иконок.
Редактировать нужно `index.src.html`, не `index.html`.

Флаги узла (`hunty --help`):

```
--data DIR                       папка данных
--web PORT                       порт интерфейса (http + ws), по умолчанию 7457
--port PORT                      p2p-порт (tcp + quic)
--tab | --no-open | --background как открывать интерфейс
--ws PORT --http PORT [--ui DIR] отдельные порты и UI с диска (разработка)
--allow-origin URL               пустить WS со своего dev-сервера
--local --no-mdns --no-dht --no-upnp --no-relay
--nick NICK [--ava MOB]          сразу зарегистрироваться (тесты, боты)
--events                         печатать события в stdout
```

## Тесты

Нужны Node 22+ и собранный узел (`cargo build -p hunty-node`). Для UI-тестов — Playwright:

```
npm i && npx playwright install chromium
```

| Команда | Что проверяет |
|---|---|
| `node tests/core.mjs` | ядро на 3 узлах: дружба, личка, группа, инвайт, синк истории, голос и сигналинг |
| `node tests/intro.mjs` | знакомство через общего друга, когда старые адреса мертвы, а DHT и локалка выключены |
| `node tests/dht.mjs` | поиск друга по нику только через публичный IPFS DHT (нужен интернет) |
| `node tests/ui.mjs [onboard] [voice] [dm] [win] [slow] [ff]` | интерфейс на 3 узлах: регистрация, голос, вебка, демка с рисованием, мини-окно, звонок в личке, окна; `ff` — второй участник в Firefox |
| `node tests/v2.mjs` | меню, ответы, реакции, правка и удаление, разметка, блок, хранилище, журнал, проверка мика |
| `node tests/fonts.mjs` | ни один шрифт не ломает вёрстку |
| `node tests/cutout.mjs` | качество вырезания фона для стикеров |
| `node tests/perf.mjs [ui] [метка]` | скорость: холодный старт, простой, память, открытие чата, прокрутка |
| `node tests/look.mjs [фильтр]` | скриншоты для дизайн-ревью; `DEAD=1` — ещё и поиск кнопок без обработчиков |

Переменные: `HUNTY_BIN` — какой бинарник узла запускать (по умолчанию `target/debug/hunty-node`), `CHROMIUM` — свой Chromium,
`PLAYWRIGHT_FROM` — папка, где лежит playwright, `V=1` — логи узлов. Скриншоты тестов — в `tests/shots/` (в git не попадают).

## Скриншоты для документации

Картинки в `docs/screens/` снимает скрипт — переснимай после заметных изменений интерфейса:

```
npm run docs:shots                 # = node tests/docs.mjs, все картинки (~3 минуты)
node tests/docs.mjs 07-chat,13     # только те, в чьём имени есть 07-chat или 13
```

Скрипт поднимает четыре локальных узла (anton, vasyan, dimon, lexa), наполняет переписку через API ядра, а голос и показ экрана
снимает с настоящих страниц в headless Chromium с фейковыми микрофоном и экраном. Rust для этого не обязателен:
`HUNTY_BIN=путь/к/hunty node tests/docs.mjs` работает и с бинарником из релиза — интерфейс всё равно берётся из `ui/` на диске.

## Выпустить релиз

1. Допиши в [CHANGELOG.md](../CHANGELOG.md) раздел `## X.Y.Z` (сверху, под «Что нового»). Он сам станет описанием релиза на GitHub.
2. Закоммить и запушь.
3. Поставь тег `vX.Y.Z` и запушь его:
   - GitHub Desktop: **History** → правый клик по коммиту → **Create Tag…** → `v0.6.1` → **Push origin**;
   - или в терминале: `git tag v0.6.1 && git push origin v0.6.1`.
4. Вкладка **Actions** → workflow `release`: Windows собирается ~15–20 минут, Linux ~5–10.
   CI сам подставит версию из тега (`Cargo.toml`, `tauri.conf.json`) и адрес репозитория для проверки обновлений (`REPO` в `ui/js/settings.js`).
5. В **Releases** появится `vX.Y.Z` с `Hunty_X.Y.Z_x64-setup.exe`, `Hunty-portable.exe`, `hunty-linux-x64.tar.gz` и описанием:
   раздел из CHANGELOG + «Как поставить» из [.github/release-install.md](../.github/release-install.md).

У пользователей Hunty раз в день проверяет новые версии: на Windows обновится в один клик, на Linux предложит скачать архив.

Без тега можно собрать вручную: **Actions → release → Run workflow** — файлы будут в артефактах сборки, релиз не создаётся.

## Свой репозиторий

Хочешь собирать свой Hunty — сделай **Fork** (или новый публичный репозиторий и залей туда код). Для публичных репозиториев
GitHub Actions и Releases бесплатные; в форке Actions сначала нужно включить на вкладке **Actions**. Дальше — релиз, как выше:
адрес репозитория для обновлений CI подставит сам, и твои пользователи будут получать обновления из твоих Releases.

Платное только одно и необязательное — подпись exe (убирает предупреждение SmartScreen).
