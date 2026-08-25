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
use notify::event::{CreateKind, ModifyKind, RemoveKind};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use super::glob::{self, Exclusion};
use super::project::is_skipped_dir;

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

/// Patterns the user excluded from the tree. Held beside the watcher so event
/// filtering agrees with what `scan_project` was told to skip.
fn tree_exclusions() -> &'static Mutex<Vec<Exclusion>> {
    static EXCLUSIONS: OnceLock<Mutex<Vec<Exclusion>>> = OnceLock::new();
    EXCLUSIONS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Watches the files behind open tabs, which may live outside the project.
fn open_file_watcher() -> &'static Mutex<Option<RecommendedWatcher>> {
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

/// Events from paths the tree never shows. The skip list is `scan_project`'s
/// own, so the two cannot drift apart.
fn is_ignored(path: &Path) -> bool {
    let in_skipped_dir = path
        .components()
        .any(|component| is_skipped_dir(&component.as_os_str().to_string_lossy()));
    if in_skipped_dir {
        return true;
    }
    tree_exclusions()
        .lock()
        .map(|exclusions| glob::is_excluded(path, &exclusions))
        .unwrap_or(false)
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
            // Every rename shape, not just the combined one: inotify reports a
            // rename as separate `From` and `To` events, and matching only
            // `Any | Both` sent those to `emit_changed`, which updates an mtime
            // on an entry the tree does not have — so a renamed file never
            // appeared under its new name. Existence tells the two apart
            // whatever the backend calls them.
            EventKind::Modify(ModifyKind::Name(_)) => {
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
pub fn watch_project(
    app: AppHandle,
    path: String,
    exclusions: Vec<String>,
) -> Result<(), String> {
    let root = std::path::PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    *tree_exclusions().lock().map_err(|e| e.to_string())? = glob::compile(&exclusions);

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


/// Watch the files behind open tabs and report changes to them.
///
/// Only a signal goes out — `pathname` and what happened. Turning that into a
/// document is the bridge's job, and it already does exactly that when opening
/// a file, so re-implementing encoding and line-ending detection here would be
/// a second, divergent copy.
///
/// The whole set is re-watched on every call rather than diffed: a tab list is
/// a handful of paths, and tracking additions and removals separately would be
/// more state than the saving is worth.
#[tauri::command]
pub fn watch_open_files(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        if let Ok(mut active) = open_file_watcher().lock() {
            *active = None;
        }
        return Ok(());
    }

    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        let Ok(event) = result else { return };
        let kind = match event.kind {
            EventKind::Remove(_) => "unlink",
            EventKind::Modify(_) | EventKind::Create(_) => "change",
            _ => return,
        };
        for path in &event.paths {
            if let Err(err) = handle.emit(
                "mt::file-changed-on-disk",
                json!({ "pathname": path.to_string_lossy(), "kind": kind }),
            ) {
                eprintln!("[watcher] failed to emit file change: {err}");
            }
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .configure(notify::Config::default().with_poll_interval(DEBOUNCE))
        .map_err(|e| e.to_string())?;

    for path in &paths {
        let file = Path::new(path);
        if !file.is_file() {
            continue;
        }
        // NonRecursive: these are files, and a directory slipping in should not
        // pull its whole subtree into the watch.
        if let Err(err) = watcher.watch(file, RecursiveMode::NonRecursive) {
            eprintln!("[watcher] cannot watch {path}: {err}");
        }
    }

    let mut active = open_file_watcher().lock().map_err(|e| e.to_string())?;
    *active = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_from_skipped_directories_are_dropped_at_any_depth() {
        assert!(is_ignored(Path::new("/p/node_modules/x/readme.md")));
        assert!(is_ignored(Path::new("/p/.git/HEAD")));
        assert!(!is_ignored(Path::new("/p/src/readme.md")));
        // The tree shows dot-directories, so their events matter.
        assert!(!is_ignored(Path::new("/p/.github/workflow.md")));
    }

    #[test]
    fn the_watcher_skips_exactly_what_the_scan_skips() {
        // Not a restatement of the list: it asserts that both sides read the
        // same one, which is what keeps the watcher from adding back entries
        // the initial scan left out.
        for name in ["node_modules", ".git", "app.asar", "src", ".github"] {
            let path = std::path::PathBuf::from("/p").join(name).join("a.md");
            assert_eq!(
                is_ignored(&path),
                is_skipped_dir(name),
                "watcher and scan disagree about {name}"
            );
        }
    }
}
