// The editor's context menu.
//
// Under Electron this lived in the main process: it hooked
// `webContents.on('context-menu')`, built a native menu from the params
// Chromium supplied, and pushed the choice back as `mt::cm-*`
// (src/main/contextMenu/editor). A Tauri WebView offers no such hook, so the
// menu is assembled here from the DOM selection instead and dispatched
// straight onto the bus the `mt::cm-*` listeners feed — same effect, one hop
// shorter.
//
// Not carried over: the spelling section. It was populated from Chromium's
// `dictionarySuggestions`, which has no counterpart here (see the spellchecker
// gap in docs/PARITY_PLAN.md).

import bus from '../../bus'
import { t } from '../../i18n'
import { popupContextMenu, type ContextMenuItem } from '../popupMenu'

const hasSelection = (): boolean => {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed && selection.toString().length > 0
}

/**
 * Whether the click landed somewhere text can be typed.
 *
 * Electron told us via `editFlags`; here the DOM does. A `contenteditable`
 * ancestor covers muya, and inputs cover the source-code pane and the search
 * fields.
 */
const isEditable = (target: EventTarget | null): boolean => {
  const element = target instanceof Element ? target : null
  if (!element) return false
  if (element.closest('input, textarea')) return true
  const editable = element.closest('[contenteditable]')
  return !!editable && editable.getAttribute('contenteditable') !== 'false'
}

/**
 * Paste at the caret.
 *
 * `document.execCommand('paste')` is refused by every WebView — reading the
 * clipboard on a page's say-so is exactly what that block exists to prevent —
 * so the text comes through the bridge, which is allowed to ask, and is then
 * delivered as a `paste` event so muya's own handler does the inserting. The
 * keyboard shortcut is unaffected either way; this is the menu's route.
 */
const paste = (): void => {
  const target = document.activeElement ?? document.body
  window.electron.clipboard
    .readText()
    .then((text) => {
      if (!text) return
      const data = new DataTransfer()
      data.setData('text/plain', text)
      target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      )
    })
    .catch((err) => console.warn('[context-menu] cannot read the clipboard:', err))
}

const buildItems = (editable: boolean, selected: boolean): ContextMenuItem[] => [
  {
    label: t('contextMenu.cut'),
    enabled: editable && selected,
    click: () => document.execCommand('cut')
  },
  {
    label: t('contextMenu.copy'),
    enabled: selected,
    click: () => document.execCommand('copy')
  },
  {
    label: t('contextMenu.paste'),
    enabled: editable,
    click: () => paste()
  },
  { type: 'separator' },
  {
    label: t('contextMenu.copyAsRich'),
    enabled: selected,
    click: () => bus.emit('copyAsRich', 'copyAsRich')
  },
  {
    label: t('contextMenu.copyAsHtml'),
    enabled: selected,
    click: () => bus.emit('copyAsHtml', 'copyAsHtml')
  },
  {
    label: t('contextMenu.pasteAsPlainText'),
    enabled: editable,
    click: () => bus.emit('pasteAsPlainText', 'pasteAsPlainText')
  },
  { type: 'separator' },
  {
    label: t('contextMenu.insertParagraphBefore'),
    enabled: editable,
    click: () => bus.emit('insertParagraph', 'before')
  },
  {
    label: t('contextMenu.insertParagraphAfter'),
    enabled: editable,
    click: () => bus.emit('insertParagraph', 'after')
  }
]

/**
 * Show the editor context menu for a right-click, unless the click was inside
 * something that brings its own — the sidebar and tab bar build their own menus
 * and call `preventDefault` first.
 */
export const showEditorContextMenu = (event: MouseEvent): void => {
  if (event.defaultPrevented) return
  const editable = isEditable(event.target)
  const selected = hasSelection()

  // A right-click on non-editable chrome with nothing selected has nothing to
  // offer; leaving the menu unshown is better than showing one that is entirely
  // greyed out.
  if (!editable && !selected) return

  event.preventDefault()
  popupContextMenu(buildItems(editable, selected), { x: event.clientX, y: event.clientY })
}
