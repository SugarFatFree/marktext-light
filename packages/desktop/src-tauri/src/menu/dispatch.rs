// Menu-event dispatch. Translates a menu item's `<group>:<type>` id into the
// same `mt::*` event the Electron main process used to `webContents.send`, then
// emits it so the renderer's existing listeners (reached through the bridge
// shim) handle it unchanged.

use std::path::PathBuf;

use serde_json::json;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_dialog::{DialogExt, FilePath};

/// Desktop file dialogs always return a real filesystem path (the `Url` variant
/// is Android `content://` only), so map it to a `PathBuf` and drop anything else.
fn to_pathbuf(selected: Option<FilePath>) -> Option<PathBuf> {
    match selected {
        Some(FilePath::Path(p)) => Some(p),
        _ => None,
    }
}

const MARKDOWN_EXTS: [&str; 11] = [
    "md", "markdown", "mdown", "mkdn", "mkd", "mdwn", "mdtxt", "mdtext", "mdx", "text", "txt",
];

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let Some((group, arg)) = split_id(id) else {
        return;
    };

    match group {
        // Editor actions — payload shapes mirror the old IPC channels exactly.
        "edit" => emit(app, "mt::editor-edit-action", json!(arg)),
        "para" => emit(app, "mt::editor-paragraph-action", json!({ "type": arg })),
        "fmt" => emit(app, "mt::editor-format-action", json!({ "type": arg })),
        "viewmode" => emit(app, "mt::toggle-view-mode-entry", json!(arg)),
        "viewlayout" => emit(app, "mt::toggle-view-layout-entry", json!(arg)),
        "cmd" => emit(app, "mt::execute-command-by-id", json!(arg)),

        // File actions that are pure renderer events.
        "file" => match arg {
            "save" => emit(app, "mt::editor-ask-file-save", json!(null)),
            "save-as" => emit(app, "mt::editor-ask-file-save-as", json!(null)),
            "close-tab" => emit(app, "mt::editor-close-tab", json!(null)),
            "new-tab" => emit(app, "mt::new-untitled-tab", json!(null)),
            "rename" => emit(app, "mt::editor-rename-file", json!(null)),
            "move" => emit(app, "mt::editor-move-file", json!(null)),
            "open" => open_file(app),
            "open-folder" => open_folder(app),
            _ => {}
        },

        "help" if arg == "about" => emit(app, "mt::about-dialog", json!(null)),

        _ => {}
    }
}

fn split_id(id: &str) -> Option<(&str, &str)> {
    id.split_once(':')
}

fn emit<R: Runtime>(app: &AppHandle<R>, channel: &str, payload: serde_json::Value) {
    if let Err(err) = app.emit(channel, payload) {
        eprintln!("[menu] failed to emit {channel}: {err}");
    }
}

/// Native "Open File…": pick a markdown file, read it, and hand the renderer a
/// MarkdownDocument via `mt::open-new-tab` (the channel the editor opens into).
fn open_file<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    app.dialog()
        .file()
        .add_filter("Markdown", &MARKDOWN_EXTS)
        .pick_file(move |selected| {
            let Some(path) = to_pathbuf(selected) else {
                return;
            };
            match std::fs::read_to_string(&path) {
                Ok(markdown) => {
                    let doc = json!({
                        "markdown": markdown,
                        "filename": file_name(&path),
                        "pathname": path.to_string_lossy(),
                    });
                    emit(&handle, "mt::open-new-tab", json!([doc, null_opts(), true]));
                }
                Err(err) => eprintln!("[menu] open failed: {err}"),
            }
        });
}

/// Native "Open Folder…": pick a directory and open it in the sidebar tree.
fn open_folder<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    app.dialog().file().pick_folder(move |selected| {
        let Some(path) = to_pathbuf(selected) else {
            return;
        };
        emit(&handle, "mt::open-directory", json!(path.to_string_lossy()));
    });
}

fn file_name(path: &PathBuf) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn null_opts() -> serde_json::Value {
    serde_json::Value::Null
}
