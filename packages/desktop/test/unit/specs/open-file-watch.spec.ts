// Which files the app asks the OS to watch, and what it does when one changes.
//
// The set has to follow the tabs exactly. Too few and an external edit goes
// unnoticed; too many and a watch outlives the tab that justified it, reporting
// changes for a document nothing is showing — which is what happened before
// rename, move and save-as learned to drop the path they left behind.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const invoke = vi.fn()
const showSaveDialog = vi.fn()
const ask = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...args: unknown[]) => showSaveDialog(...args),
  ask: (...args: unknown[]) => ask(...args),
  open: vi.fn()
}))

const load = async() => {
  vi.resetModules()
  const openFiles = await import('../../../src/renderer/src/tauri-bridge/open-files')
  const files = await import('../../../src/renderer/src/tauri-bridge/files')
  const save = await import('../../../src/renderer/src/tauri-bridge/save')
  return { ...openFiles, ...files, ...save }
}

/** Paths in the most recent `watch_open_files` call. */
const watched = (): string[] => {
  const calls = invoke.mock.calls.filter(([command]) => command === 'watch_open_files')
  if (!calls.length) return []
  return (calls[calls.length - 1][1] as { paths: string[] }).paths
}

const settle = async(): Promise<void> => {
  // The watch is re-armed on a debounce, so let it fire.
  await vi.advanceTimersByTimeAsync(500)
}

describe('watching open files', () => {
  beforeEach(() => {
    invoke.mockReset()
    showSaveDialog.mockReset()
    ask.mockReset()
    invoke.mockResolvedValue(undefined)
    vi.useFakeTimers()
  })

  it('arms the watch once for a burst of opened files', async() => {
    const { trackOpenFile } = await load()

    trackOpenFile('/docs/a.md')
    trackOpenFile('/docs/b.md')
    trackOpenFile('/docs/c.md')
    await settle()

    // Opening a folder adds paths one at a time; re-arming per path would ask
    // Rust to rebuild the whole set over and over.
    expect(invoke.mock.calls.filter(([c]) => c === 'watch_open_files')).toHaveLength(1)
    expect(watched().sort()).toEqual(['/docs/a.md', '/docs/b.md', '/docs/c.md'])
  })

  it('drops a path when its tab closes', async() => {
    const { trackOpenFile, untrackOpenFile } = await load()

    trackOpenFile('/docs/a.md')
    trackOpenFile('/docs/b.md')
    await settle()
    untrackOpenFile('/docs/a.md')
    await settle()

    expect(watched()).toEqual(['/docs/b.md'])
  })

  it('follows a renamed document instead of watching both names', async() => {
    const { trackOpenFile, renameOpenFile } = await load()
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === 'path_exists' ? false : undefined)
    )

    trackOpenFile('/docs/old.md')
    await settle()
    await renameOpenFile(
      { id: 't1', pathname: '/docs/old.md', newPathname: '/docs/new.md' },
      vi.fn()
    )
    await settle()

    expect(watched()).toEqual(['/docs/new.md'])
  })

  it('follows a save-as onto the new file', async() => {
    const { trackOpenFile, saveDocument } = await load()
    showSaveDialog.mockResolvedValue('/docs/copy.md')

    trackOpenFile('/docs/original.md')
    await settle()
    await saveDocument(
      {
        id: 't1',
        filename: 'original.md',
        pathname: '/docs/original.md',
        markdown: 'x',
        options: { encoding: { encoding: 'utf8', isBom: false }, lineEnding: 'lf' }
      },
      vi.fn(),
      true
    )
    await settle()

    expect(watched()).toEqual(['/docs/copy.md'])
  })
})

describe('reacting to a change on disk', () => {
  beforeEach(() => {
    invoke.mockReset()
    ask.mockReset()
    invoke.mockResolvedValue(undefined)
    vi.useFakeTimers()
  })

  it('reads the file and hands the content over', async() => {
    const { trackOpenFile, handleDiskChange } = await load()
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === 'read_file' ? 'edited elsewhere' : undefined)
    )
    const dispatch = vi.fn()

    trackOpenFile('/docs/a.md')
    await handleDiskChange({ pathname: '/docs/a.md', kind: 'change' }, dispatch)

    // The store compares this against the tab's own text before it warns, so a
    // save the editor just made passes through without bothering anyone.
    expect(dispatch).toHaveBeenCalledWith('mt::update-file', [
      {
        type: 'change',
        change: {
          pathname: '/docs/a.md',
          data: { markdown: 'edited elsewhere', filename: 'a.md', pathname: '/docs/a.md' }
        }
      }
    ])
  })

  it('reports a deletion without trying to read it', async() => {
    const { trackOpenFile, handleDiskChange } = await load()
    const dispatch = vi.fn()

    trackOpenFile('/docs/a.md')
    await handleDiskChange({ pathname: '/docs/a.md', kind: 'unlink' }, dispatch)

    expect(invoke.mock.calls.some(([c]) => c === 'read_file')).toBe(false)
    expect(dispatch).toHaveBeenCalledWith('mt::update-file', [
      { type: 'unlink', change: { pathname: '/docs/a.md' } }
    ])
  })

  it('ignores a path no tab is showing', async() => {
    const { handleDiskChange } = await load()
    const dispatch = vi.fn()

    await handleDiskChange({ pathname: '/docs/stranger.md', kind: 'change' }, dispatch)

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('says nothing when the file vanished before it could be read', async() => {
    const { trackOpenFile, handleDiskChange } = await load()
    invoke.mockImplementation((command: string) =>
      command === 'read_file' ? Promise.reject(new Error('gone')) : Promise.resolve(undefined)
    )
    const dispatch = vi.fn()

    trackOpenFile('/docs/a.md')
    await handleDiskChange({ pathname: '/docs/a.md', kind: 'change' }, dispatch)

    // The matching unlink event is already on its way.
    expect(dispatch).not.toHaveBeenCalled()
  })
})
