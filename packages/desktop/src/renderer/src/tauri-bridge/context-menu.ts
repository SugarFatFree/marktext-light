// Context menus, in place of Electron's native `Menu.popup`
// (src/main/ipc/window.ts).
//
// Tauri can build a native menu, but popping one up at a point and learning
// which item was chosen is not exposed to JS the way Electron exposed it. The
// menu is drawn in the page instead — the same approach the custom menu bar
// already takes for the same reason.
//
// The contract with `renderer/src/contextMenu/popupMenu.ts` is unchanged: it
// ships a serialised template, then waits for `mt::menu::click` carrying the
// chosen item's id and `mt::menu::closed` when the menu goes away. Whichever
// happens, `closed` always follows, because that is what releases its handlers.

import type { DispatchLocal } from './save'

interface TemplateItem {
  id?: string
  label?: string
  type?: string
  accelerator?: string
  enabled?: boolean
  checked?: boolean
}

interface Position {
  x?: number
  y?: number
}

const MENU_ID = 'mt-context-menu'

let dismiss: (() => void) | null = null

/** Take down whatever menu is open. Safe to call when none is. */
export const closeContextMenu = (): void => {
  dismiss?.()
}

const buildItem = (
  item: TemplateItem,
  choose: (id: string) => void
): HTMLElement => {
  if (item.type === 'separator') {
    const separator = document.createElement('div')
    separator.className = 'mt-context-menu__separator'
    return separator
  }

  const row = document.createElement('div')
  row.className = 'mt-context-menu__item'
  const enabled = item.enabled !== false
  if (!enabled) row.classList.add('is-disabled')

  const check = document.createElement('span')
  check.className = 'mt-context-menu__check'
  check.textContent = item.checked ? '✓' : ''
  row.appendChild(check)

  const label = document.createElement('span')
  label.className = 'mt-context-menu__label'
  label.textContent = item.label ?? ''
  row.appendChild(label)

  if (item.accelerator) {
    const accel = document.createElement('span')
    accel.className = 'mt-context-menu__accel'
    accel.textContent = item.accelerator
    row.appendChild(accel)
  }

  const { id } = item
  if (enabled && id) {
    // `mousedown` rather than `click`: the outside-press listener that dismisses
    // the menu also runs on mousedown, and a click would arrive after it.
    row.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      choose(id)
    })
  }

  return row
}

/** Nudge the menu back inside the viewport when it would overflow. */
const place = (menu: HTMLElement, position: Position): void => {
  const { width, height } = menu.getBoundingClientRect()
  const x = Math.min(position.x ?? 0, Math.max(0, window.innerWidth - width - 4))
  const y = Math.min(position.y ?? 0, Math.max(0, window.innerHeight - height - 4))
  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
}

export const popupContextMenu = (
  template: unknown,
  position: unknown,
  dispatchLocal: DispatchLocal
): void => {
  closeContextMenu()

  const items = Array.isArray(template) ? (template as TemplateItem[]) : []
  if (!items.length) {
    dispatchLocal('mt::menu::closed', [])
    return
  }

  const menu = document.createElement('div')
  menu.id = MENU_ID
  menu.className = 'mt-context-menu'

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    dismiss = null
    document.removeEventListener('mousedown', onOutsidePress, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', close)
    window.removeEventListener('blur', close)
    menu.remove()
    // The caller's click and closed handlers are released together, so this
    // must go out even when an item was chosen.
    dispatchLocal('mt::menu::closed', [])
  }

  const choose = (id: string): void => {
    dispatchLocal('mt::menu::click', [{ id }])
    close()
  }

  const onOutsidePress = (event: MouseEvent): void => {
    if (!menu.contains(event.target as Node)) close()
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close()
  }

  for (const item of items) menu.appendChild(buildItem(item, choose))

  document.body.appendChild(menu)
  place(menu, (position ?? {}) as Position)

  dismiss = close
  document.addEventListener('mousedown', onOutsidePress, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
}

// Injected once rather than shipped in a stylesheet: the menu is created from
// this module, and keeping its markup and appearance together means neither can
// be changed without the other in view. Colours come from the theme.
const STYLE_ID = 'mt-context-menu-style'

export const installContextMenuStyles = (): void => {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.mt-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 180px;
  padding: 4px 0;
  border-radius: 4px;
  font-size: 13px;
  user-select: none;
  color: var(--editorColor);
  background: var(--floatBgColor);
  border: 1px solid var(--floatBorderColor);
  box-shadow: var(--floatShadow, 0 2px 12px rgba(0, 0, 0, 0.24));
}
.mt-context-menu__item {
  display: flex;
  align-items: center;
  padding: 5px 12px 5px 6px;
  cursor: pointer;
  white-space: nowrap;
}
.mt-context-menu__item:hover {
  background: var(--floatHoverColor);
  color: var(--themeColor);
}
.mt-context-menu__item.is-disabled {
  cursor: default;
  opacity: 0.45;
}
.mt-context-menu__item.is-disabled:hover {
  background: none;
  color: inherit;
}
.mt-context-menu__check {
  display: inline-block;
  width: 14px;
  flex-shrink: 0;
  color: var(--themeColor);
}
.mt-context-menu__label {
  flex: 1;
}
.mt-context-menu__accel {
  margin-left: 24px;
  opacity: 0.55;
  font-size: 12px;
}
.mt-context-menu__separator {
  height: 1px;
  margin: 4px 0;
  background: var(--floatBorderColor);
}
`
  document.head.appendChild(style)
}
