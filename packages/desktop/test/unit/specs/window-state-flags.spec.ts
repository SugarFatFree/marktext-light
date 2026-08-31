// Which parts of the window state get restored, and which must not be.
//
// `tauri-plugin-window-state` restores everything by default, and two of those
// defaults break this window:
//
//   DECORATIONS — the window is `decorations: false` and draws its own title
//   bar. Restoring `decorated: true` from a state file written by any earlier
//   build puts the OS frame back on top of ours.
//
//   VISIBLE — a state file that ever recorded a hidden window would start the
//   app with nothing on screen and no way to ask for it back.
//
// Neither shows up in a test run or a screenshot of a fresh install; both need
// a stale state file on someone's machine. So the guard is here: replacing the
// explicit flags with `Builder::default()` looks like a simplification and is
// not one.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const lib = readFileSync(resolve(__dirname, '../../../src-tauri/src/lib.rs'), 'utf-8')

/** The plugin registration, from its builder to the `.build()` that ends it. */
const registration = (): string => {
  const start = lib.indexOf('tauri_plugin_window_state::Builder')
  expect(start, 'the window-state plugin is no longer registered').toBeGreaterThan(-1)
  return lib.slice(start, lib.indexOf('.build(),', start))
}

describe('window state restoration', () => {
  it('restores size, position and the maximized/fullscreen state', () => {
    const block = registration()

    for (const flag of ['SIZE', 'POSITION', 'MAXIMIZED', 'FULLSCREEN']) {
      expect(block, `StateFlags::${flag} should be restored`).toContain(`StateFlags::${flag}`)
    }
  })

  it('never restores decorations or visibility', () => {
    const block = registration()

    expect(block, 'DECORATIONS would put the OS frame back over the custom title bar')
      .not.toContain('DECORATIONS')
    expect(block, 'VISIBLE could start the app with no window on screen')
      .not.toContain('VISIBLE')
  })

  it('states the flags rather than taking the plugin default', () => {
    // `Builder::default().build()` is every flag, including the two above.
    expect(registration(), 'the flags have to be spelled out').toContain('with_state_flags')
  })

  it('is registered before the window it configures', () => {
    // The plugin restores state in `on_window_ready`. Registered after the
    // window exists it would have nothing to act on.
    const pluginAt = lib.indexOf('tauri_plugin_window_state::Builder')
    const setupAt = lib.indexOf('.setup(|app|')

    expect(pluginAt).toBeLessThan(setupAt)
  })
})
