// Window state and dropped files, in place of the notifications the Electron
// main process pushed from its BrowserWindow listeners
// (src/main/windows/base.ts, `mt::window::drop` in menu/actions/file.ts).
//
// Tauri raises the same facts as events on the window object, so the mapping is
// direct: listen there and dispatch onto the channels the renderer already has
// handlers for — the titlebar's maximise/restore icon and the store's
// active-window flag need no changes.

import { getCurrentWindow } from '@tauri-apps/api/window'

import type { DispatchLocal } from './save'

const fire = (op: Promise<unknown>): void => {
  op.catch((err) => console.warn('[tauri-bridge]', err))
}

/**
 * Mirror the window's own state onto the renderer's channels.
 *
 * Without this the custom titlebar never learns it has been maximised, so its
 * restore button keeps showing the maximise icon after a double-click on the
 * titlebar or a window-manager shortcut.
 */
// A resize drag raises a continuous stream of events, and each answer costs two
// round trips to ask the window what it now is. Only where the drag stops
// matters — nothing here reacts to an intermediate size.
const RESIZE_SETTLE = 120

export const installWindowEvents = (dispatchLocal: DispatchLocal): void => {
  const win = getCurrentWindow()
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  // The last state reported, so a resize that changed neither says nothing.
  let wasMaximized: boolean | null = null
  let wasFullscreen: boolean | null = null

  const reportWindowState = (): void => {
    fire(
      Promise.all([win.isMaximized(), win.isFullscreen()]).then(([maximized, fullscreen]) => {
        if (maximized !== wasMaximized) {
          wasMaximized = maximized
          dispatchLocal(maximized ? 'mt::window-maximize' : 'mt::window-unmaximize', [])
        }
        if (fullscreen !== wasFullscreen) {
          wasFullscreen = fullscreen
          dispatchLocal(
            fullscreen ? 'mt::window-enter-full-screen' : 'mt::window-leave-full-screen',
            []
          )
        }
      })
    )
  }

  fire(
    win.onResized(() => {
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        settleTimer = null
        reportWindowState()
      }, RESIZE_SETTLE)
    })
  )

  // The titlebar renders before any resize happens, so tell it where it stands.
  reportWindowState()

  fire(
    win.onFocusChanged(({ payload: focused }) => {
      // The store narrows `{ status }`, not a bare boolean.
      dispatchLocal('mt::window-active-status', [{ status: focused }])
    })
  )
}

/**
 * Handle files dropped onto the window.
 *
 * Electron reported dropped paths through the DOM's drop event; a Tauri WebView
 * does not expose them there, so the paths come from the window's own drag-drop
 * event instead. Deciding what a path deserves — opened, imported, or ignored —
 * belongs with the code that knows both file-type lists, so `accept` gets every
 * dropped path and makes that call.
 */
export const installFileDrop = (accept: (path: string) => Promise<void>): void => {
  fire(
    getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return
      for (const path of event.payload.paths) {
        fire(accept(path))
      }
    })
  )
}
