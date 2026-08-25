// Data model for the custom top menu bar shown on frameless Windows/Linux
// (where Tauri's native menu bar can't render). Item ids match the native menu
// (src-tauri/src/menu); clicks are routed through the same Rust dispatch via the
// `dispatch_menu` command, so behavior is identical to a native menu click.

export interface MenuBarItem {
  /** Dispatch id, e.g. 'edit:undo', 'cmd:file.save', 'theme:dark'. */
  id: string
  /** i18n key for the label. */
  labelKey: string
  /** Accelerator shown right-aligned (display only; the editor owns the keys). */
  accel?: string
  /** Draw a divider above this item. */
  divided?: boolean
}

export interface MenuBarSection {
  titleKey: string
  items: MenuBarItem[]
}

const mod = 'Ctrl' // accelerator hints shown on Windows/Linux

export const MENU_STRUCTURE: MenuBarSection[] = [
  {
    titleKey: 'menu.file.file',
    items: [
      { id: 'file:new-tab', labelKey: 'menu.file.newTab', accel: `${mod}+N` },
      { id: 'cmd:file.new-window', labelKey: 'menu.file.newWindow', accel: `${mod}+Shift+N` },
      { id: 'file:open', labelKey: 'menu.file.openFile', accel: `${mod}+O`, divided: true },
      { id: 'file:open-folder', labelKey: 'menu.file.openFolder', accel: `${mod}+Shift+O` },
      { id: 'file:save', labelKey: 'menu.file.save', accel: `${mod}+S`, divided: true },
      { id: 'file:save-as', labelKey: 'menu.file.saveAs', accel: `${mod}+Shift+S` },
      { id: 'cmd:file.toggle-auto-save', labelKey: 'menu.file.autoSave' },
      { id: 'cmd:file.import-file', labelKey: 'menu.file.import', divided: true },
      { id: 'cmd:file.export-file', labelKey: 'menu.file.export' },
      { id: 'cmd:file.print', labelKey: 'menu.file.print', accel: `${mod}+P` },
      { id: 'file:rename', labelKey: 'menu.file.rename', divided: true },
      { id: 'file:move', labelKey: 'menu.file.moveTo' },
      { id: 'file:close-tab', labelKey: 'menu.file.closeTab', accel: `${mod}+W`, divided: true },
      { id: 'cmd:file.close-window', labelKey: 'menu.file.closeWindow', accel: `${mod}+Shift+W` },
      // This bar only ever renders on Windows/Linux, where there is no
      // application menu to hold Preferences — so it belongs here, matching
      // where the native menu now puts it off macOS.
      { id: 'cmd:file.preferences', labelKey: 'menu.marktext.preferences', divided: true }
    ]
  },
  {
    titleKey: 'menu.edit.edit',
    items: [
      { id: 'edit:undo', labelKey: 'menu.edit.undo', accel: `${mod}+Z` },
      { id: 'edit:redo', labelKey: 'menu.edit.redo', accel: `${mod}+Shift+Z` },
      { id: 'edit:copyAsRich', labelKey: 'menu.edit.copyAsRich', divided: true },
      { id: 'edit:copyAsHtml', labelKey: 'menu.edit.copyAsHtml' },
      { id: 'edit:pasteAsPlainText', labelKey: 'menu.edit.pasteAsPlainText', accel: `${mod}+Shift+V` },
      { id: 'edit:selectAll', labelKey: 'menu.edit.selectAll', accel: `${mod}+A`, divided: true },
      { id: 'edit:duplicate', labelKey: 'menu.edit.duplicate' },
      { id: 'edit:createParagraph', labelKey: 'menu.edit.createParagraph' },
      { id: 'edit:deleteParagraph', labelKey: 'menu.edit.deleteParagraph' },
      { id: 'edit:find', labelKey: 'menu.edit.find', accel: `${mod}+F`, divided: true },
      { id: 'edit:findNext', labelKey: 'menu.edit.findNext' },
      { id: 'edit:findPrev', labelKey: 'menu.edit.findPrevious' },
      { id: 'edit:replace', labelKey: 'menu.edit.replace', accel: `${mod}+Alt+F` },
      { id: 'edit:findInFolder', labelKey: 'menu.edit.findInFolder' },
      { id: 'lineending:lf', labelKey: 'menu.edit.lineEndingLf', divided: true },
      { id: 'lineending:crlf', labelKey: 'menu.edit.lineEndingCrlf' }
    ]
  },
  {
    titleKey: 'menu.paragraph.title',
    items: [
      { id: 'cmd:paragraph.heading-1', labelKey: 'menu.paragraph.heading1', accel: `${mod}+1` },
      { id: 'cmd:paragraph.heading-2', labelKey: 'menu.paragraph.heading2', accel: `${mod}+2` },
      { id: 'cmd:paragraph.heading-3', labelKey: 'menu.paragraph.heading3', accel: `${mod}+3` },
      { id: 'cmd:paragraph.heading-4', labelKey: 'menu.paragraph.heading4', accel: `${mod}+4` },
      { id: 'cmd:paragraph.heading-5', labelKey: 'menu.paragraph.heading5', accel: `${mod}+5` },
      { id: 'cmd:paragraph.heading-6', labelKey: 'menu.paragraph.heading6', accel: `${mod}+6` },
      { id: 'cmd:paragraph.upgrade-heading', labelKey: 'menu.paragraph.promoteHeading' },
      { id: 'cmd:paragraph.degrade-heading', labelKey: 'menu.paragraph.demoteHeading' },
      { id: 'para:table', labelKey: 'menu.paragraph.table', divided: true },
      { id: 'para:pre', labelKey: 'menu.paragraph.codeFences' },
      { id: 'para:blockquote', labelKey: 'menu.paragraph.quoteBlock' },
      { id: 'para:mathblock', labelKey: 'menu.paragraph.mathBlock' },
      { id: 'para:html', labelKey: 'menu.paragraph.htmlBlock' },
      { id: 'para:ol-order', labelKey: 'menu.paragraph.orderedList', divided: true },
      { id: 'para:ul-bullet', labelKey: 'menu.paragraph.bulletList' },
      { id: 'para:ul-task', labelKey: 'menu.paragraph.taskList' },
      { id: 'para:loose-list-item', labelKey: 'menu.paragraph.looseListItem' },
      { id: 'para:paragraph', labelKey: 'menu.paragraph.paragraph', divided: true },
      { id: 'para:hr', labelKey: 'menu.paragraph.horizontalRule' },
      { id: 'para:front-matter', labelKey: 'menu.paragraph.frontMatter' }
    ]
  },
  {
    titleKey: 'menu.format.format',
    items: [
      { id: 'fmt:strong', labelKey: 'menu.format.bold', accel: `${mod}+B` },
      { id: 'fmt:em', labelKey: 'menu.format.italic', accel: `${mod}+I` },
      { id: 'fmt:u', labelKey: 'menu.format.underline', accel: `${mod}+U` },
      { id: 'fmt:del', labelKey: 'menu.format.strikethrough' },
      { id: 'fmt:mark', labelKey: 'menu.format.highlight' },
      { id: 'fmt:inline_code', labelKey: 'menu.format.inlineCode', divided: true },
      { id: 'fmt:inline_math', labelKey: 'menu.format.inlineMath' },
      { id: 'fmt:sup', labelKey: 'menu.format.superscript' },
      { id: 'fmt:sub', labelKey: 'menu.format.subscript' },
      { id: 'fmt:link', labelKey: 'menu.format.hyperlink', accel: `${mod}+L`, divided: true },
      { id: 'fmt:image', labelKey: 'menu.format.image', accel: `${mod}+Shift+I` },
      { id: 'fmt:clear', labelKey: 'menu.format.clearFormat', divided: true }
    ]
  },
  {
    titleKey: 'menu.view.view',
    items: [
      { id: 'viewmode:sourceCode', labelKey: 'menu.view.sourceCodeMode' },
      { id: 'viewmode:typewriter', labelKey: 'menu.view.typewriterMode' },
      { id: 'viewmode:focus', labelKey: 'menu.view.focusMode' },
      { id: 'viewlayout:showSideBar', labelKey: 'menu.view.toggleSidebar', accel: `${mod}+J`, divided: true },
      { id: 'viewlayout:showTabBar', labelKey: 'menu.view.toggleTabbar' },
      { id: 'viewlayout:toc', labelKey: 'menu.view.toggleTableOfContents' },
      { id: 'images:reload', labelKey: 'menu.view.reloadImages' },
      { id: 'palette:show', labelKey: 'menu.view.commandPalette', accel: `${mod}+Shift+P` },
      { id: 'cmd:view.command-palette', labelKey: 'menu.view.commandPalette', accel: `${mod}+Shift+P`, divided: true }
    ]
  },
  {
    titleKey: 'menu.theme.theme',
    items: [
      { id: 'theme:system', labelKey: 'menu.theme.followSystem' },
      { id: 'theme:light', labelKey: 'menu.theme.light' },
      { id: 'theme:dark', labelKey: 'menu.theme.dark' },
      { id: 'theme:one-dark', labelKey: 'menu.theme.oneDark', divided: true },
      { id: 'theme:material-dark', labelKey: 'menu.theme.materialDark' },
      { id: 'theme:dracula', labelKey: 'menu.theme.dracula' },
      { id: 'theme:nord', labelKey: 'menu.theme.nord' },
      { id: 'theme:solarized-dark', labelKey: 'menu.theme.solarizedDark' }
    ]
  },
  {
    titleKey: 'menu.help.help',
    items: [
      { id: 'cmd:docs.markdown-syntax', labelKey: 'menu.help.markdownReference' },
      { id: 'cmd:help.changelog', labelKey: 'menu.help.changelog', divided: true },
      { id: 'cmd:help.follow-us', labelKey: 'menu.help.followUs' },
      { id: 'cmd:help.support', labelKey: 'menu.help.support' },
      { id: 'cmd:help.ask-question', labelKey: 'menu.help.askQuestion', divided: true },
      { id: 'cmd:help.report-bug', labelKey: 'menu.help.reportBug' },
      { id: 'cmd:help.view-source', labelKey: 'menu.help.viewSource' },
      { id: 'cmd:help.license', labelKey: 'menu.help.license' },
      { id: 'help:about', labelKey: 'menu.help.about', divided: true }
    ]
  }
]
