//! Experimental native client. It intentionally does not replace the existing media UI.
use hunty_core::{Handle, Opts};
use iced::{
    widget::{button, column, container, row, scrollable, text, text_input},
    Color, Element, Font, Length, Task, Theme,
};
use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};

struct App {
    core: Option<Handle>,
    state: Value,
    room: String,
    messages: Vec<Value>,
    draft: String,
    nick: String,
    friend_code: String,
    own_code: String,
    group_name: String,
    reply: String,
    editing: String,
    pending_delete: String,
    error: String,
    sending: bool,
}
#[derive(Clone, Debug)]
enum Message {
    Started(Result<Handle, String>),
    Tick,
    Snapshot(Result<(Value, String, Vec<Value>), String>),
    Room(String),
    Draft(String),
    Nick(String),
    FriendCode(String),
    GroupName(String),
    Reply(String),
    Edit(String, String),
    DeleteConfirm(String),
    Command(Value, Action),
    CommandResult(Result<Value, String>, Action),
    CopyCode,
    Register,
    OpenSelf,
    Send,
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
async fn start() -> Result<Handle, String> {
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
    tokio::spawn(async move {
        let _lock = lock;
        while events.recv().await.is_some() {}
    });
    Ok(core)
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
            state: Value::Null,
            room: String::new(),
            messages: vec![],
            draft: String::new(),
            nick: String::new(),
            friend_code: String::new(),
            own_code: String::new(),
            group_name: String::new(),
            reply: String::new(),
            editing: String::new(),
            pending_delete: String::new(),
            error: String::new(),
            sending: false,
        },
        Task::perform(start(), Message::Started),
    )
}
fn update(app: &mut App, m: Message) -> Task<Message> {
    match m {
        Message::Started(Ok(h)) => {
            app.core = Some(h.clone());
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
                        if let Some(id) = v["id"].as_str() {
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
fn view(app: &App) -> Element<'_, Message> {
    let accent = Color::from_rgb8(109, 227, 179);
    let me = app.state["me"]["profile"]["nick"]
        .as_str()
        .unwrap_or("гость");
    let mut sidebar = column![
        text("HUNTY_ //").size(24).color(accent),
        text("P2P  ·  native").size(13),
        text(" "),
        text("[ ЧАТЫ ]").size(14).color(accent)
    ]
    .spacing(8);
    if let Some(rooms) = app.state["rooms"].as_array() {
        for r in rooms {
            let id = r["id"].as_str().unwrap_or("").to_string();
            let marker = if id == app.room { ">" } else { "#" };
            let unread = r["unread"].as_u64().unwrap_or(0);
            let name = if unread > 0 {
                format!("{marker} {} ({unread})", room_title(r))
            } else {
                format!("{marker} {}", room_title(r))
            };
            sidebar = sidebar.push(
                button(text(name).size(15))
                    .width(Length::Fill)
                    .on_press(Message::Room(id)),
            );
        }
    }
    if app.state["me"]["onboarded"] == true {
        sidebar = sidebar
            .push(button("+ избранное").on_press(Message::OpenSelf))
            .push(text(" "))
            .push(text("[ НОВАЯ ГРУППА ]").size(13).color(accent))
            .push(text_input("название", &app.group_name).on_input(Message::GroupName))
            .push(button("+ создать").on_press(Message::Command(
                json!({"cmd":"room_create", "name":app.group_name}),
                Action::OpenRoom,
            )));
    }
    sidebar = sidebar
        .push(text(" "))
        .push(text(format!("● @{me}")).color(accent));
    let mut body = column![
        text("# HUNTY  /  ЧАТ").size(23).color(accent),
        text("Нативный клиент · экспериментальная версия").size(13),
        text(" ")
    ]
    .spacing(10);
    if !app.error.is_empty() {
        body = body.push(text(format!("! {}", app.error)).color(Color::from_rgb8(255, 115, 125)));
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
            "Выбери чат слева. Звонки, видео и вложения пока доступны только в прежнем интерфейсе.",
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
            let msg = m["text"]
                .as_str()
                .filter(|x| !x.is_empty())
                .unwrap_or("[вложение или событие — открой в прежнем клиенте]");
            let id = m["id"].as_str().unwrap_or("").to_string();
            let mine = m["from"].as_str() == app.state["me"]["peer"].as_str();
            let mut actions = row![
                button("↩").on_press(Message::Reply(id.clone())),
                button("+1").on_press(Message::Command(
                    json!({"cmd":"react","room":app.room,"id":id,"e":"👍"}),
                    Action::Refresh
                ))
            ]
            .spacing(5);
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
            msgs = msgs.push(
                column![
                    text(format!("{who} >")).size(14).color(accent),
                    text(quote).size(13),
                    text(msg.to_owned()).size(16),
                    text(reactions).size(13),
                    actions
                ]
                .spacing(3),
            );
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
    let mut friends = column![text("[ ДРУЗЬЯ ]").size(15).color(accent), text(" ")].spacing(8);
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
                            button("✓").on_press(Message::Command(
                                json!({"cmd":"friend_accept","peer":peer}),
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
            .push(text("[ ДОБАВИТЬ ]").size(13).color(accent))
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
            background: Some(Color::from_rgb8(24, 28, 36).into()),
            ..Default::default()
        })
    }
    let layout = row![
        panel(
            container(scrollable(sidebar))
                .width(220)
                .height(Length::Fill)
                .padding(16)
        ),
        container(body)
            .width(Length::Fill)
            .height(Length::Fill)
            .padding(20),
        panel(
            container(scrollable(friends))
                .width(245)
                .height(Length::Fill)
                .padding(16)
        )
    ];
    container(layout)
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}
fn main() -> iced::Result {
    iced::application("Hunty // iced preview", update, view)
        .theme(|_| Theme::Dark)
        .default_font(Font::MONOSPACE)
        .subscription(|_: &App| iced::time::every(Duration::from_secs(3)).map(|_| Message::Tick))
        .window_size((1100.0, 720.0))
        .run_with(init)
}

#[cfg(test)]
mod tests {
    use super::*;
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
