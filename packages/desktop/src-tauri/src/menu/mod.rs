// Application menu — Rust port of the Electron menu system
// (packages/desktop/src/main/menu). The Electron build sent an IPC event to the
// renderer on each menu click (e.g. `win.webContents.send('mt::editor-edit-action',
// 'undo')`); here the same events are re-emitted over Tauri's event bus, which
// the renderer already listens on via the bridge shim — so no renderer changes.
//
// Menu-item ids encode their dispatch target as `<group>:<type>` (see
// `dispatch`). Native roles (cut/copy/paste/quit/…) use Tauri's
// PredefinedMenuItem and are localized by the OS; custom items and submenu
// titles are localized from MarkText's bundled locale JSON via `i18n`.
//
// Not yet ported: keybinding-driven accelerators (defaults here), dynamic
// recent-files/theme submenus, and per-selection checkmark state.

mod dispatch;
mod i18n;

use i18n::Translations;
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
fn app_submenu<R: Runtime>(app: &AppHandle<R>, tr: &Translations) -> tauri::Result<Submenu<R>> {
    // about/services/hide/hideOthers/quit are PredefinedMenuItems localized by
    // macOS itself; only the custom Preferences item needs translating.
    SubmenuBuilder::new(app, tr.t("menu.marktext.title"))
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "cmd:file.preferences", &tr.t("menu.marktext.preferences"), Some("CmdOrCtrl+,"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::services(app, None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()
}

fn file_submenu<R: Runtime>(app: &AppHandle<R>, tr: &Translations) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, tr.t("menu.file.file"))
        .item(&item(app, "file:new-tab", &tr.t("menu.file.newTab"), Some("CmdOrCtrl+N"))?)
        .item(&item(app, "cmd:file.new-window", &tr.t("menu.file.newWindow"), Some("CmdOrCtrl+Shift+N"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "file:open", &tr.t("menu.file.openFile"), Some("CmdOrCtrl+O"))?)
        .item(&item(app, "file:open-folder", &tr.t("menu.file.openFolder"), Some("CmdOrCtrl+Shift+O"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "file:save", &tr.t("menu.file.save"), Some("CmdOrCtrl+S"))?)
        .item(&item(app, "file:save-as", &tr.t("menu.file.saveAs"), Some("CmdOrCtrl+Shift+S"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "cmd:file.export", &tr.t("menu.file.export"), None)?)
        .item(&item(app, "cmd:file.print", &tr.t("menu.file.print"), Some("CmdOrCtrl+P"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "file:rename", &tr.t("menu.file.rename"), None)?)
        .item(&item(app, "file:move", &tr.t("menu.file.moveTo"), None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "file:close-tab", &tr.t("menu.file.closeTab"), Some("CmdOrCtrl+W"))?)
        .item(&item(app, "cmd:file.close-window", &tr.t("menu.file.closeWindow"), Some("CmdOrCtrl+Shift+W"))?)
        .build()
}

fn edit_submenu<R: Runtime>(app: &AppHandle<R>, tr: &Translations) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, tr.t("menu.edit.edit"))
        .item(&item(app, "edit:undo", &tr.t("menu.edit.undo"), Some("CmdOrCtrl+Z"))?)
        .item(&item(app, "edit:redo", &tr.t("menu.edit.redo"), Some("CmdOrCtrl+Shift+Z"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "edit:copyAsRich", &tr.t("menu.edit.copyAsRich"), None)?)
        .item(&item(app, "edit:copyAsHtml", &tr.t("menu.edit.copyAsHtml"), None)?)
        .item(&item(app, "edit:pasteAsPlainText", &tr.t("menu.edit.pasteAsPlainText"), Some("CmdOrCtrl+Shift+V"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "edit:selectAll", &tr.t("menu.edit.selectAll"), Some("CmdOrCtrl+A"))?)
        .item(&item(app, "edit:duplicate", &tr.t("menu.edit.duplicate"), None)?)
        .item(&item(app, "edit:createParagraph", &tr.t("menu.edit.createParagraph"), None)?)
        .item(&item(app, "edit:deleteParagraph", &tr.t("menu.edit.deleteParagraph"), None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "edit:find", &tr.t("menu.edit.find"), Some("CmdOrCtrl+F"))?)
        .item(&item(app, "edit:findNext", &tr.t("menu.edit.findNext"), None)?)
        .item(&item(app, "edit:findPrev", &tr.t("menu.edit.findPrevious"), None)?)
        .item(&item(app, "edit:replace", &tr.t("menu.edit.replace"), Some("CmdOrCtrl+Alt+F"))?)
        .item(&item(app, "edit:findInFolder", &tr.t("menu.edit.findInFolder"), None)?)
        .build()
}

fn paragraph_submenu<R: Runtime>(app: &AppHandle<R>, tr: &Translations) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, tr.t("menu.paragraph.title"))
        .item(&item(app, "cmd:paragraph.heading-1", &tr.t("menu.paragraph.heading1"), Some("CmdOrCtrl+1"))?)
        .item(&item(app, "cmd:paragraph.heading-2", &tr.t("menu.paragraph.heading2"), Some("CmdOrCtrl+2"))?)
        .item(&item(app, "cmd:paragraph.heading-3", &tr.t("menu.paragraph.heading3"), Some("CmdOrCtrl+3"))?)
        .item(&item(app, "cmd:paragraph.heading-4", &tr.t("menu.paragraph.heading4"), Some("CmdOrCtrl+4"))?)
        .item(&item(app, "cmd:paragraph.heading-5", &tr.t("menu.paragraph.heading5"), Some("CmdOrCtrl+5"))?)
        .item(&item(app, "cmd:paragraph.heading-6", &tr.t("menu.paragraph.heading6"), Some("CmdOrCtrl+6"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "para:table", &tr.t("menu.paragraph.table"), None)?)
        .item(&item(app, "para:pre", &tr.t("menu.paragraph.codeFences"), None)?)
        .item(&item(app, "para:blockquote", &tr.t("menu.paragraph.quoteBlock"), None)?)
        .item(&item(app, "para:mathblock", &tr.t("menu.paragraph.mathBlock"), None)?)
        .item(&item(app, "para:html", &tr.t("menu.paragraph.htmlBlock"), None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "para:ol-order", &tr.t("menu.paragraph.orderedList"), None)?)
        .item(&item(app, "para:ul-bullet", &tr.t("menu.paragraph.bulletList"), None)?)
        .item(&item(app, "para:ul-task", &tr.t("menu.paragraph.taskList"), None)?)
        .item(&item(app, "para:loose-list-item", &tr.t("menu.paragraph.looseListItem"), None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "para:paragraph", &tr.t("menu.paragraph.paragraph"), None)?)
        .item(&item(app, "para:hr", &tr.t("menu.paragraph.horizontalRule"), None)?)
        .item(&item(app, "para:front-matter", &tr.t("menu.paragraph.frontMatter"), None)?)
        .build()
}

fn format_submenu<R: Runtime>(app: &AppHandle<R>, tr: &Translations) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, tr.t("menu.format.format"))
        .item(&item(app, "fmt:strong", &tr.t("menu.format.bold"), Some("CmdOrCtrl+B"))?)
        .item(&item(app, "fmt:em", &tr.t("menu.format.italic"), Some("CmdOrCtrl+I"))?)
        .item(&item(app, "fmt:u", &tr.t("menu.format.underline"), Some("CmdOrCtrl+U"))?)
        .item(&item(app, "fmt:del", &tr.t("menu.format.strikethrough"), None)?)
        .item(&item(app, "fmt:mark", &tr.t("menu.format.highlight"), None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "fmt:inline_code", &tr.t("menu.format.inlineCode"), None)?)
        .item(&item(app, "fmt:inline_math", &tr.t("menu.format.inlineMath"), None)?)
        .item(&item(app, "fmt:sup", &tr.t("menu.format.superscript"), None)?)
        .item(&item(app, "fmt:sub", &tr.t("menu.format.subscript"), None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "fmt:link", &tr.t("menu.format.hyperlink"), Some("CmdOrCtrl+L"))?)
        .item(&item(app, "fmt:image", &tr.t("menu.format.image"), Some("CmdOrCtrl+Shift+I"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "fmt:clear", &tr.t("menu.format.clearFormat"), None)?)
        .build()
}

fn view_submenu<R: Runtime>(app: &AppHandle<R>, tr: &Translations) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, tr.t("menu.view.view"))
        .item(&item(app, "viewmode:sourceCode", &tr.t("menu.view.sourceCodeMode"), None)?)
        .item(&item(app, "viewmode:typewriter", &tr.t("menu.view.typewriterMode"), None)?)
        .item(&item(app, "viewmode:focus", &tr.t("menu.view.focusMode"), None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "viewlayout:showSideBar", &tr.t("menu.view.toggleSidebar"), Some("CmdOrCtrl+J"))?)
        .item(&item(app, "viewlayout:showTabBar", &tr.t("menu.view.toggleTabbar"), None)?)
        .item(&item(app, "viewlayout:toc", &tr.t("menu.view.toggleTableOfContents"), None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "cmd:view.command-palette", &tr.t("menu.view.commandPalette"), Some("CmdOrCtrl+Shift+P"))?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()
}

fn theme_submenu<R: Runtime>(app: &AppHandle<R>, tr: &Translations) -> tauri::Result<Submenu<R>> {
    // ids are `theme:<choice>`; the renderer applies 'system' by following the OS
    // light/dark preference, or the given theme id directly.
    SubmenuBuilder::new(app, tr.t("menu.theme.theme"))
        .item(&item(app, "theme:system", &tr.t("menu.theme.followSystem"), None)?)
        .item(&item(app, "theme:light", &tr.t("menu.theme.light"), None)?)
        .item(&item(app, "theme:dark", &tr.t("menu.theme.dark"), None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&item(app, "theme:one-dark", &tr.t("menu.theme.oneDark"), None)?)
        .item(&item(app, "theme:material-dark", &tr.t("menu.theme.materialDark"), None)?)
        .item(&item(app, "theme:dracula", &tr.t("menu.theme.dracula"), None)?)
        .item(&item(app, "theme:nord", &tr.t("menu.theme.nord"), None)?)
        .item(&item(app, "theme:solarized-dark", &tr.t("menu.theme.solarizedDark"), None)?)
        .build()
}

fn window_submenu<R: Runtime>(app: &AppHandle<R>, tr: &Translations) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, tr.t("menu.window.title"))
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()
}

fn help_submenu<R: Runtime>(app: &AppHandle<R>, tr: &Translations) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, tr.t("menu.help.help"))
        .item(&item(app, "cmd:help.learn-more", &tr.t("menu.help.markdownReference"), None)?)
        .item(&item(app, "help:about", &tr.t("menu.help.about"), None)?)
        .build()
}

/// Build the full application menu, localized to the OS UI language.
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let tr = i18n::load(app);
    let menu = Menu::new(app)?;

    #[cfg(target_os = "macos")]
    menu.append(&app_submenu(app, &tr)?)?;

    menu.append(&file_submenu(app, &tr)?)?;
    menu.append(&edit_submenu(app, &tr)?)?;
    menu.append(&paragraph_submenu(app, &tr)?)?;
    menu.append(&format_submenu(app, &tr)?)?;
    menu.append(&view_submenu(app, &tr)?)?;
    menu.append(&theme_submenu(app, &tr)?)?;
    menu.append(&window_submenu(app, &tr)?)?;
    menu.append(&help_submenu(app, &tr)?)?;

    Ok(menu)
}
