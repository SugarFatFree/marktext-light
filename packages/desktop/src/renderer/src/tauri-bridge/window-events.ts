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

const MARKDOWN_EXTENSIONS = [
  'markdown',
  'mdown',
  'mkdn',
  'md',
  'mkd',
  'mdwn',
  'mdtxt',
  'mdtext',
  'mdx',
  'text',
  'txt'
]

const isMarkdown = (path: string): boolean =>
  MARKDOWN_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(`.${ext}`))

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
export const installWindowEvents = (dispatchLocal: DispatchLocal): void => {
  const win = getCurrentWindow()

  fire(
    win.onResized(() => {
      fire(
        win
          .isMaximized()
          .then((maximized) =>
            dispatchLocal(maximized ? 'mt::window-maximize' : 'mt::window-unmaximize', [])
          )
      )
      fire(
        win
          .isFullscreen()
          .then((full) =>
            dispatchLocal(
              full ? 'mt::window-enter-full-screen' : 'mt::window-leave-full-screen',
              []
            )
          )
      )
    })
  )

  fire(
    win.onFocusChanged(({ payload: focused }) => {
      // The store narrows `{ status }`, not a bare boolean.
      dispatchLocal('mt::window-active-status', [{ status: focused }])
    })
  )
}

/**
 * Open markdown files dropped onto the window as tabs.
 *
 * Electron reported dropped paths through the DOM's drop event; a Tauri WebView
 * does not expose them there, so the paths come from the window's own drag-drop
 * event instead. Non-markdown files are ignored — Electron offered to import
 * them through pandoc, which this build has no equivalent for.
 */
export const installFileDrop = (openFile: (path: string) => Promise<void>): void => {
  fire(
    getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return
      for (const path of event.payload.paths) {
        if (isMarkdown(path)) fire(openFile(path))
      }
    })
  )
}
