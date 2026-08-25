// Tab-navigation shortcuts under Tauri.
//
// These used to be main-process accelerators; the bridge now recognises them in
// the renderer. The mapping is easy to get subtly wrong — `Ctrl+0` is the tenth
// tab rather than the zeroth, and `Ctrl+Alt+<n>` belongs to the heading
// shortcuts, not to tab switching — so pin it down.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { installTabShortcuts } from '../../../src/renderer/src/tauri-bridge/shortcuts'

type Dispatch = ReturnType<typeof vi.fn>

const press = (init: KeyboardEventInit): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { ...init, cancelable: true }))
}

describe('tab shortcuts', () => {
  let dispatch: Dispatch

  beforeEach(() => {
    dispatch = vi.fn()
    installTabShortcuts(dispatch, 'linux')
  })

  it('cycles with Ctrl+Tab and Ctrl+Shift+Tab', () => {
    press({ key: 'Tab', ctrlKey: true })
    press({ key: 'Tab', ctrlKey: true, shiftKey: true })

    expect(dispatch.mock.calls).toEqual([
      ['mt::tabs-cycle-right', []],
      ['mt::tabs-cycle-left', []]
    ])
  })

  it('cycles with Ctrl+PageUp and Ctrl+PageDown', () => {
    press({ key: 'PageUp', ctrlKey: true })
    press({ key: 'PageDown', ctrlKey: true })

    expect(dispatch.mock.calls).toEqual([
      ['mt::tabs-cycle-left', []],
      ['mt::tabs-cycle-right', []]
    ])
  })

  it('selects a tab by number, with Ctrl+0 as the tenth', () => {
    press({ key: '1', ctrlKey: true })
    press({ key: '9', ctrlKey: true })
    press({ key: '0', ctrlKey: true })

    expect(dispatch.mock.calls).toEqual([
      ['mt::switch-tab-by-index', [0]],
      ['mt::switch-tab-by-index', [8]],
      ['mt::switch-tab-by-index', [9]]
    ])
  })

  it('leaves Ctrl+Alt+<n> to the heading shortcuts', () => {
    press({ key: '1', ctrlKey: true, altKey: true })

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('ignores an unmodified number key', () => {
    press({ key: '1' })

    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('tab shortcuts on macOS', () => {
  it('uses Cmd for the page keys and Ctrl for cycling', () => {
    const dispatch = vi.fn()
    installTabShortcuts(dispatch, 'darwin')

    press({ key: 'PageDown', metaKey: true })
    press({ key: 'PageUp', ctrlKey: true })
    press({ key: 'Tab', ctrlKey: true })

    expect(dispatch.mock.calls).toEqual([
      ['mt::tabs-cycle-right', []],
      ['mt::tabs-cycle-right', []]
    ])
  })
})
