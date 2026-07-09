// Application menu — Rust port of the Electron menu system
// (packages/desktop/src/main/menu). The Electron build sent an IPC event to the
// renderer on each menu click (e.g. `win.webContents.send('mt::editor-edit-action',
// 'undo')`); here the same events are re-emitted over Tauri's event bus, which
// the renderer already listens on via the bridge shim — so no renderer changes.
//
// Menu-item ids encode their dispatch target as `<group>:<type>` (see
// `dispatch`). Native roles (cut/copy/paste/quit/…) use Tauri's
// PredefinedMenuItem and carry no dispatch id.
//
// Scope (phase 2): the full menu tree, accelerators, and click→event dispatch
// for edit/paragraph/format/view/file actions. Not yet ported: i18n labels
// (English placeholders here), keybinding-driven accelerators (defaults here),
// dynamic recent-files/theme submenus, and per-selection checkmark state.

mod dispatch;

use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub use dispatch::handle_menu_event;

/// Build a dispatchable `MenuItem` with an optional accelerator.
fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    label: &str,
    accel: Option<&str>,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let mut b = MenuItemBuilder::with_id(id, label);
    if let Some(a) = accel {
        b = b.accelerator(a);
    }
    b.build(app)
}

#[cfg(target_os = "macos")]
fn app_submenu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "MarkText")
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "cmd:file.preferences", "Preferences", Some("CmdOrCtrl+,"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::services(app, None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()
}

fn file_submenu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "File")
        .item(&item(app, "file:new-tab", "New Tab", Some("CmdOrCtrl+N"))?)
        .item(&item(app, "cmd:file.new-window", "New Window", Some("CmdOrCtrl+Shift+N"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "file:open", "Open File…", Some("CmdOrCtrl+O"))?)
        .item(&item(app, "file:open-folder", "Open Folder…", Some("CmdOrCtrl+Shift+O"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "file:save", "Save", Some("CmdOrCtrl+S"))?)
        .item(&item(app, "file:save-as", "Save As…", Some("CmdOrCtrl+Shift+S"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "cmd:file.export", "Export…", None)?)
        .item(&item(app, "cmd:file.print", "Print…", Some("CmdOrCtrl+P"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "file:rename", "Rename…", None)?)
        .item(&item(app, "file:move", "Move…", None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "file:close-tab", "Close Tab", Some("CmdOrCtrl+W"))?)
        .item(&item(app, "cmd:file.close-window", "Close Window", Some("CmdOrCtrl+Shift+W"))?)
        .build()
}

fn edit_submenu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "Edit")
        .item(&item(app, "edit:undo", "Undo", Some("CmdOrCtrl+Z"))?)
        .item(&item(app, "edit:redo", "Redo", Some("CmdOrCtrl+Shift+Z"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "edit:copyAsMarkdown", "Copy as Markdown", None)?)
        .item(&item(app, "edit:copyAsHtml", "Copy as HTML", None)?)
        .item(&item(app, "edit:pasteAsPlainText", "Paste as Plain Text", Some("CmdOrCtrl+Shift+V"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "edit:selectAll", "Select All", Some("CmdOrCtrl+A"))?)
        .item(&item(app, "edit:duplicate", "Duplicate", None)?)
        .item(&item(app, "edit:createParagraph", "New Paragraph", None)?)
        .item(&item(app, "edit:deleteParagraph", "Delete Paragraph", None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "edit:find", "Find", Some("CmdOrCtrl+F"))?)
        .item(&item(app, "edit:findNext", "Find Next", None)?)
        .item(&item(app, "edit:findPrev", "Find Previous", None)?)
        .item(&item(app, "edit:replace", "Replace", Some("CmdOrCtrl+Alt+F"))?)
        .item(&item(app, "edit:findInFolder", "Find in Folder", None)?)
        .build()
}

fn paragraph_submenu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "Paragraph")
        .item(&item(app, "cmd:paragraph.heading-1", "Heading 1", Some("CmdOrCtrl+1"))?)
        .item(&item(app, "cmd:paragraph.heading-2", "Heading 2", Some("CmdOrCtrl+2"))?)
        .item(&item(app, "cmd:paragraph.heading-3", "Heading 3", Some("CmdOrCtrl+3"))?)
        .item(&item(app, "cmd:paragraph.heading-4", "Heading 4", Some("CmdOrCtrl+4"))?)
        .item(&item(app, "cmd:paragraph.heading-5", "Heading 5", Some("CmdOrCtrl+5"))?)
        .item(&item(app, "cmd:paragraph.heading-6", "Heading 6", Some("CmdOrCtrl+6"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "para:table", "Table", None)?)
        .item(&item(app, "para:pre", "Code Block", None)?)
        .item(&item(app, "para:blockquote", "Quote Block", None)?)
        .item(&item(app, "para:mathblock", "Math Block", None)?)
        .item(&item(app, "para:html", "HTML Block", None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "para:ol-order", "Ordered List", None)?)
        .item(&item(app, "para:ul-bullet", "Bullet List", None)?)
        .item(&item(app, "para:ul-task", "Task List", None)?)
        .item(&item(app, "para:loose-list-item", "Loose List Item", None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "para:paragraph", "Paragraph", None)?)
        .item(&item(app, "para:hr", "Horizontal Line", None)?)
        .item(&item(app, "para:front-matter", "Front Matter", None)?)
        .build()
}

fn format_submenu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "Format")
        .item(&item(app, "fmt:strong", "Strong", Some("CmdOrCtrl+B"))?)
        .item(&item(app, "fmt:em", "Emphasis", Some("CmdOrCtrl+I"))?)
        .item(&item(app, "fmt:u", "Underline", Some("CmdOrCtrl+U"))?)
        .item(&item(app, "fmt:del", "Strikethrough", None)?)
        .item(&item(app, "fmt:mark", "Highlight", None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "fmt:inline_code", "Inline Code", None)?)
        .item(&item(app, "fmt:inline_math", "Inline Math", None)?)
        .item(&item(app, "fmt:sup", "Superscript", None)?)
        .item(&item(app, "fmt:sub", "Subscript", None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "fmt:link", "Hyperlink", Some("CmdOrCtrl+L"))?)
        .item(&item(app, "fmt:image", "Image", Some("CmdOrCtrl+Shift+I"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "fmt:clear", "Clear Format", None)?)
        .build()
}

fn view_submenu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "View")
        .item(&item(app, "viewmode:sourceCode", "Source Code Mode", None)?)
        .item(&item(app, "viewmode:typewriter", "Typewriter Mode", None)?)
        .item(&item(app, "viewmode:focus", "Focus Mode", None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "viewlayout:showSideBar", "Toggle Sidebar", Some("CmdOrCtrl+J"))?)
        .item(&item(app, "viewlayout:showTabBar", "Toggle Tab Bar", None)?)
        .item(&item(app, "viewlayout:toc", "Toggle TOC", None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "cmd:view.command-palette", "Command Palette", Some("CmdOrCtrl+Shift+P"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()
}

fn window_submenu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()
}

fn help_submenu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "Help")
        .item(&item(app, "cmd:help.learn-more", "Learn More", None)?)
        .item(&item(app, "help:about", "About MarkText", None)?)
        .build()
}

/// Build the full application menu for the given app handle.
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;

    #[cfg(target_os = "macos")]
    menu.append(&app_submenu(app)?)?;

    menu.append(&file_submenu(app)?)?;
    menu.append(&edit_submenu(app)?)?;
    menu.append(&paragraph_submenu(app)?)?;
    menu.append(&format_submenu(app)?)?;
    menu.append(&view_submenu(app)?)?;
    menu.append(&window_submenu(app)?)?;
    menu.append(&help_submenu(app)?)?;

    Ok(menu)
}
