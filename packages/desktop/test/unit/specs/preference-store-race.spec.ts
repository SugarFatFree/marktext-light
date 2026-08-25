// Writing a preference while the stored ones are still being read.
//
// This is not a rare interleaving: the editor asks for its preferences and then
// writes `sideBarVisibility` from the layout bootstrap microseconds later, so
// every launch runs it. A `loaded` flag set before the `await` let the second
// caller see an empty bag — and the debounced write that followed replaced the
// file with just that one key.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const STORED = { theme: 'dracula', autoSave: true, fontSize: 18 }

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

/** Resolves only when released, so a read can be held open on purpose. */
const deferred = <T>(): { promise: Promise<T>; release: (value: T) => void } => {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const loadModule = async() => {
  vi.resetModules()
  const module = await import('../../../src/renderer/src/tauri-bridge/preferences')
  module.initPreferenceStores('/user-data')
  return module
}

describe('preference store', () => {
  beforeEach(() => {
    invoke.mockReset()
    vi.useFakeTimers()
  })

  it('keeps stored preferences when one is written mid-read', async() => {
    const readRelease = deferred<string>()
    invoke.mockImplementation((command: string) => {
      if (command === 'path_exists') return Promise.resolve(true)
      if (command === 'read_file') return readRelease.promise
      if (command === 'output_file') return Promise.resolve(undefined)
      return Promise.resolve(undefined)
    })

    const { sendStoredPreferences, setStoredPreferences } = await loadModule()

    // The read starts and is held open.
    const dispatch = vi.fn()
    const asking = sendStoredPreferences(dispatch)
    // The layout bootstrap writes while it is still in flight.
    const writing = setStoredPreferences({ sideBarVisibility: true })

    readRelease.release(JSON.stringify(STORED))
    await asking
    await writing

    await vi.runAllTimersAsync()

    const writes = invoke.mock.calls.filter(([command]) => command === 'output_file')
    expect(writes, 'the patch should have been written').toHaveLength(1)
    expect(JSON.parse((writes[0][1] as { data: string }).data)).toEqual({
      ...STORED,
      sideBarVisibility: true
    })
  })

  it('reads the file once however many callers ask', async() => {
    invoke.mockImplementation((command: string) => {
      if (command === 'path_exists') return Promise.resolve(true)
      if (command === 'read_file') return Promise.resolve(JSON.stringify(STORED))
      return Promise.resolve(undefined)
    })

    const { sendStoredPreferences, getStoredPreference } = await loadModule()
    const dispatch = vi.fn()

    await Promise.all([
      sendStoredPreferences(dispatch),
      sendStoredPreferences(dispatch),
      getStoredPreference('theme')
    ])

    expect(invoke.mock.calls.filter(([command]) => command === 'read_file')).toHaveLength(1)
    expect(dispatch).toHaveBeenCalledWith('mt::user-preference', [STORED])
  })
})
