# Звуки Hunty

Все звуки — **CC0** (общественное достояние): можно использовать, менять и распространять без указания авторства.
Авторов всё равно перечисляем — из уважения. Файлы лежат в `ui/sfx/` (Opus в Ogg, моно 48 кГц, громкость выровнена),
всего ~440 КБ. Пересборка: `SND=папка_с_исходниками python3 ui/tools/sfx_build.py` (нужны `ffmpeg` и `numpy`).

Если файла нет или он не декодируется — играет запасной синтез (Web Audio), так что приложение не молчит.

## Звуки действий (`ui/sfx/<имя>.ogg`)

Категории можно выключать в **Настройки → Уведомления → Какие звуки играть**.

| Файл | Где звучит | Категория | Источник |
|---|---|---|---|
| `msg` | новое сообщение | Сообщения | Kenney · Interface Sounds · drop_002 |
| `mention` | тебя упомянули | Сообщения | Kenney · Interface Sounds · confirmation_002 |
| `friend` | новый друг / приняли заявку | Сообщения | Kenney · Interface Sounds · confirmation_004 |
| `online` | друг зашёл в сеть | Сообщения | Kenney · Interface Sounds · glass_001 |
| `ring` | входящий звонок | Звонки | Kenney · Music Jingles · jingles_STEEL10 (×2) |
| `ringback` | ты звонишь, ждём ответа | Звонки | Kenney · Music Jingles · jingles_STEEL16 (мягче, с фильтром) |
| `hangup` | сбросили / не ответили | Звонки | Kenney · Interface Sounds · minimize_005 |
| `join` / `leave` | ты зашёл / вышел из голоса | Голос | Kenney · Interface Sounds · confirmation_001 / question_002 |
| `pjoin` / `pleave` | друг зашёл / вышел | Голос | Kenney · Interface Sounds · maximize_009 / minimize_009 |
| `mute` / `unmute` | мик выкл / вкл | Мик и звук | Kenney · Interface Sounds · minimize_008 / maximize_008 |
| `deaf` / `undeaf` | звук выкл / вкл | Мик и звук | Kenney · Interface Sounds · minimize_006 / maximize_006 |
| `streamon` / `streamoff` | начали / закончили показ экрана | Демка | Kenney · Interface Sounds · open_002 / close_002 |
| `clip` | клип сохранён | Фишки | Freesound #170229 «Camera Shutter» — roachpowder |
| `hall` | новое в Зале славы | Фишки | Kenney · Music Jingles · jingles_NES12 |
| `nudge` | пинок | Фишки | Kenney · Impact Sounds · impactPunch_medium_000 |
| `roll` / `tick` | перекличка / тик таймера | Фишки | Kenney · Interface Sounds · question_003 / tick_004 |
| `allhere` | все в сборе | Фишки | Kenney · Music Jingles · jingles_NES08 |
| `say` / `brb` | фраза / «перерыв» | Фишки | Kenney · Interface Sounds · pluck_001 / bong_001 |
| `pop` | стикер, реакция, эффект | Фишки | Kenney · Interface Sounds · pluck_002 |
| `boom` | эффект «Бум» | Фишки | Kenney · Sci-fi Sounds · explosionCrunch_000 |
| `cash` | эффект «Деньги» | Фишки | Freesound #209578 «Cash Register Purchase» — Zott820 |
| `confetti` | эффект «Конфетти» | Фишки | Kenney · Music Jingles · jingles_PIZZI02 |
| `shake` | эффект «Тряска» | Фишки | Kenney · RPG Audio · metalPot2 |
| `egg` | найдена пасхалка | Фишки | Kenney · Music Jingles · jingles_NES03 |
| `ok` / `err` | готово / ошибка | — | Kenney · Interface Sounds · select_006 / error_006 |

## Саундборд (`ui/sfx/sb-<id>.ogg`)

Слышат все в голосе (звук подмешивается в твой микрофон). Свои звуки (до 8 штук, до 10 сек) хранятся только у тебя.

| Кнопка | Файл | Источник |
|---|---|---|
| Дудка | `sb-horn` | Freesound #414208 «Airhorn» — jacksonacademyashmore |
| Ба-дум-тсс | `sb-drum` | Freesound #132418 «Rimshot (sweet)» — Sajmund |
| Грустный тромбон | `sb-sad` | Freesound #175409 «wah wah sad trombone» — kirbydx |
| Аплодисменты | `sb-clap` | Freesound #32260 «smallcrowd» — moxobna |
| Пружинка | `sb-boing` | Freesound #540790 «Boing 2» — magnuswaker |
| Пиу-пиу | `sb-laser` | Kenney · Digital Audio · laser5 (×2) |
| Победа | `sb-win` | Freesound #397355 «Tada Fanfare A» — plasterbrain |
| Сверчки | `sb-cricket` | Freesound #129678 «crickets» — FreethinkerAnon |
| Барабанная дробь | `sb-roll` | Freesound #191718 «drumroll» — adriann |
| Верно! | `sb-ding` | Freesound #335908 «Correct» — LittleRainySeasons |
| Мимо | `sb-buzz` | Freesound #331912 «Wrong Buzzer» — KevinVG207 |
| Злодейский смех | `sb-laugh` | Freesound #478934 «evil laugh» — kintana24 |

## Откуда брать

- Kenney — <https://kenney.nl/assets> (паки Interface Sounds, Music Jingles, Impact Sounds, Sci-fi Sounds, Digital Audio, RPG Audio), лицензия CC0.
- Freesound — <https://freesound.org/s/ID/> (фильтр «Creative Commons 0»).

Обработка: обрезка тишины по краям, короткие фейды, выравнивание по кратковременной громкости
(−15 dBFS для звуков действий, −13 dBFS для саундборда), пик не выше −1 dBFS, кодек Opus 48/64 кбит/с.
