// A preference changed anywhere has to reach everywhere.
//
// Electron's main process owned the preferences file: the settings window asked
// it to write, and it pushed the change to every window on `mt::user-preference`,
// so an open editor followed along. Under Tauri each window writes the file
// itself, and the bridge did only that — the theme, the font family, the line
// height, the tab width all landed on disk and changed nothing on screen until
// the next launch. `language` was the exception, because someone had given it a
// broadcast of its own; nothing generalised it.
//
// The distinction that matters is local versus global. Answering
// `mt::ask-for-user-preference` is a reply to the window that asked, and stays
// local. Recording a change is news for every window, and has to go out through
// Tauri's `emit`, which reaches them all — including the sender, whose own
// listener then applies it, so a local dispatch alongside would deliver it twice.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const invoke = vi.fn()
const emit = vi.fn()
const listen = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock('@tauri-apps/api/event', () => ({
  emit: (...a: unknown[]) => emit(...a),
  listen: (...a: unknown[]) => listen(...a)
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: () => Promise.resolve('/picked/folder'),
  save: () => Promise.resolve(null),
  ask: () => Promise.resolve(true),
  message: () => Promise.resolve()
}))

const load = async() => {
  vi.resetModules()
  invoke.mockReset()
  emit.mockReset()
  listen.mockReset()
  invoke.mockResolvedValue(undefined)
  emit.mockResolvedValue(undefined)
  listen.mockResolvedValue(() => {})
  return import('../../../src/renderer/src/tauri-bridge/preferences')
}

const settle = async(): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

/** Patches announced on `mt::user-preference`, in order. */
const announced = (): unknown[] =>
  emit.mock.calls.filter(([channel]) => channel === 'mt::user-preference').map(([, patch]) => patch)

describe('announcing a preference change', () => {
  beforeEach(() => {
    emit.mockReset()
    emit.mockResolvedValue(undefined)
  })

  it('goes out to every window, not just this one', async() => {
    const { announcePreferences } = await load()

    announcePreferences({ theme: 'dark' })

    expect(announced()).toEqual([{ theme: 'dark' }])
  })

  it('says nothing when there is nothing to say', async() => {
    const { announcePreferences } = await load()

    announcePreferences(undefined)

    expect(announced()).toEqual([])
  })

  it('survives a failed emit rather than rejecting into nowhere', async() => {
    const { announcePreferences } = await load()
    emit.mockRejectedValue(new Error('no such window'))

    expect(() => announcePreferences({ theme: 'dark' })).not.toThrow()
    await settle()
  })

  it('announces a folder picked in the settings window', async() => {
    // The image folder decides where the *editor* puts a pasted image, so this
    // one was visibly wrong: pick a folder in the settings window, and images
    // kept going to the old one.
    const { initPreferenceStores, pickFolderPreference } = await load()
    initPreferenceStores('/data')

    await pickFolderPreference('imageFolderPath', () => {})
    await settle()

    expect(announced()).toEqual([{ imageFolderPath: '/picked/folder' }])
  })
})

describe('answering a question a window asked', () => {
  it('stays local, because only the asker is waiting', async() => {
    const { initPreferenceStores, sendStoredPreferences } = await load()
    initPreferenceStores('/data')
    const dispatched: Array<[string, unknown[]]> = []

    await sendStoredPreferences((channel, args) => dispatched.push([channel, args]))
    await settle()

    expect(dispatched.map(([channel]) => channel)).toEqual(['mt::user-preference'])
    expect(announced(), 'a reply must not be broadcast to every window').toEqual([])
  })
})
