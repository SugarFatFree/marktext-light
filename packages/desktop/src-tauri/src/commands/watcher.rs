// Filesystem watching for the sidebar tree, in place of the chokidar watcher
// the Electron main process ran (src/main/filesystem/watcher.ts).
//
// Emits the same `mt::update-object-tree` shapes `scan_project` is replayed as,
// so `tauri-bridge/project.ts` needs no second code path: `add` / `addDir` for
// new entries, `unlink` / `unlinkDir` for removed ones, `change` for a touched
// file's mtime.
//
// One watcher at a time — the sidebar shows one project — so opening another
// folder replaces the previous watch rather than accumulating them.

use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, UNIX_EPOCH};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
use serde_json::json;
use tauri::{AppHandle, Emitter};

const MARKDOWN_EXTENSIONS: [&str; 11] = [
    "markdown", "mdown", "mkdn", "md", "mkd", "mdwn", "mdtxt", "mdtext", "mdx", "text", "txt",
];

/// Debounce window. Editors write a file in several syscalls, and a save would
/// otherwise arrive as a burst of identical `change` events.
const DEBOUNCE: Duration = Duration::from_millis(250);

fn active_watcher() -> &'static Mutex<Option<RecommendedWatcher>> {
    static WATCHER: OnceLock<Mutex<Option<RecommendedWatcher>>> = OnceLock::new();
    WATCHER.get_or_init(|| Mutex::new(None))
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            MARKDOWN_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

/// Entries the tree never shows, so their events are noise: hidden files, and
/// anything inside a directory the scan also skips.
fn is_ignored(path: &Path) -> bool {
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        name.starts_with('.') || name == "node_modules"
    })
}

fn epoch_ms(time: std::io::Result<std::time::SystemTime>) -> f64 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

fn emit(app: &AppHandle, body: serde_json::Value) {
    if let Err(err) = app.emit("mt::update-object-tree", body) {
        eprintln!("[watcher] failed to emit: {err}");
    }
}

fn emit_added(app: &AppHandle, path: &Path) {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let pathname = path.to_string_lossy().into_owned();

    let Ok(meta) = std::fs::metadata(path) else {
        // Created and removed again before we looked; the matching remove event
        // is still on its way.
        return;
    };

    if meta.is_dir() {
        emit(
            app,
            json!({
                "type": "addDir",
                "change": {
                    "pathname": pathname,
                    "name": name,
                    "isCollapsed": true,
                    "isDirectory": true,
                    "isFile": false,
                    "isMarkdown": false,
                    "folders": [],
                    "files": [],
                },
            }),
        );
    } else if is_markdown(path) {
        emit(
            app,
            json!({
                "type": "add",
                "change": {
                    "pathname": pathname,
                    "name": name,
                    "isFile": true,
                    "isDirectory": false,
                    "isMarkdown": true,
                    "birthTime": epoch_ms(meta.created()),
                    "mtimeMs": epoch_ms(meta.modified()),
                },
            }),
        );
    }
}

fn emit_removed(app: &AppHandle, path: &Path) {
    let pathname = path.to_string_lossy().into_owned();
    // The path is gone, so its kind can only be guessed from the name. Send
    // both: the tree drops whichever does not match anything it holds.
    emit(app, json!({ "type": "unlink", "change": { "pathname": pathname } }));
    emit(
        app,
        json!({ "type": "unlinkDir", "change": { "pathname": pathname } }),
    );
}

fn emit_changed(app: &AppHandle, path: &Path) {
    if !is_markdown(path) {
        return;
    }
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    emit(
        app,
        json!({
            "type": "change",
            "change": {
                "pathname": path.to_string_lossy(),
                "mtimeMs": epoch_ms(meta.modified()),
            },
        }),
    );
}

fn handle_event(app: &AppHandle, event: Event) {
    for path in event.paths.iter().filter(|p| !is_ignored(p)) {
        match event.kind {
            EventKind::Create(CreateKind::Any | CreateKind::File | CreateKind::Folder) => {
                emit_added(app, path)
            }
            EventKind::Remove(RemoveKind::Any | RemoveKind::File | RemoveKind::Folder) => {
                emit_removed(app, path)
            }
            // A rename arrives as two paths; whichever still exists is the
            // destination, so let the existence check decide.
            EventKind::Modify(ModifyKind::Name(RenameMode::Any | RenameMode::Both)) => {
                if path.exists() {
                    emit_added(app, path)
                } else {
                    emit_removed(app, path)
                }
            }
            EventKind::Modify(_) => emit_changed(app, path),
            _ => {}
        }
    }
}

/// Watch `path` recursively, replacing any previous watch.
#[tauri::command]
pub fn watch_project(app: AppHandle, path: String) -> Result<(), String> {
    let root = std::path::PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| match result
    {
        Ok(event) => handle_event(&handle, event),
        Err(err) => eprintln!("[watcher] {err}"),
    })
    .map_err(|e| e.to_string())?;

    watcher
        .configure(notify::Config::default().with_poll_interval(DEBOUNCE))
        .map_err(|e| e.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Dropping the previous watcher stops it; holding this one keeps the watch
    // alive past the end of this call.
    let mut active = active_watcher().lock().map_err(|e| e.to_string())?;
    *active = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_project() {
    if let Ok(mut active) = active_watcher().lock() {
        *active = None;
    }
}
