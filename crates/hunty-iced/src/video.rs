//! One clip player per chat window. GStreamer runs off the iced thread; decoded
//! frames use a single-slot queue so a slow renderer never accumulates video.
use gst::prelude::*;
use gstreamer as gst;
use std::{
    io::Write,
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

#[derive(Debug)]
pub enum Control {
    Play,
    Pause,
    Seek(f64),
    Stop,
}
#[derive(Debug)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
    #[cfg(test)]
    pub pts: Option<f64>,
}
#[derive(Debug)]
pub enum Event {
    Progress { position: f64, duration: f64 },
    Ended,
    Error(String),
}
#[derive(Default)]
struct EventSlots {
    progress: Option<(f64, f64)>,
    ended: bool,
    error: Option<String>,
}
fn publish(events: &Arc<Mutex<EventSlots>>, event: Event) {
    if let Ok(mut slots) = events.lock() {
        match event {
            Event::Progress { position, duration } => slots.progress = Some((position, duration)),
            Event::Ended => slots.ended = true,
            Event::Error(e) => slots.error = Some(e),
        }
    }
}
pub struct Player {
    controls: mpsc::SyncSender<Control>,
    frames: Arc<Mutex<Option<Frame>>>,
    events: Arc<Mutex<EventSlots>>,
}
impl Player {
    pub fn start(bytes: Vec<u8>, silent: bool) -> Self {
        let (controls, receiver) = mpsc::sync_channel(8);
        let frames = Arc::new(Mutex::new(None));
        let frame_tx = Arc::clone(&frames);
        let events = Arc::new(Mutex::new(EventSlots::default()));
        let event_tx = Arc::clone(&events);
        thread::spawn(move || {
            if let Err(error) = run(bytes, silent, receiver, frame_tx, &event_tx) {
                publish(&event_tx, Event::Error(error));
            }
        });
        Self {
            controls,
            frames,
            events,
        }
    }
    pub fn send(&self, c: Control) {
        let _ = self.controls.try_send(c);
    }
    pub fn frame(&self) -> Option<Frame> {
        self.frames.try_lock().ok()?.take()
    }
    pub fn event(&self) -> Option<Event> {
        let mut slots = self.events.try_lock().ok()?;
        if let Some(e) = slots.error.take() {
            return Some(Event::Error(e));
        }
        if std::mem::take(&mut slots.ended) {
            return Some(Event::Ended);
        }
        slots
            .progress
            .take()
            .map(|(position, duration)| Event::Progress { position, duration })
    }
}
impl Drop for Player {
    fn drop(&mut self) {
        self.send(Control::Stop);
    }
}

fn push_frame(
    sample: gst::Sample,
    frames: &Arc<Mutex<Option<Frame>>>,
) -> Result<gst::FlowSuccess, gst::FlowError> {
    let caps = sample.caps().ok_or(gst::FlowError::Error)?;
    let info = gstreamer_video::VideoInfo::from_caps(caps).map_err(|_| gst::FlowError::Error)?;
    let (width, height) = (info.width(), info.height());
    if width == 0 || height == 0 || width > 3840 || height > 2160 {
        return Err(gst::FlowError::Error);
    }
    let row_bytes = width as usize * 4;
    let stride = info.stride()[0];
    if stride < row_bytes as i32 {
        return Err(gst::FlowError::Error);
    }
    let offset = info.offset()[0];
    let buffer = sample.buffer().ok_or(gst::FlowError::Error)?;
    let map = buffer.map_readable().map_err(|_| gst::FlowError::Error)?;
    let data = map.as_slice();
    let last_end = offset
        .checked_add((height as usize - 1).saturating_mul(stride as usize))
        .and_then(|x| x.checked_add(row_bytes))
        .ok_or(gst::FlowError::Error)?;
    if last_end > data.len() {
        return Err(gst::FlowError::Error);
    }
    // Replace, rather than queue, the previous frame. This also ensures a seek's
    // preroll replaces an old paused frame even when the GUI is temporarily slow.
    let mut slot = match frames.try_lock() {
        Ok(slot) => slot,
        Err(std::sync::TryLockError::WouldBlock) => return Ok(gst::FlowSuccess::Ok),
        Err(std::sync::TryLockError::Poisoned(_)) => return Err(gst::FlowError::Error),
    };
    let mut pixels = Vec::with_capacity(row_bytes * height as usize);
    for y in 0..height as usize {
        let i = offset + y * stride as usize;
        pixels.extend_from_slice(&data[i..i + row_bytes]);
    }
    *slot = Some(Frame {
        width,
        height,
        pixels,
        #[cfg(test)]
        pts: buffer.pts().map(|t| t.nseconds() as f64 / 1e9),
    });
    Ok(gst::FlowSuccess::Ok)
}

fn run(
    bytes: Vec<u8>,
    silent: bool,
    controls: mpsc::Receiver<Control>,
    frames: Arc<Mutex<Option<Frame>>>,
    events: &Arc<Mutex<EventSlots>>,
) -> Result<(), String> {
    gst::init().map_err(|e| format!("GStreamer: {e}"))?;
    let mut file = tempfile::Builder::new()
        .prefix("hunty-clip-")
        .tempfile()
        .map_err(|e| e.to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.flush())
        .map_err(|e| format!("Не удалось подготовить клип: {e}"))?;
    drop(bytes);
    let uri =
        url::Url::from_file_path(file.path()).map_err(|_| "Не удалось открыть клип".to_string())?;
    let sink = gst::ElementFactory::make("appsink")
        .build()
        .map_err(|e| format!("Видеовывод недоступен: {e}"))?
        .downcast::<gstreamer_app::AppSink>()
        .map_err(|_| "Не удалось создать видеовывод".to_string())?;
    sink.set_caps(Some(
        &gst::Caps::builder("video/x-raw")
            .field("format", "RGBA")
            .build(),
    ));
    sink.set_max_buffers(1);
    sink.set_drop(true);
    let sample_tx = frames.clone();
    sink.set_callbacks(
        gstreamer_app::AppSinkCallbacks::builder()
            .new_sample(move |sink| {
                push_frame(
                    sink.pull_sample().map_err(|_| gst::FlowError::Eos)?,
                    &sample_tx,
                )
            })
            .new_preroll(move |sink| {
                push_frame(
                    sink.pull_preroll().map_err(|_| gst::FlowError::Eos)?,
                    &frames,
                )
            })
            .build(),
    );
    let playbin = gst::ElementFactory::make("playbin")
        .property("uri", uri.as_str())
        .build()
        .map_err(|e| format!("Плеер недоступен: {e}"))?;
    playbin.set_property("video-sink", &sink);
    if silent {
        let audio = gst::ElementFactory::make("fakesink")
            .build()
            .map_err(|e| e.to_string())?;
        playbin.set_property("audio-sink", audio);
    }
    let bus = playbin.bus().ok_or("Не удалось открыть медиапоток")?;
    playbin
        .set_state(gst::State::Playing)
        .map_err(|e| format!("Не удалось воспроизвести клип: {e}"))?;
    let mut last_progress = Instant::now() - Duration::from_secs(1);
    let mut ended = false;
    loop {
        match controls.recv_timeout(Duration::from_millis(25)) {
            Ok(Control::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Ok(Control::Play) => {
                if ended {
                    let _ = playbin.seek_simple(
                        gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
                        gst::ClockTime::ZERO,
                    );
                    ended = false;
                }
                if let Err(e) = playbin.set_state(gst::State::Playing) {
                    publish(events, Event::Error(e.to_string()));
                }
            }
            Ok(Control::Pause) => {
                if let Err(e) = playbin.set_state(gst::State::Paused) {
                    publish(events, Event::Error(e.to_string()));
                }
            }
            Ok(Control::Seek(seconds)) => {
                let seconds = if seconds.is_finite() {
                    seconds.max(0.0)
                } else {
                    0.0
                };
                if let Err(e) = playbin.seek_simple(
                    gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
                    gst::ClockTime::from_nseconds((seconds * 1e9) as u64),
                ) {
                    publish(events, Event::Error(format!("Не удалось перемотать: {e}")));
                } else {
                    ended = false;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        while let Some(message) = bus.pop() {
            use gst::MessageView;
            match message.view() {
                MessageView::Eos(..) => {
                    ended = true;
                    publish(events, Event::Ended);
                }
                MessageView::Error(e) => {
                    publish(
                        events,
                        Event::Error(format!("Ошибка воспроизведения: {}", e.error())),
                    );
                }
                _ => {}
            }
        }
        if last_progress.elapsed() >= Duration::from_millis(200) {
            let pos = playbin
                .query_position::<gst::ClockTime>()
                .map(|x| x.nseconds() as f64 / 1e9)
                .unwrap_or(0.0);
            let dur = playbin
                .query_duration::<gst::ClockTime>()
                .map(|x| x.nseconds() as f64 / 1e9)
                .unwrap_or(0.0);
            publish(
                events,
                Event::Progress {
                    position: pos,
                    duration: dur,
                },
            );
            last_progress = Instant::now();
        }
    }
    let _ = playbin.set_state(gst::State::Null);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn webm_can_pause_seek_and_resume_without_frame_backlog() {
        let bytes = include_bytes!("../tests/fixtures/seek.webm").to_vec();
        let player = Player::start(bytes, true);
        let deadline = Instant::now() + Duration::from_secs(8);
        let mut first = None;
        let mut duration = 0.0;
        while Instant::now() < deadline && (first.is_none() || duration < 3.5) {
            if let Some(f) = player.frame() {
                assert_eq!(f.pixels.len(), f.width as usize * f.height as usize * 4);
                first = f.pts;
            }
            while let Some(e) = player.event() {
                match e {
                    Event::Progress { duration: d, .. } => duration = d,
                    Event::Error(e) => panic!("{e}"),
                    _ => {}
                }
            }
            thread::sleep(Duration::from_millis(15));
        }
        assert!(first.is_some(), "no decoded frame");
        assert!(duration >= 3.5, "duration not available: {duration}");
        player.send(Control::Pause);
        thread::sleep(Duration::from_millis(300));
        while player.frame().is_some() {}
        while player.event().is_some() {}
        player.send(Control::Seek(2.5));
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut sought = false;
        let mut frame_at_seek = false;
        while Instant::now() < deadline && !(sought && frame_at_seek) {
            while let Some(e) = player.event() {
                match e {
                    Event::Progress { position, .. } if position >= 2.35 && position <= 2.8 => {
                        sought = true
                    }
                    Event::Error(e) => panic!("{e}"),
                    _ => {}
                }
            }
            if let Some(f) = player.frame() {
                if f.pts.unwrap_or(0.0) >= 2.35 {
                    frame_at_seek = true;
                }
            }
            thread::sleep(Duration::from_millis(15));
        }
        assert!(sought, "seek did not update position");
        assert!(
            frame_at_seek,
            "seek did not render the target frame while paused"
        );
        player.send(Control::Play);
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut resumed = false;
        while Instant::now() < deadline && !resumed {
            if let Some(f) = player.frame() {
                resumed = f.pts.unwrap_or(0.0) >= 2.7;
            }
            if let Some(Event::Error(e)) = player.event() {
                panic!("{e}");
            }
            thread::sleep(Duration::from_millis(15));
        }
        assert!(resumed, "video failed to resume after seek");
    }
}
