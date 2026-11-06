//! Experimental native client. It intentionally does not replace the existing media UI.
mod attachments;
use hunty_core::{Handle, Opts};
use iced::futures::SinkExt;
use iced::{
    widget::{button, column, container, image, row, scrollable, text, text_input},
    Color, Element, Font, Length, Subscription, Task, Theme,
};
use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};

struct App {
    core: Option<Handle>,
    changes: Option<tokio::sync::watch::Receiver<u64>>,
    state: Value,
    room: String,
    messages: Vec<Value>,
    draft: String,
    nick: String,
    friend_code: String,
    own_code: String,
    group_name: String,
    group_code: String,
    profile_open: bool,
    profile_saving: bool,
    profile_nick: String,
    profile_line: String,
    profile_bio: String,
    profile_game: String,
    reply: String,
    editing: String,
    pending_delete: String,
    error: String,
    sending: bool,
    attachment_busy: bool,
    notice: String,
}
#[derive(Clone, Debug)]
enum Message {
    Started(Result<(Handle, tokio::sync::watch::Receiver<u64>), String>),
    Tick,
    Snapshot(Result<(Value, String, Vec<Value>), String>),
    Room(String),
    Draft(String),
    Nick(String),
    FriendCode(String),
    GroupName(String),
    GroupCode(String),
    ProfileOpen,
    ProfileClose,
    ProfileNick(String),
    ProfileLine(String),
    ProfileBio(String),
    ProfileGame(String),
    SaveProfile,
    ProfileSaved(Result<(), String>),
    Reply(String),
    Edit(String, String),
    DeleteConfirm(String),
    Command(Value, Action),
    CommandResult(Result<Value, String>, Action),
    CopyCode,
    Register,
    OpenSelf,
    Send,
    Attach,
    AttachmentPicked(String, Option<PathBuf>),
    AttachmentSent(Result<(), String>),
    SaveAttachment(String, String),
    AttachmentSaved(Result<Option<PathBuf>, String>),
    Sent(Result<(), String>, String, String),
    Done(Result<(), String>),
}
#[derive(Clone, Debug)]
enum Action {
    Refresh,
    OpenRoom,
    OwnCode,
}
fn data_dir() -> PathBuf {
    std::env::var_os("HUNTY_ICED_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::data_local_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("hunty-iced-preview")
        })
}
fn refreshes_ui(event: &Value) -> bool {
    matches!(
        event["ev"].as_str(),
        Some(
            "msg"
                | "msgs"
                | "msg_upd"
                | "me"
                | "friend"
                | "friend_removed"
                | "presence"
                | "room"
                | "room_removed"
                | "profile"
                | "blocked"
        )
    )
}
async fn start() -> Result<(Handle, tokio::sync::watch::Receiver<u64>), String> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Same lock as hunty-node; hold it for the whole lifetime of the node.
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join("hunty.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock()
        .map_err(|_| "Папка данных занята другим Hunty".to_string())?;
    let (core, mut events) = hunty_core::start(dir, Opts::default())
        .await
        .map_err(|e| e.to_string())?;
    let (changed, receiver) = tokio::sync::watch::channel(0_u64);
    tokio::spawn(async move {
        let _lock = lock;
        while let Some(event) = events.recv().await {
            if refreshes_ui(&event) {
                changed.send_modify(|n| *n = n.wrapping_add(1));
            }
        }
    });
    Ok((core, receiver))
}
fn snapshot(h: Handle, room: String) -> Task<Message> {
    Task::perform(
        async move {
            let state = h.cmd(json!({"cmd":"state"})).await?;
            let messages = if room.is_empty() {
                vec![]
            } else {
                h.cmd(json!({"cmd":"msgs","room":room,"limit":80})).await?["msgs"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
            };
            Ok((state, room, messages))
        },
        Message::Snapshot,
    )
}
fn init() -> (App, Task<Message>) {
    (
        App {
            core: None,
            changes: None,
            state: Value::Null,
            room: String::new(),
            messages: vec![],
            draft: String::new(),
            nick: String::new(),
            friend_code: String::new(),
            own_code: String::new(),
            group_name: String::new(),
            group_code: String::new(),
            profile_open: false,
            profile_saving: false,
            profile_nick: String::new(),
            profile_line: String::new(),
            profile_bio: String::new(),
            profile_game: String::new(),
            reply: String::new(),
            editing: String::new(),
            pending_delete: String::new(),
            error: String::new(),
            sending: false,
            attachment_busy: false,
            notice: String::new(),
        },
        Task::perform(start(), Message::Started),
    )
}
fn update(app: &mut App, m: Message) -> Task<Message> {
    match m {
        Message::Started(Ok((h, changes))) => {
            app.core = Some(h.clone());
            app.changes = Some(changes);
            snapshot(h, app.room.clone())
        }
        Message::Started(Err(e)) => {
            app.error = e;
            Task::none()
        }
        Message::Tick => app
            .core
            .clone()
            .map(|h| snapshot(h, app.room.clone()))
            .unwrap_or_else(Task::none),
        Message::Snapshot(Ok((state, room, msgs))) => {
            app.state = state;
            if room == app.room {
                app.messages = msgs;
            }
            Task::none()
        }
        Message::Snapshot(Err(e)) => {
            app.error = e;
            Task::none()
        }
        Message::Done(Err(e)) => {
            app.error = e;
            app.sending = false;
            Task::none()
        }
        Message::Done(Ok(())) => {
            app.sending = false;
            app.error.clear();
            app.core
                .clone()
                .map(|h| snapshot(h, app.room.clone()))
                .unwrap_or_else(Task::none)
        }
        Message::Sent(result, room, text) => {
            app.sending = false;
            match result {
                Ok(()) => {
                    if app.room == room && app.draft == text {
                        app.draft.clear();
                        app.reply.clear();
                        app.editing.clear();
                    }
                    app.error.clear();
                    app.core
                        .clone()
                        .map(|h| snapshot(h, app.room.clone()))
                        .unwrap_or_else(Task::none)
                }
                Err(e) => {
                    app.error = e;
                    Task::none()
                }
            }
        }
        Message::Room(room) => {
            app.room = room;
            app.messages.clear();
            app.reply.clear();
            app.editing.clear();
            app.pending_delete.clear();
            app.core
                .clone()
                .map(|h| snapshot(h, app.room.clone()))
                .unwrap_or_else(Task::none)
        }
        Message::Draft(s) => {
            app.draft = s;
            Task::none()
        }
        Message::Nick(s) => {
            app.nick = s;
            Task::none()
        }
        Message::FriendCode(s) => {
            app.friend_code = s;
            Task::none()
        }
        Message::GroupName(s) => {
            app.group_name = s;
            Task::none()
        }
        Message::GroupCode(s) => {
            app.group_code = s;
            Task::none()
        }
        Message::ProfileOpen => {
            let p = &app.state["me"]["profile"];
            app.profile_nick = p["nick"].as_str().unwrap_or("").to_string();
            app.profile_line = p["line"].as_str().unwrap_or("").to_string();
            app.profile_bio = p["bio"].as_str().unwrap_or("").to_string();
            app.profile_game = p["game"].as_str().unwrap_or("").to_string();
            app.profile_open = true;
            Task::none()
        }
        Message::ProfileClose => {
            if !app.profile_saving {
                app.profile_open = false;
            }
            Task::none()
        }
        Message::ProfileNick(s) => {
            if !app.profile_saving {
                app.profile_nick = s;
            }
            Task::none()
        }
        Message::ProfileLine(s) => {
            if !app.profile_saving {
                app.profile_line = s;
            }
            Task::none()
        }
        Message::ProfileBio(s) => {
            if !app.profile_saving {
                app.profile_bio = s;
            }
            Task::none()
        }
        Message::ProfileGame(s) => {
            if !app.profile_saving {
                app.profile_game = s;
            }
            Task::none()
        }
        Message::SaveProfile => {
            if app.profile_saving {
                return Task::none();
            }
            let Some(core) = app.core.clone() else {
                return Task::none();
            };
            app.profile_saving = true;
            let cmd = json!({"cmd":"profile_set", "nick":app.profile_nick, "line":app.profile_line,
                "bio":app.profile_bio, "game":app.profile_game});
            Task::perform(
                async move { core.cmd(cmd).await.map(|_| ()) },
                Message::ProfileSaved,
            )
        }
        Message::ProfileSaved(result) => {
            app.profile_saving = false;
            match result {
                Ok(()) => {
                    app.profile_open = false;
                    app.error.clear();
                    app.notice = "Профиль сохранён".into();
                    app.core
                        .clone()
                        .map(|h| snapshot(h, app.room.clone()))
                        .unwrap_or_else(Task::none)
                }
                Err(e) => {
                    app.error = e;
                    Task::none()
                }
            }
        }
        Message::Reply(s) => {
            if !s.is_empty() {
                app.editing.clear();
            }
            app.reply = s;
            Task::none()
        }
        Message::Edit(id, text) => {
            app.editing = id;
            app.reply.clear();
            app.draft = text;
            Task::none()
        }
        Message::DeleteConfirm(id) => {
            app.pending_delete = id;
            Task::none()
        }
        Message::CopyCode => iced::clipboard::write(app.own_code.clone()),
        Message::Command(cmd, action) => {
            let Some(h) = app.core.clone() else {
                return Task::none();
            };
            Task::perform(
                async move {
                    let result = h.cmd(cmd).await;
                    (result, action)
                },
                |(r, a)| Message::CommandResult(r, a),
            )
        }
        Message::CommandResult(result, action) => match result {
            Err(e) => {
                app.error = e;
                Task::none()
            }
            Ok(v) => {
                app.error.clear();
                match action {
                    Action::OpenRoom => {
                        if let Some(id) = v["id"].as_str().or_else(|| v["room"]["id"].as_str()) {
                            app.room = id.to_string();
                            app.messages.clear();
                            app.reply.clear();
                            app.editing.clear();
                            app.pending_delete.clear();
                        }
                    }
                    Action::OwnCode => {
                        app.own_code = v["code"].as_str().unwrap_or("").to_string();
                    }
                    Action::Refresh => {
                        app.pending_delete.clear();
                    }
                }
                app.core
                    .clone()
                    .map(|h| snapshot(h, app.room.clone()))
                    .unwrap_or_else(Task::none)
            }
        },
        Message::Register => {
            let Some(h) = app.core.clone() else {
                return Task::none();
            };
            let nick = app.nick.clone();
            Task::perform(
                async move {
                    h.cmd(json!({"cmd":"onboard","nick":nick,"ava":"mob:pig"}))
                        .await
                        .map(|_| ())
                },
                Message::Done,
            )
        }
        Message::OpenSelf => {
            let Some(h) = app.core.clone() else {
                return Task::none();
            };
            Task::perform(
                async move {
                    h.cmd(json!({"cmd":"self_open"}))
                        .await
                        .map(|r| r["id"].as_str().unwrap_or("").to_string())
                },
                |result| match result {
                    Ok(id) if !id.is_empty() => Message::Room(id),
                    Ok(_) => Message::Done(Err("Не удалось открыть избранное".into())),
                    Err(e) => Message::Done(Err(e)),
                },
            )
        }
        Message::Attach => {
            if app.attachment_busy || app.room.is_empty() {
                return Task::none();
            }
            app.attachment_busy = true;
            let room = app.room.clone();
            Task::perform(
                async move {
                    let path = rfd::AsyncFileDialog::new()
                        .pick_file()
                        .await
                        .map(|f| f.path().to_owned());
                    (room, path)
                },
                |(room, path)| Message::AttachmentPicked(room, path),
            )
        }
        Message::AttachmentPicked(room, path) => {
            let Some(path) = path else {
                app.attachment_busy = false;
                return Task::none();
            };
            if app.room != room {
                app.attachment_busy = false;
                app.error = "Чат изменился: файл не отправлен".into();
                return Task::none();
            }
            let Some(core) = app.core.clone() else {
                app.attachment_busy = false;
                return Task::none();
            };
            Task::perform(
                async move {
                    let data = tokio::task::spawn_blocking(move || attachments::send_data(&path))
                        .await
                        .map_err(|e| format!("Не удалось подготовить файл: {e}"))??;
                    core.cmd(
                        json!({"cmd":"send", "room":room, "kind":"file", "text":"", "data":data}),
                    )
                    .await
                    .map(|_| ())
                },
                Message::AttachmentSent,
            )
        }
        Message::AttachmentSent(result) => {
            app.attachment_busy = false;
            match result {
                Ok(()) => {
                    app.notice = "Файл отправлен".into();
                    app.error.clear();
                    app.core
                        .clone()
                        .map(|h| snapshot(h, app.room.clone()))
                        .unwrap_or_else(Task::none)
                }
                Err(e) => {
                    app.error = e;
                    Task::none()
                }
            }
        }
        Message::SaveAttachment(id, name) => {
            if app.attachment_busy || app.room.is_empty() {
                return Task::none();
            }
            let Some(core) = app.core.clone() else {
                return Task::none();
            };
            app.attachment_busy = true;
            let room = app.room.clone();
            Task::perform(
                async move {
                    let suggestion = attachments::safe_name(&name);
                    let Some(file) = rfd::AsyncFileDialog::new()
                        .set_file_name(&suggestion)
                        .save_file()
                        .await
                    else {
                        return Ok(None);
                    };
                    let path = file.path().to_owned();
                    let value = core
                        .cmd(json!({"cmd":"media", "room":room, "id":id}))
                        .await?;
                    let target = path.clone();
                    tokio::task::spawn_blocking(move || {
                        let bytes = attachments::decode_media(&value)?;
                        std::fs::write(target, bytes)
                            .map_err(|e| format!("Не удалось сохранить файл: {e}"))
                    })
                    .await
                    .map_err(|e| format!("Не удалось сохранить файл: {e}"))??;
                    Ok(Some(path))
                },
                Message::AttachmentSaved,
            )
        }
        Message::AttachmentSaved(result) => {
            app.attachment_busy = false;
            match result {
                Ok(Some(_)) => {
                    app.notice = "Файл сохранён".into();
                    app.error.clear();
                }
                Ok(None) => {}
                Err(e) => app.error = e,
            }
            Task::none()
        }
        Message::Send => {
            if app.sending || app.draft.trim().is_empty() || app.room.is_empty() {
                return Task::none();
            }
            let Some(h) = app.core.clone() else {
                return Task::none();
            };
            let text = app.draft.clone();
            let room = app.room.clone();
            let reply = app.reply.clone();
            let editing = app.editing.clone();
            app.sending = true;
            // Keep the draft on failure; clear only when issuing a successful send is confirmed.
            Task::perform(
                async move {
                    let command = if editing.is_empty() {
                        json!({"cmd":"send","room":room,"text":text,"reply":reply})
                    } else {
                        json!({"cmd":"edit","room":room,"id":editing,"text":text})
                    };
                    let result = h.cmd(command).await.map(|_| ());
                    (result, room, text)
                },
                |(r, room, text)| Message::Sent(r, room, text),
            )
        }
    }
}
fn room_title(r: &Value) -> String {
    match r["kind"].as_str().unwrap_or("") {
        "self" => "избранное".into(),
        "dm" => r["members"]
            .as_array()
            .and_then(|a| a.iter().find(|x| x["me"] != true))
            .and_then(|x| x["nick"].as_str())
            .unwrap_or("личка")
            .to_string(),
        _ => r["name"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("группа")
            .to_string(),
    }
}
fn avatar<'a>(name: &str, source: &str) -> Element<'a, Message> {
    let icon: Option<&'static [u8]> = match source {
        "mob:steve" => Some(include_bytes!("../assets/mobs/steve.png").as_slice()),
        "mob:alex" => Some(include_bytes!("../assets/mobs/alex.png").as_slice()),
        "mob:creeper" => Some(include_bytes!("../assets/mobs/creeper.png").as_slice()),
        "mob:zombie" => Some(include_bytes!("../assets/mobs/zombie.png").as_slice()),
        "mob:skeleton" => Some(include_bytes!("../assets/mobs/skeleton.png").as_slice()),
        "mob:wither" => Some(include_bytes!("../assets/mobs/wither.png").as_slice()),
        "mob:enderman" => Some(include_bytes!("../assets/mobs/enderman.png").as_slice()),
        "mob:pig" => Some(include_bytes!("../assets/mobs/pig.png").as_slice()),
        "mob:villager" => Some(include_bytes!("../assets/mobs/villager.png").as_slice()),
        "mob:cow" => Some(include_bytes!("../assets/mobs/cow.png").as_slice()),
        "mob:slime" => Some(include_bytes!("../assets/mobs/slime.png").as_slice()),
        "mob:blaze" => Some(include_bytes!("../assets/mobs/blaze.png").as_slice()),
        "mob:spider" => Some(include_bytes!("../assets/mobs/spider.png").as_slice()),
        "mob:golem" => Some(include_bytes!("../assets/mobs/golem.png").as_slice()),
        "mob:fox" => Some(include_bytes!("../assets/mobs/fox.png").as_slice()),
        "mob:axolotl" => Some(include_bytes!("../assets/mobs/axolotl.png").as_slice()),
        "mob:drowned" => Some(include_bytes!("../assets/mobs/drowned.png").as_slice()),
        "mob:sheep" => Some(include_bytes!("../assets/mobs/sheep.png").as_slice()),
        "mob:bee" => Some(include_bytes!("../assets/mobs/bee.png").as_slice()),
        "mob:piglin" => Some(include_bytes!("../assets/mobs/piglin.png").as_slice()),
        "mob:ghast" => Some(include_bytes!("../assets/mobs/ghast.png").as_slice()),
        "mob:chicken" => Some(include_bytes!("../assets/mobs/chicken.png").as_slice()),
        "mob:panda" => Some(include_bytes!("../assets/mobs/panda.png").as_slice()),
        "mob:frog" => Some(include_bytes!("../assets/mobs/frog.png").as_slice()),
        "mob:wolf" => Some(include_bytes!("../assets/mobs/wolf.png").as_slice()),
        "mob:cat" => Some(include_bytes!("../assets/mobs/cat.png").as_slice()),
        "mob:mooshroom" => Some(include_bytes!("../assets/mobs/mooshroom.png").as_slice()),
        "mob:witch" => Some(include_bytes!("../assets/mobs/witch.png").as_slice()),
        "mob:pillager" => Some(include_bytes!("../assets/mobs/pillager.png").as_slice()),
        "mob:pumpkin" => Some(include_bytes!("../assets/mobs/pumpkin.png").as_slice()),
        "mob:parrot" => Some(include_bytes!("../assets/mobs/parrot.png").as_slice()),
        "mob:allay" => Some(include_bytes!("../assets/mobs/allay.png").as_slice()),
        "mob:warden" => Some(include_bytes!("../assets/mobs/warden.png").as_slice()),
        "mob:strider" => Some(include_bytes!("../assets/mobs/strider.png").as_slice()),
        "mob:shulker" => Some(include_bytes!("../assets/mobs/shulker.png").as_slice()),
        "mob:rabbit" => Some(include_bytes!("../assets/mobs/rabbit.png").as_slice()),
        "mob:husk" => Some(include_bytes!("../assets/mobs/husk.png").as_slice()),
        "mob:magma" => Some(include_bytes!("../assets/mobs/magma.png").as_slice()),
        "mob:llama" => Some(include_bytes!("../assets/mobs/llama.png").as_slice()),
        _ => None,
    };
    if let Some(bytes) = icon {
        return image(image::Handle::from_bytes(bytes))
            .width(38)
            .height(38)
            .into();
    }
    let initial = name
        .chars()
        .next()
        .unwrap_or('?')
        .to_uppercase()
        .to_string();
    container(text(initial).size(20).color(Color::from_rgb8(20, 24, 23)))
        .width(38)
        .height(38)
        .center_x(38)
        .center_y(38)
        .style(|_| container::Style {
            background: Some(Color::from_rgb8(133, 218, 181).into()),
            border: iced::Border {
                radius: 11.0.into(),
                ..Default::default()
            },
            ..Default::default()
        })
        .into()
}
fn view(app: &App) -> Element<'_, Message> {
    let accent = Color::from_rgb8(109, 227, 179);
    let me = app.state["me"]["profile"]["nick"]
        .as_str()
        .unwrap_or("гость");
    let mut sidebar = column![text("Чаты").size(17)].spacing(8);
    if let Some(rooms) = app.state["rooms"].as_array() {
        for r in rooms {
            let id = r["id"].as_str().unwrap_or("").to_string();
            let title = room_title(r);
            let unread = r["unread"].as_u64().unwrap_or(0);
            let name = if unread > 0 {
                format!("{title} ({unread})")
            } else {
                title.clone()
            };
            let ava = r["members"]
                .as_array()
                .and_then(|m| m.iter().find(|v| v["me"] != true))
                .and_then(|v| v["ava"].as_str())
                .unwrap_or("");
            sidebar = sidebar.push(
                button(
                    row![avatar(&title, ava), text(name.clone()).size(15)]
                        .spacing(10)
                        .align_y(iced::Alignment::Center),
                )
                .width(Length::Fill)
                .on_press(Message::Room(id)),
            );
        }
    }
    if app.state["me"]["onboarded"] == true {
        sidebar = sidebar
            .push(button("+ избранное").on_press(Message::OpenSelf))
            .push(text(" "))
            .push(text("Новая группа").size(13))
            .push(text_input("название", &app.group_name).on_input(Message::GroupName))
            .push(button("+ создать").on_press(Message::Command(
                json!({"cmd":"room_create", "name":app.group_name}),
                Action::OpenRoom,
            )))
            .push(text("Вступить в группу").size(13))
            .push(text_input("hunty://join/...", &app.group_code).on_input(Message::GroupCode))
            .push(button("Вступить").on_press(Message::Command(
                json!({"cmd":"room_join", "code":app.group_code}),
                Action::OpenRoom,
            )));
        let selected_group = app.state["rooms"]
            .as_array()
            .and_then(|rooms| rooms.iter().find(|r| r["id"].as_str() == Some(&app.room)))
            .map(|r| r["kind"] == "group")
            .unwrap_or(false);
        if selected_group {
            sidebar = sidebar.push(
                button("Код приглашения в группу").on_press(Message::Command(
                    json!({"cmd":"room_invite", "room":app.room}),
                    Action::OwnCode,
                )),
            );
        }
    }
    sidebar = sidebar
        .push(text(" "))
        .push(text(format!("● @{me}")).color(accent));
    if app.state["me"]["onboarded"] == true {
        if app.profile_open {
            sidebar = sidebar
                .push(text("Профиль").size(16))
                .push(text_input("Ник", &app.profile_nick).on_input(Message::ProfileNick))
                .push(text_input("Статус", &app.profile_line).on_input(Message::ProfileLine))
                .push(text_input("О себе", &app.profile_bio).on_input(Message::ProfileBio))
                .push(
                    text_input("Во что играешь", &app.profile_game).on_input(Message::ProfileGame),
                )
                .push(
                    row![
                        button(if app.profile_saving {
                            "Сохраняю…"
                        } else {
                            "Сохранить"
                        })
                        .on_press(Message::SaveProfile),
                        button("Отмена").on_press(Message::ProfileClose)
                    ]
                    .spacing(5),
                );
        } else {
            sidebar = sidebar.push(button("Профиль").on_press(Message::ProfileOpen));
        }
    }
    let current_name = app.state["rooms"]
        .as_array()
        .and_then(|rooms| rooms.iter().find(|r| r["id"].as_str() == Some(&app.room)))
        .map(room_title)
        .unwrap_or_else(|| "Чаты".to_string());
    let mut body = column![
        text(current_name).size(20),
        text("Нативный клиент · тестовая версия")
            .size(13)
            .color(Color::from_rgb8(144, 144, 151)),
        text(" ")
    ]
    .spacing(10);
    if !app.error.is_empty() {
        body = body.push(text(format!("! {}", app.error)).color(Color::from_rgb8(255, 115, 125)));
    } else if !app.notice.is_empty() {
        body = body.push(text(&app.notice).size(13));
    }
    if app.core.is_none() {
        body = body.push(text("Подключение ядра…"));
    } else if app.state["me"]["onboarded"] == false {
        body = body
            .push(text("Создай профиль для тестового клиента"))
            .push(
                text_input("ник (латиница)", &app.nick)
                    .on_input(Message::Nick)
                    .on_submit(Message::Register),
            )
            .push(button("Создать").on_press(Message::Register));
    } else if app.room.is_empty() {
        body = body.push(text(
            "Выбери чат справа. Звонки и просмотр видео пока доступны только в прежнем интерфейсе.",
        ));
    } else {
        let mut msgs = column![].spacing(12);
        for m in &app.messages {
            let who = if m["from"].as_str() == app.state["me"]["peer"].as_str() {
                me.to_string()
            } else {
                let peer = m["from"].as_str().unwrap_or("");
                app.state["friends"]
                    .as_array()
                    .and_then(|a| a.iter().find(|f| f["peer"].as_str() == Some(peer)))
                    .and_then(|f| f["profile"]["nick"].as_str())
                    .unwrap_or("участник")
                    .to_string()
            };
            let attachment = matches!(m["kind"].as_str(), Some("file" | "image"));
            let name = m["data"]["name"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("вложение");
            let msg = m["text"]
                .as_str()
                .filter(|x| !x.is_empty())
                .unwrap_or(if attachment {
                    name
                } else {
                    "[событие или стикер]"
                });
            let id = m["id"].as_str().unwrap_or("").to_string();
            let mine = m["from"].as_str() == app.state["me"]["peer"].as_str();
            let mut actions = row![
                button("Ответить").on_press(Message::Reply(id.clone())),
                button("+1").on_press(Message::Command(
                    json!({"cmd":"react","room":app.room,"id":id,"e":"👍"}),
                    Action::Refresh
                ))
            ]
            .spacing(5);
            if attachment {
                actions = actions.push(
                    button("Сохранить файл")
                        .on_press(Message::SaveAttachment(id.clone(), name.to_string())),
                );
            }
            if mine && m["kind"] == "text" {
                actions = actions
                    .push(button("править").on_press(Message::Edit(id.clone(), msg.to_string())));
                if app.pending_delete == id {
                    actions = actions
                        .push(button("точно удалить?").on_press(Message::Command(
                            json!({"cmd":"del","room":app.room,"id":id}),
                            Action::Refresh,
                        )))
                        .push(button("отмена").on_press(Message::DeleteConfirm(String::new())));
                } else {
                    actions = actions
                        .push(button("удалить").on_press(Message::DeleteConfirm(id.clone())));
                }
            }
            let quote = m["rp"]["text"]
                .as_str()
                .map(|s| format!("↳ {s}"))
                .unwrap_or_default();
            let reactions = m["reacts"]
                .as_array()
                .map(|r| {
                    r.iter()
                        .map(|x| {
                            format!(
                                "{} {}",
                                x["e"].as_str().unwrap_or(""),
                                x["p"].as_array().map(|v| v.len()).unwrap_or(0)
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("  ")
                })
                .unwrap_or_default();
            let ava = if mine {
                app.state["me"]["profile"]["ava"].as_str().unwrap_or("")
            } else {
                app.state["friends"]
                    .as_array()
                    .and_then(|friends| {
                        friends
                            .iter()
                            .find(|f| f["peer"].as_str() == m["from"].as_str())
                    })
                    .and_then(|f| f["profile"]["ava"].as_str())
                    .unwrap_or("")
            };
            let mut content = column![text(who.clone()).size(14).color(accent)].spacing(3);
            if !quote.is_empty() {
                content = content.push(text(quote).size(13));
            }
            content = content.push(text(msg.to_owned()).size(16));
            if !reactions.is_empty() {
                content = content.push(text(reactions).size(13));
            }
            content = content.push(actions);
            msgs = msgs.push(row![avatar(&who, ava), content].spacing(12));
        }
        if !app.editing.is_empty() {
            body = body.push(
                row![
                    text("Редактирование сообщения"),
                    button("×").on_press(Message::Edit(String::new(), String::new()))
                ]
                .spacing(8),
            );
        }
        if !app.reply.is_empty() {
            body = body.push(
                row![
                    text("Ответ на сообщение"),
                    button("×").on_press(Message::Reply(String::new()))
                ]
                .spacing(8),
            );
        }
        body = body.push(scrollable(msgs).height(Length::Fill)).push(
            row![
                button(if app.attachment_busy {
                    "…"
                } else {
                    "Файл"
                })
                .on_press(Message::Attach),
                text_input("Написать сообщение…", &app.draft)
                    .on_input(Message::Draft)
                    .on_submit(Message::Send)
                    .width(Length::Fill),
                button(if app.sending {
                    "…"
                } else {
                    "Отправить"
                })
                .on_press(Message::Send)
            ]
            .spacing(8),
        );
    }
    let mut friends = column![text("Друзья").size(15), text(" ")].spacing(8);
    if let Some(list) = app.state["friends"].as_array() {
        for f in list {
            let peer = f["peer"].as_str().unwrap_or("");
            let nick = f["profile"]["nick"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("без ника");
            let online = if f["online"] == true { "●" } else { "○" };
            match f["state"].as_str().unwrap_or("") {
                "friend" => {
                    let selected_group = app.state["rooms"]
                        .as_array()
                        .and_then(|rs| rs.iter().find(|r| r["id"] == app.room))
                        .map(|r| r["kind"] == "group")
                        .unwrap_or(false);
                    let mut friend_row = row![button(text(format!("{online} {nick}")))
                        .width(Length::Fill)
                        .on_press(Message::Command(
                            json!({"cmd":"dm_open", "peer":peer}),
                            Action::OpenRoom
                        ))]
                    .spacing(5);
                    if selected_group {
                        friend_row = friend_row.push(button("+").on_press(Message::Command(
                            json!({"cmd":"room_add", "room":app.room, "peers":[peer]}),
                            Action::Refresh,
                        )));
                    }
                    friends = friends.push(friend_row)
                }
                "incoming" => {
                    friends = friends.push(
                        row![
                            text(format!("+ {nick}")).width(Length::Fill),
                            button("Принять").on_press(Message::Command(
                                json!({"cmd":"friend_accept","peer":peer}),
                                Action::Refresh
                            )),
                            button("Отклонить").on_press(Message::Command(
                                json!({"cmd":"friend_decline","peer":peer}),
                                Action::Refresh
                            ))
                        ]
                        .spacing(5),
                    )
                }
                "outgoing" => friends = friends.push(text(format!("→ {nick} · заявка")).size(13)),
                _ => {}
            }
        }
    }
    if app.state["me"]["onboarded"] == true {
        friends = friends
            .push(text(" "))
            .push(text("Добавить друга").size(13))
            .push(text_input("hunty://add/...", &app.friend_code).on_input(Message::FriendCode))
            .push(button("отправить заявку").on_press(Message::Command(
                json!({"cmd":"friend_add","code":app.friend_code}),
                Action::Refresh,
            )))
            .push(button("мой код").on_press(Message::Command(
                json!({"cmd":"friend_code"}),
                Action::OwnCode,
            )));
        if !app.own_code.is_empty() {
            friends = friends.push(button("копировать код").on_press(Message::CopyCode));
        }
    }
    fn panel(c: container::Container<'_, Message>) -> container::Container<'_, Message> {
        c.style(|_| container::Style {
            background: Some(Color::from_rgb8(22, 22, 25).into()),
            border: iced::Border {
                color: Color::from_rgb8(61, 61, 66),
                width: 1.0,
                radius: 18.0.into(),
            },
            ..Default::default()
        })
    }
    let mut tabs = row![].spacing(8);
    if let Some(rooms) = app.state["rooms"].as_array() {
        for r in rooms.iter().take(5) {
            let id = r["id"].as_str().unwrap_or("").to_string();
            tabs = tabs.push(button(text(room_title(r))).on_press(Message::Room(id)));
        }
    }
    let top = row![
        panel(
            container(tabs)
                .width(Length::Fill)
                .height(52)
                .padding([8, 12])
        ),
        panel(
            container(text("Hunty").size(20))
                .width(285)
                .height(52)
                .padding([10, 16])
        )
    ]
    .spacing(8);
    let right = column![sidebar, friends].spacing(12);
    let layout = column![
        top,
        row![
            panel(
                container(body)
                    .width(Length::Fill)
                    .height(Length::Fill)
                    .padding(18)
            ),
            panel(
                container(scrollable(right))
                    .width(285)
                    .height(Length::Fill)
                    .padding(14)
            )
        ]
        .spacing(8)
        .height(Length::Fill)
    ]
    .spacing(8);
    container(layout)
        .width(Length::Fill)
        .height(Length::Fill)
        .padding(10)
        .style(|_| container::Style {
            background: Some(Color::from_rgb8(7, 7, 9).into()),
            ..Default::default()
        })
        .into()
}
fn main() -> iced::Result {
    iced::application("Hunty // iced preview", update, view)
        .theme(|_| {
            Theme::custom(
                "Hunty".into(),
                iced::theme::Palette {
                    background: Color::from_rgb8(22, 22, 25),
                    text: Color::from_rgb8(235, 235, 239),
                    primary: Color::from_rgb8(70, 70, 77),
                    success: Color::from_rgb8(106, 207, 154),
                    danger: Color::from_rgb8(220, 90, 90),
                },
            )
        })
        .default_font(Font::DEFAULT)
        .subscription(|app: &App| {
            let fallback = iced::time::every(Duration::from_secs(15)).map(|_| Message::Tick);
            let Some(mut changes) = app.changes.clone() else {
                return fallback;
            };
            let events = iced::stream::channel(1, move |mut output| async move {
                while changes.changed().await.is_ok() {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    changes.borrow_and_update();
                    if output.send(Message::Tick).await.is_err() {
                        break;
                    }
                }
            });
            Subscription::batch([fallback, Subscription::run_with_id("core-events", events)])
        })
        .window_size((1100.0, 720.0))
        .run_with(init)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_relevant_events_refresh_chat() {
        for ev in ["msg", "msg_upd", "friend", "presence", "room", "me"] {
            assert!(refreshes_ui(&json!({"ev":ev})), "{ev}");
        }
        for ev in ["rtc", "voice", "log", "net", "unknown"] {
            assert!(!refreshes_ui(&json!({"ev":ev})), "{ev}");
        }
    }
    #[test]
    fn join_already_member_opens_nested_room_response() {
        let (mut app, _) = init();
        app.room = "old".into();
        let _ = update(
            &mut app,
            Message::CommandResult(
                Ok(json!({"already":true,"room":{"id":"group"}})),
                Action::OpenRoom,
            ),
        );
        assert_eq!(app.room, "group");
    }
    #[test]
    fn profile_draft_is_not_changed_during_save() {
        let (mut app, _) = init();
        app.state = json!({"me":{"profile":{"nick":"old","line":"hello"}}});
        let _ = update(&mut app, Message::ProfileOpen);
        assert_eq!(app.profile_nick, "old");
        let _ = update(&mut app, Message::ProfileLine("new".into()));
        app.profile_saving = true;
        let _ = update(&mut app, Message::ProfileLine("late".into()));
        let _ = update(&mut app, Message::ProfileClose);
        assert_eq!(app.profile_line, "new");
        assert!(app.profile_open);
    }
    #[test]
    fn room_labels() {
        assert_eq!(room_title(&json!({"kind":"self"})), "избранное");
        assert_eq!(
            room_title(&json!({"kind":"dm", "members":[{"me":true},{"me":false,"nick":"alice"}]})),
            "alice"
        );
        assert_eq!(room_title(&json!({"kind":"group","name":"team"})), "team");
    }
    #[test]
    fn composer_does_not_lose_unsent_changes() {
        let (mut app, _) = init();
        app.room = "r".into();
        app.draft = "first".into();
        app.reply = "one".into();
        app.sending = true;
        let _ = update(&mut app, Message::Draft("edited while sending".into()));
        let _ = update(&mut app, Message::Sent(Ok(()), "r".into(), "first".into()));
        assert_eq!(app.draft, "edited while sending");
        let _ = update(
            &mut app,
            Message::Sent(
                Err("network".into()),
                "r".into(),
                "edited while sending".into(),
            ),
        );
        assert_eq!(app.draft, "edited while sending");
        assert_eq!(app.error, "network");
    }
    #[test]
    fn reply_and_edit_modes_are_exclusive() {
        let (mut app, _) = init();
        let _ = update(&mut app, Message::Edit("one".into(), "text".into()));
        let _ = update(&mut app, Message::Reply("two".into()));
        assert_eq!(app.reply, "two");
        assert!(app.editing.is_empty());
    }
}
