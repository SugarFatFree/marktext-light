// Quick Open, through the bridge's send routing.
//
// The command palette answers a pick by sending `mt::open-file-by-window-id`.
// Nothing routed it, and an unrouted send only logs a warning — so picking a
// file did nothing at all, silently. This drives the real routing table rather
// than asserting on the source, because the failure it guards against is a
// channel that reaches the default branch.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const invoke = vi.fn()

const BOOT = {
  platform: 'linux',
  arch: 'x64',
  versions: {},
  env: {},
  paths: { resources: '/app', userData: '/data', cwd: '/', ripgrepBinary: '/rg' },
  isUpdatable: false,
  MARKDOWN_INCLUSIONS: ['.md'],
  locale: 'en'
}

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }))
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) })
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    static getByLabel = () => Promise.resolve(null)
  }
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    label: 'main',
    onCloseRequested: () => Promise.resolve(() => {}),
    onResized: () => Promise.resolve(() => {}),
    onMoved: () => Promise.resolve(() => {}),
    onFocusChanged: () => Promise.resolve(() => {}),
    listen: () => Promise.resolve(() => {}),
    theme: () => Promise.resolve('light'),
    onThemeChanged: () => Promise.resolve(() => {}),
    setTitle: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
    isMaximized: () => Promise.resolve(false),
    isFullscreen: () => Promise.resolve(false),
    onDragDropEvent: () => Promise.resolve(() => {})
  })
}))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: () => Promise.resolve(),
  readText: () => Promise.resolve('')
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: () => Promise.resolve(null),
  save: () => Promise.resolve(null),
  message: () => Promise.resolve()
}))
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: () => Promise.resolve(),
  openPath: () => Promise.resolve(),
  revealItemInDir: () => Promise.resolve()
}))

const DOC = '/tmp/project/notes.md'

/** Install a fresh bridge and hand back the `window.electron` it exposes. */
const install = async() => {
  vi.resetModules()
  invoke.mockReset()
  invoke.mockImplementation((cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'boot_info') return Promise.resolve(BOOT)
    if (cmd === 'read_markdown_file') {
      return args.path === DOC
        ? Promise.resolve({
          markdown: '# Notes\n',
          filename: 'notes.md',
          pathname: DOC,
          encoding: { encoding: 'utf8', isBom: false },
          lineEnding: 'lf',
          adjustLineEndingOnSave: false,
          trimTrailingNewline: 1,
          isMixedLineEndings: false
        })
        : Promise.reject(new Error('not a text document'))
    }
    return Promise.resolve(null)
  })

  const bridge = await import('../../../src/renderer/src/tauri-bridge')
  await bridge.installTauriBridge()
  return (window as unknown as {
    electron: {
      ipcRenderer: {
        on: (channel: string, handler: (...args: unknown[]) => void) => void
        send: (channel: string, ...args: unknown[]) => void
      }
    }
  }).electron
}

/** Let the read + dispatch chain settle; both are promises, not timers. */
const settle = async(): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('picking a file in Quick Open', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/?type=editor')
  })

  it('opens it as a tab in this window', async() => {
    const electron = await install()
    const opened: unknown[] = []
    electron.ipcRenderer.on('mt::open-new-tab', (...args: unknown[]) => opened.push(args))

    // The palette passes the window it came from first, the path second.
    electron.ipcRenderer.send('mt::open-file-by-window-id', 7, DOC)
    await settle()

    expect(opened).toHaveLength(1)
    const [, doc] = opened[0] as [unknown, { markdown: string; filename: string; pathname: string }]
    expect(doc).toMatchObject({ markdown: '# Notes\n', filename: 'notes.md', pathname: DOC })
  })

  it('does not fall through to the unhandled-channel branch', async() => {
    const electron = await install()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    electron.ipcRenderer.send('mt::open-file-by-window-id', 7, DOC)
    await settle()

    const unhandled = warn.mock.calls.filter((call) =>
      String(call[0]).includes('unhandled send channel')
    )
    expect(unhandled).toEqual([])
    warn.mockRestore()
  })
})
