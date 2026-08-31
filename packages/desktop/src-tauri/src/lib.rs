// Tauri entry point. Registers the plugin set and the command surface that the
// renderer's bridge shim (src/renderer/src/tauri-bridge) invokes in place of the
// old Electron preload → ipcMain path.

mod commands;
mod menu;
mod startup;

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

pub fn run() {
    startup::begin();

    tauri::Builder::default()
        // Must be registered first — plugins run in registration order and this
        // one decides whether the process survives at all.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_second_instance(app, argv);
        }))
        // Size, position and maximized/fullscreen are restored from the last
        // run — the `electron-window-state` the Electron build used. The flags
        // are spelled out rather than left at their default, which is all of
        // them, because two of the defaults would break this window:
        //
        //   DECORATIONS — the window is `decorations: false` and draws its own
        //   title bar. Restoring `decorated: true` from a state file written by
        //   some earlier build would put the OS frame back on top of ours.
        //
        //   VISIBLE — a state file that ever recorded a hidden window would
        //   start the app with nothing on screen and no way to ask for it.
        //
        // Position is only restored onto a monitor that still exists: the
        // plugin checks the saved rectangle against `available_monitors()` and
        // leaves placement to the OS when none of them contains it, which is
        // the same guard `ensureWindowPosition` gave the Electron build.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        // Registered last, so its setup runs once every other plugin is
        // initialised. That splits the stretch before the app's own `setup`:
        // process spawn and plugin init up to here, window and WebView
        // creation after it. The first trace put 1.2 s in that range without
        // saying which half, and on Windows the second half is WebView2
        // starting, which is not ours to speed up.
        .plugin(
            // The config type has to be named: a plugin with no configuration
            // gives the compiler nothing to infer `C` from (E0283).
            tauri::plugin::Builder::new("startup-probe")
                .setup(|_app, _api: tauri::plugin::PluginApi<_, ()>| {
                    startup::trace("plugins ready");
                    Ok(())
                })
                .build(),
        )
        .setup(|app| {
            // Resolve the log directory first, so everything recorded before
            // now gets flushed and the rest is written as it happens.
            if let Ok(dir) = app.path().app_log_dir().or_else(|_| app.path().app_data_dir()) {
                startup::attach(dir);
            }
            startup::trace("setup entered");

            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;
            startup::trace("menu built");

            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            startup::startup_trace,
            startup::startup_log_path,
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
            // Loading a markdown document: encoding detection, BOM stripping
            // and line-ending normalisation, which `read_file` does not do.
            commands::markdown::read_markdown_file,
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
