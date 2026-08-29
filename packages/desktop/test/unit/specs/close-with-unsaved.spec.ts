// Closing tabs and windows that still hold unsaved work.
//
// The property worth guarding is narrow and absolute: nothing closes unless it
// reached disk or the user said to discard it. A tab closed after a failed save
// takes the edits with it, and there is no undo for that.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const invoke = vi.fn()
const showSaveDialog = vi.fn()
const destroyWindow = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...args: unknown[]) => showSaveDialog(...args)
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    destroy: (...args: unknown[]) => destroyWindow(...args),
    onCloseRequested: () => Promise.resolve(() => {})
  })
}))

const UTF8 = { encoding: 'utf8', isBom: false }

const unsaved = (id: string, pathname?: string) => ({
  id,
  filename: `${id}.md`,
  pathname,
  markdown: `content of ${id}`,
  options: { encoding: UTF8, lineEnding: 'lf' }
})

const load = async() => {
  vi.resetModules()
  const save = await import('../../../src/renderer/src/tauri-bridge/save')
  const window = await import('../../../src/renderer/src/tauri-bridge/window')
  const bus = (await import('../../../src/renderer/src/bus')).default
  return { ...save, ...window, bus }
}

/** Stand in for the dialog component, answering however the case needs. */
const answerWith = (
  bus: { on: (e: string, h: (p: unknown) => void) => void },
  event: string,
  choice: 'save' | 'dontSave' | 'cancel'
): void => {
  bus.on(event, (payload) => {
    ;(payload as { respond: (c: string) => void }).respond(choice)
  })
}

describe('closing tabs with unsaved changes', () => {
  beforeEach(() => {
    invoke.mockReset()
    showSaveDialog.mockReset()
    destroyWindow.mockReset()
    invoke.mockResolvedValue(undefined)
  })

  it('closes nothing when the user cancels', async() => {
    const { saveAndCloseTabs, UNSAVED_FILES_ASK_EVENT, bus } = await load()
    answerWith(bus, UNSAVED_FILES_ASK_EVENT, 'cancel')
    const dispatch = vi.fn()

    await saveAndCloseTabs([unsaved('a', '/docs/a.md')], dispatch)

    expect(invoke.mock.calls.some(([c]) => c === 'write_file')).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('closes everything without writing when the user discards', async() => {
    const { saveAndCloseTabs, UNSAVED_FILES_ASK_EVENT, bus } = await load()
    answerWith(bus, UNSAVED_FILES_ASK_EVENT, 'dontSave')
    const dispatch = vi.fn()

    await saveAndCloseTabs([unsaved('a', '/docs/a.md'), unsaved('b', '/docs/b.md')], dispatch)

    expect(invoke.mock.calls.some(([c]) => c === 'write_file')).toBe(false)
    expect(dispatch).toHaveBeenCalledWith('mt::force-close-tabs-by-id', [['a', 'b']])
  })

  it('closes only the tabs that reached disk', async() => {
    const { saveAndCloseTabs, UNSAVED_FILES_ASK_EVENT, bus } = await load()
    answerWith(bus, UNSAVED_FILES_ASK_EVENT, 'save')
    invoke.mockImplementation((command: string, args: { path?: string }) => {
      if (command === 'write_file' && args.path === '/docs/b.md') {
        return Promise.reject(new Error('disk full'))
      }
      return Promise.resolve(undefined)
    })
    const dispatch = vi.fn()

    await saveAndCloseTabs([unsaved('a', '/docs/a.md'), unsaved('b', '/docs/b.md')], dispatch)

    const closed = dispatch.mock.calls.filter(([c]) => c === 'mt::force-close-tabs-by-id')
    expect(closed).toHaveLength(1)
    expect(closed[0][1]).toEqual([['a']])
    // The tab that failed is told so, and stays open.
    expect(dispatch.mock.calls.some(([c, args]) => c === 'mt::tab-save-failure' && args[0] === 'b'))
      .toBe(true)
  })

  it('leaves a tab open when its save dialog is dismissed', async() => {
    const { saveAndCloseTabs, UNSAVED_FILES_ASK_EVENT, bus } = await load()
    answerWith(bus, UNSAVED_FILES_ASK_EVENT, 'save')
    // No pathname, so saving needs a dialog — which the user then dismisses.
    showSaveDialog.mockResolvedValue(null)
    const dispatch = vi.fn()

    await saveAndCloseTabs([unsaved('a')], dispatch)

    const closed = dispatch.mock.calls.filter(([c]) => c === 'mt::force-close-tabs-by-id')
    expect(closed).toHaveLength(1)
    expect(closed[0][1]).toEqual([[]])
  })

  it('cancels the close when no dialog is mounted to answer', async() => {
    // A window still booting has no dialog listening. Hanging forever would
    // leave the tab unclosable with no explanation.
    const { saveAndCloseTabs } = await load()
    const dispatch = vi.fn()

    await saveAndCloseTabs([unsaved('a', '/docs/a.md')], dispatch)

    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('closing the window with unsaved changes', () => {
  beforeEach(() => {
    invoke.mockReset()
    showSaveDialog.mockReset()
    destroyWindow.mockReset()
    invoke.mockResolvedValue(undefined)
  })

  it('stays open when a save fails', async() => {
    const { closeWindowConfirm, UNSAVED_FILES_ASK_EVENT, bus } = await load()
    answerWith(bus, UNSAVED_FILES_ASK_EVENT, 'save')
    invoke.mockRejectedValue(new Error('disk full'))

    await closeWindowConfirm([unsaved('a', '/docs/a.md')], vi.fn())

    // Upstream closed regardless, discarding the edits the user had just asked
    // to keep. This build does not.
    expect(destroyWindow).not.toHaveBeenCalled()
  })

  it('closes once everything is written', async() => {
    const { closeWindowConfirm, UNSAVED_FILES_ASK_EVENT, bus } = await load()
    answerWith(bus, UNSAVED_FILES_ASK_EVENT, 'save')

    await closeWindowConfirm([unsaved('a', '/docs/a.md')], vi.fn())

    expect(destroyWindow).toHaveBeenCalled()
  })

  it('closes without writing when the user discards', async() => {
    const { closeWindowConfirm, UNSAVED_FILES_ASK_EVENT, bus } = await load()
    answerWith(bus, UNSAVED_FILES_ASK_EVENT, 'dontSave')

    await closeWindowConfirm([unsaved('a', '/docs/a.md')], vi.fn())

    expect(invoke.mock.calls.some(([c]) => c === 'write_file')).toBe(false)
    expect(destroyWindow).toHaveBeenCalled()
  })
})
