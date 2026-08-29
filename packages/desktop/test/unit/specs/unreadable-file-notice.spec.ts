// Opening a file that cannot be read must say so.
//
// The bridge answers `mt::open-file` by reading the path and dispatching a new
// tab. When the read failed — gone, not permitted, or a binary — it logged to
// the console and returned, so clicking a file in the tree or the recent list
// did nothing at all, with no way for the user to tell whether the click had
// even registered. Upstream raises these from the main process through
// `mt::show-notification`; with no main process, the bridge does.
//
// The watcher's own read failure deliberately stays quiet, and that asymmetry
// is asserted below: a file removed between the change event and the read is
// the ordinary case, and its unlink event is already on the way.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const invoke = vi.fn()

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

interface Renderer {
  on: (channel: string, handler: (...args: unknown[]) => void) => void
  send: (channel: string, ...args: unknown[]) => void
}

const install = async(readFile: (path: string) => Promise<unknown>): Promise<Renderer> => {
  vi.resetModules()
  invoke.mockReset()
  invoke.mockImplementation((cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'boot_info') return Promise.resolve(BOOT)
    if (cmd === 'read_file') return readFile(String(args.path))
    return Promise.resolve(null)
  })

  const bridge = await import('../../../src/renderer/src/tauri-bridge')
  await bridge.installTauriBridge()
  return (window as unknown as { electron: { ipcRenderer: Renderer } }).electron.ipcRenderer
}

const settle = async(): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('opening a file that cannot be read', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/?type=editor')
  })

  it('tells the user, naming the file and the reason', async() => {
    const renderer = await install(() => Promise.reject(new Error('permission denied')))
    const notices: Array<{ title?: string; type?: string; message?: string }> = []
    renderer.on('mt::show-notification', (_e, opts) => notices.push(opts as never))

    renderer.send('mt::open-file', '/tmp/locked.md', {})
    await settle()

    expect(notices).toHaveLength(1)
    expect(notices[0]?.type).toBe('error')
    expect(notices[0]?.message).toContain('/tmp/locked.md')
    expect(notices[0]?.message).toContain('permission denied')
  })

  it('says so for a file that is not text either', async() => {
    const renderer = await install(() => Promise.resolve(null))
    const notices: unknown[] = []
    renderer.on('mt::show-notification', (_e, opts) => notices.push(opts))

    renderer.send('mt::open-file', '/tmp/photo.png', {})
    await settle()

    expect(notices).toHaveLength(1)
  })

  it('opens no tab when the read failed', async() => {
    const renderer = await install(() => Promise.reject(new Error('gone')))
    const opened: unknown[] = []
    renderer.on('mt::open-new-tab', (...args: unknown[]) => opened.push(args))

    renderer.send('mt::open-file', '/tmp/gone.md', {})
    await settle()

    expect(opened).toEqual([])
  })

  it('stays quiet when the watcher cannot re-read a changed file', async() => {
    // The ordinary case is a file removed between the change event and the
    // read, whose unlink event is already on its way. A toast for each would
    // fire on every rename and delete.
    const source = readFileSync(
      resolve(__dirname, '../../../src/renderer/src/tauri-bridge/open-files.ts'),
      'utf-8'
    )

    expect(source).not.toMatch(/show-notification/)
  })
})
