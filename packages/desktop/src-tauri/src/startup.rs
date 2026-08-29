// Startup timings, written to a file.
//
// On Windows a released Tauri app is a GUI-subsystem binary with no console
// attached, so `eprintln!` goes nowhere even when the exe is launched from a
// terminal. A file is the only place a user can hand back.
//
// Both halves of startup land here: the shell's own phases, and the renderer's,
// forwarded through the `startup_trace` command. Subtracting the renderer's
// first mark from the shell's total gives everything that happens before the
// first line of JavaScript — process spawn and WebView creation — which is the
// part neither side can see on its own.
//
// The file is truncated on each launch: it describes the last run, not a
// history, so it cannot grow without bound.

use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

static STARTED: OnceLock<Instant> = OnceLock::new();

struct Sink {
    path: Option<PathBuf>,
    /// Lines recorded before the app handle existed to resolve a directory.
    pending: Vec<String>,
}

static SINK: OnceLock<Mutex<Sink>> = OnceLock::new();

fn sink() -> &'static Mutex<Sink> {
    SINK.get_or_init(|| {
        Mutex::new(Sink {
            path: None,
            pending: Vec::new(),
        })
    })
}

/// Epoch milliseconds, so a line can be lined up against when the icon was
/// double-clicked. No date formatting: that would mean a new dependency, and a
/// dependency here would mean a lockfile change for a diagnostic.
fn wall_clock_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Start the clock. Call from the first line of `run()`.
pub fn begin() {
    let _ = STARTED.set(Instant::now());
    trace("process start");
}

pub fn trace(stage: &str) {
    let elapsed = STARTED
        .get()
        .map(|s| s.elapsed().as_millis())
        .unwrap_or(0);
    let line = format!("{} +{:>6} ms  {}", wall_clock_ms(), elapsed, stage);

    eprintln!("[startup] {line}");

    let Ok(mut sink) = sink().lock() else {
        return;
    };
    match sink.path.clone() {
        Some(path) => append(&path, &line),
        None => sink.pending.push(line),
    }
}

/// Point the log at a directory, flushing anything recorded before now.
pub fn attach(dir: PathBuf) {
    let path = dir.join("startup.log");
    if create_dir_all(&dir).is_err() {
        return;
    }
    // Truncate: this file is the last run, not a log history.
    let _ = std::fs::write(&path, b"");

    let Ok(mut sink) = sink().lock() else {
        return;
    };
    for line in std::mem::take(&mut sink.pending) {
        append(&path, &line);
    }
    sink.path = Some(path);
}

pub fn log_path() -> Option<PathBuf> {
    sink().lock().ok().and_then(|s| s.path.clone())
}

fn append(path: &PathBuf, line: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

/// Record a phase the renderer timed, in milliseconds since its navigation
/// start. Kept as its own stage name so the two clocks are not confused.
#[tauri::command]
pub fn startup_trace(stage: String, since_navigation_ms: f64) {
    trace(&format!(
        "renderer: {stage} (+{:.0} ms since navigation)",
        since_navigation_ms
    ));
}

/// Where the log went, so the renderer can say it out loud.
///
/// Saves a person hunting through `%LOCALAPPDATA%` for a file whose location
/// depends on the platform's conventions rather than anything they chose.
#[tauri::command]
pub fn startup_log_path() -> Option<String> {
    log_path().map(|p| p.to_string_lossy().into_owned())
}
