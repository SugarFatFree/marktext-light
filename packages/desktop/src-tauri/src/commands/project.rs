// `scan_project` — one call that walks an opened folder and returns everything
// the sidebar tree needs.
//
// The Electron build got this incrementally from a chokidar watcher, which also
// preloaded every markdown file's *content* into each tree event (see the HACK
// in src/main/filesystem/watcher.ts). The tree drops that content immediately,
// so this returns metadata only — the difference decides how fast a large
// project opens.
//
// One command rather than `readdir` + a `stat` per entry: a project with a few
// thousand files would otherwise cost a few thousand IPC round trips.

use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;

const MARKDOWN_EXTENSIONS: [&str; 11] = [
    "markdown", "mdown", "mkdn", "md", "mkd", "mdwn", "mdtxt", "mdtext", "mdx", "text", "txt",
];

/// Directories never worth walking. Mirrors the watcher's `ignored` predicate.
fn is_ignored_dir(name: &str) -> bool {
    name == "node_modules" || name.ends_with(".asar")
}

fn is_markdown(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            MARKDOWN_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pathname: String,
    name: String,
    is_file: bool,
    is_directory: bool,
    is_markdown: bool,
    /// Epoch ms. The tree sorts on these, so both are always present.
    birth_time: f64,
    mtime_ms: f64,
}

/// How deep to walk. Deep enough for any real project, shallow enough that a
/// stray symlink into `/` cannot hang the scan.
const MAX_DEPTH: usize = 12;

fn walk(dir: &Path, depth: usize, out: &mut Vec<ProjectEntry>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        // Unreadable directory (permissions, race with a delete) — skip it
        // rather than failing the whole scan.
        return;
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        // Hidden entries stay hidden, as they do in the Electron sidebar.
        if name.starts_with('.') {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let path = entry.path();
        let is_directory = meta.is_dir();
        if is_directory && is_ignored_dir(&name) {
            continue;
        }
        // Non-markdown files never appear in the tree.
        if !is_directory && !is_markdown(&name) {
            continue;
        }

        let epoch_ms = |time: std::io::Result<std::time::SystemTime>| -> f64 {
            time.ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0)
        };

        out.push(ProjectEntry {
            pathname: path.to_string_lossy().into_owned(),
            name,
            is_file: !is_directory,
            is_directory,
            is_markdown: !is_directory,
            birth_time: epoch_ms(meta.created()),
            mtime_ms: epoch_ms(meta.modified()),
        });

        if is_directory {
            walk(&path, depth + 1, out);
        }
    }
}

#[tauri::command]
pub fn scan_project(path: String) -> Result<Vec<ProjectEntry>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }
    let mut entries = Vec::new();
    walk(root, 0, &mut entries);
    Ok(entries)
}
