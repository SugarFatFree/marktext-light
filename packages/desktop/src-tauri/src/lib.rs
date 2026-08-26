// Tauri entry point. Registers the plugin set and the command surface that the
// renderer's bridge shim (src/renderer/src/tauri-bridge) invokes in place of the
// old Electron preload → ipcMain path.

mod commands;
mod menu;

use tauri::{Emitter, Manager};

/// A second launch (CLI, file association, dock/taskbar) must not start another
/// process: opening several documents means several tabs in the one window.
/// Focus the existing window and hand it whatever file the new argv named,
/// through the same `mt::open-new-tab` channel the menu's Open File uses.
fn handle_second_instance(app: &tauri::AppHandle, argv: Vec<String>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let Some(file) = commands::boot::file_from_args(argv.into_iter().skip(1)) else {
        return;
    };
    if let Err(err) = app.emit("mt::open-new-tab", serde_json::json!([file, null, true])) {
        eprintln!("[single-instance] failed to emit mt::open-new-tab: {err}");
    }
}

/// Wall-clock since the process began, for the startup trace.
///
/// The renderer can time its own half (navigation timing), but everything
/// before the first line of JavaScript — process spawn, plugin registration,
/// menu construction, WebView creation — is invisible from there. On a report
/// of "three seconds to first content" that is exactly the half nobody can see,
/// so it is printed: one line, on stderr, visible when the binary is run from a
/// terminal.
fn trace_startup(stage: &str, started: std::time::Instant) {
    eprintln!(
        "[startup] {stage}: {} ms",
        started.elapsed().as_millis()
    );
}

pub fn run() {
    let started = std::time::Instant::now();

    tauri::Builder::default()
        // Must be registered first — plugins run in registration order and this
        // one decides whether the process survives at all.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_second_instance(app, argv);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            trace_startup("setup entered", started);
            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;
            trace_startup("menu built", started);
            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            // fs::* — mirror of the mt::fs:: channels
            commands::fs::is_file,
            commands::fs::is_directory,
            commands::fs::path_exists,
            commands::fs::is_executable,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::output_file,
            commands::fs::ensure_dir,
            commands::fs::empty_dir,
            commands::fs::copy_path,
            commands::fs::move_path,
            commands::fs::unlink,
            commands::fs::trash_item,
            commands::fs::readdir,
            commands::fs::readdir_kinds,
            commands::fs::stat,
            // project tree
            commands::project::scan_project,
            // project-wide search (replaces the bundled ripgrep binary)
            commands::search::rg_start,
            commands::search::rg_cancel,
            // filesystem watching for the sidebar tree
            commands::watcher::watch_project,
            commands::watcher::unwatch_project,
            commands::watcher::watch_open_files,
            // paths::*
            commands::paths::is_image,
            commands::paths::is_same_path,
            // cmd::*
            commands::cmd::command_exists,
            commands::cmd::pandoc_to_markdown,
            // boot
            commands::boot::boot_info,
            commands::boot::load_locale,
            // custom top menu bar (frameless Windows/Linux)
            menu::dispatch_menu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MarkText");
}
