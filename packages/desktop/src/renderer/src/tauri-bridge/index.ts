// Tauri bridge shim.
//
// Re-creates the exact `window.*` surface the Electron preload used to expose
// (`electron`, `fileUtils`, `path`, `process`, `commandExists`, `i18nUtils`,
// `ripgrep`, `uploader`, `fonts`, `rgPath`) but backed by Tauri `invoke` and
// the Tauri plugin APIs instead of Node + ipcRenderer. Keeping the signatures
// identical means the Vue renderer and muya run unchanged.
//
// `installTauriBridge()` MUST be awaited before the Vue app mounts: it performs
// the one-shot boot-info handshake that the old synchronous
// `ipcRenderer.sendSync('mt::boot-info')` provided.
//
// Scope note (phase 1): only the fs/shell/clipboard/paths/cmd/window/boot
// channels are wired to real Rust commands. App-lifecycle, menu, watcher,
// ripgrep, uploader and updater channels are stubbed to degrade gracefully
// (warn + resolve) until phases 2–7 land their Rust handlers.

import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager'
import { openUrl, openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import pathe from 'pathe'

import type { BootInfo } from '@shared/types/ipc'

// -----------------------------------------------------------------------------
// Invoke-channel → Rust command routing
// -----------------------------------------------------------------------------

type ArgMapper = (args: unknown[]) => Record<string, unknown>

interface CommandRoute {
  cmd: string
  map: ArgMapper
}

// Positional IPC args → named Tauri command args. Tauri converts these camelCase
// keys to the snake_case parameters declared in src-tauri/src/commands/*.
const INVOKE_ROUTES: Record<string, CommandRoute> = {
  'mt::fs::is-file': { cmd: 'is_file', map: ([path]) => ({ path }) },
  'mt::fs::is-directory': { cmd: 'is_directory', map: ([path]) => ({ path }) },
  'mt::fs::path-exists': { cmd: 'path_exists', map: ([path]) => ({ path }) },
  'mt::fs::is-executable': { cmd: 'is_executable', map: ([path]) => ({ path }) },
  'mt::fs::read-file': { cmd: 'read_file', map: ([path, encoding]) => ({ path, encoding }) },
  'mt::fs::write-file': { cmd: 'write_file', map: ([path, data]) => ({ path, data }) },
  'mt::fs::output-file': { cmd: 'output_file', map: ([path, data]) => ({ path, data }) },
  'mt::fs::ensure-dir': { cmd: 'ensure_dir', map: ([path]) => ({ path }) },
  'mt::fs::empty-dir': { cmd: 'empty_dir', map: ([path]) => ({ path }) },
  'mt::fs::copy': { cmd: 'copy_path', map: ([src, dest]) => ({ src, dest }) },
  'mt::fs::move': { cmd: 'move_path', map: ([src, dest]) => ({ src, dest }) },
  'mt::fs::unlink': { cmd: 'unlink', map: ([path]) => ({ path }) },
  'mt::fs::readdir': { cmd: 'readdir', map: ([path]) => ({ path }) },
  'mt::fs::stat': { cmd: 'stat', map: ([path]) => ({ path }) },
  'mt::paths::is-image': { cmd: 'is_image', map: ([path]) => ({ path }) },
  'mt::paths::is-same-sync': { cmd: 'is_same_path', map: ([a, b]) => ({ a, b }) },
  'mt::cmd::exists': { cmd: 'command_exists', map: ([name]) => ({ name }) }
}

const routedInvoke = async(channel: string, args: unknown[]): Promise<unknown> => {
  const route = INVOKE_ROUTES[channel]
  if (route) {
    return invoke(route.cmd, route.map(args))
  }
  // Not yet migrated (menu/app/updater/…). Resolve instead of throwing so the
  // UI keeps rendering while later phases fill these in.
  console.warn(`[tauri-bridge] unhandled invoke channel: ${channel}`)
  return undefined
}

// -----------------------------------------------------------------------------
// Window control (mt::win::*) via the Tauri window API
// -----------------------------------------------------------------------------

const win = () => getCurrentWindow()

// Fire-and-forget helper. The window/clipboard ops below are best-effort and
// have no caller waiting on them; swallow rejections so a failed native call
// can't surface as an unhandled promise rejection.
const fire = (op: Promise<unknown>): void => {
  op.catch((err) => console.warn('[tauri-bridge]', err))
}

const handleSend = (channel: string, args: unknown[]): void => {
  switch (channel) {
    case 'mt::win::minimize':
      fire(win().minimize())
      return
    case 'mt::win::maximize':
      fire(win().maximize())
      return
    case 'mt::win::unmaximize':
      fire(win().unmaximize())
      return
    case 'mt::win::toggle-maximize':
      fire(win().toggleMaximize())
      return
    case 'mt::win::close':
      fire(win().close())
      return
    case 'mt::win::set-fullscreen':
      fire(win().setFullscreen(Boolean(args[0])))
      return
    case 'mt::win::toggle-fullscreen':
      fire(win().isFullscreen().then((f) => win().setFullscreen(!f)))
      return
    case 'mt::clipboard::write-text':
      fire(writeText(String(args[0] ?? '')))
      return
    case 'mt::shell::show-item':
      fire(revealItemInDir(String(args[0] ?? '')))
      return
    default:
      // Fire-and-forget app-lifecycle channels not yet migrated.
      console.warn(`[tauri-bridge] unhandled send channel: ${channel}`)
  }
}

// -----------------------------------------------------------------------------
// Push events (main → renderer). Bridged onto the Tauri event bus so future
// Rust `emit`s reach the same `.on(...)` call sites.
// -----------------------------------------------------------------------------

type Listener = (event: unknown, ...args: unknown[]) => void

const registerEvent = (channel: string, listener: Listener, once: boolean): (() => void) => {
  let unlisten: UnlistenFn | undefined
  let disposed = false
  fire(
    listen(channel, (evt) => {
      const payload = evt.payload
      const args = Array.isArray(payload) ? payload : [payload]
      listener({}, ...args)
      if (once && unlisten) unlisten()
    }).then((fn) => {
      unlisten = fn
      if (disposed) fn()
    })
  )
  return () => {
    disposed = true
    if (unlisten) unlisten()
  }
}

const buildIpcWrapper = () => ({
  send: (channel: string, ...args: unknown[]) => handleSend(channel, args),
  sendSync: (channel: string, ..._args: unknown[]): unknown => {
    // Tauri has no synchronous invoke. The only sync caller is the
    // case-insensitive path fallback, which the shim already narrowed to a rare
    // branch; return false rather than block. boot-info is handled up front.
    if (channel === 'mt::paths::is-same-sync') return false
    console.warn(`[tauri-bridge] sendSync not supported for ${channel}`)
    return undefined
  },
  invoke: (channel: string, ...args: unknown[]) => routedInvoke(channel, args),
  on: (channel: string, listener: Listener) => registerEvent(channel, listener, false),
  once: (channel: string, listener: Listener) => registerEvent(channel, listener, true),
  removeAllListeners: () => {
    // Per-listener disposers are returned by on()/once(); callers use those.
  }
})

// -----------------------------------------------------------------------------
// Pure path helpers (identical to the old preload implementations)
// -----------------------------------------------------------------------------

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
] as const

const hasMarkdownExtension = (filename: string): boolean => {
  if (!filename || typeof filename !== 'string') return false
  return MARKDOWN_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(`.${ext}`))
}

const isChildOfDirectory = (dir: string, child: string): boolean => {
  if (!dir || !child) return false
  const relative = pathe.relative(dir, child)
  return !!relative && !relative.startsWith('..') && !pathe.isAbsolute(relative)
}

const isSamePathSync = (pathA: string, pathB: string, isNormalized = false): boolean => {
  if (!pathA || !pathB) return false
  const a = isNormalized ? pathA : pathe.normalize(pathA)
  const b = isNormalized ? pathB : pathe.normalize(pathB)
  if (a.length !== b.length) return false
  if (a === b) return true
  // Case-insensitive filesystems: the async command exists, but this call site
  // needs a boolean now. Fall back to a case-insensitive compare in JS.
  return a.toLowerCase() === b.toLowerCase()
}

// -----------------------------------------------------------------------------
// Bridge installation
// -----------------------------------------------------------------------------

const buildGlobals = (boot: BootInfo, ipc: ReturnType<typeof buildIpcWrapper>) => {
  const electron = {
    ipcRenderer: ipc,
    shell: {
      openExternal: (url: string) => openUrl(url),
      showItemInFolder: (fullPath: string) => revealItemInDir(fullPath),
      openPath: (fullPath: string) => openPath(fullPath)
    },
    clipboard: {
      writeText: (text: string) => writeText(text),
      readText: () => readText(),
      guessFilePath: async() => null
    },
    webFrame: {
      // System WebView zoom differs per platform; wire real zoom in phase 3.
      setZoomFactor: (_factor: number) => {},
      setZoomLevel: (_level: number) => {}
    },
    webUtils: {
      // Tauri exposes dropped-file paths via the drag-drop event, not File objs.
      getPathForFile: (_file: File) => ''
    },
    process: {
      platform: boot.platform,
      arch: boot.arch,
      versions: boot.versions || {},
      env: boot.env || {},
      resourcesPath: boot.paths?.resources,
      cwd: boot.paths?.cwd
    },
    paths: boot.paths || {},
    isUpdatable: !!boot.isUpdatable,
    windowControl: {
      minimize: () => handleSend('mt::win::minimize', []),
      maximize: () => handleSend('mt::win::maximize', []),
      unmaximize: () => handleSend('mt::win::unmaximize', []),
      toggleMaximize: () => handleSend('mt::win::toggle-maximize', []),
      close: () => handleSend('mt::win::close', []),
      setFullScreen: (flag: boolean) => handleSend('mt::win::set-fullscreen', [flag]),
      toggleFullScreen: () => handleSend('mt::win::toggle-fullscreen', []),
      isMaximized: () => win().isMaximized(),
      isFullScreen: () => win().isFullscreen(),
      // The application menu is now a native Tauri menu set on the window
      // (see src-tauri/src/menu). Context-menu popup and the frameless-titlebar
      // app-menu popup still need wiring alongside the custom titlebar (phase 3).
      popupMenu: () => console.warn('[tauri-bridge] context-menu popup pending phase 3'),
      popupApplicationMenu: () => console.warn('[tauri-bridge] menu popup pending phase 3')
    }
  }

  const fileUtils = {
    isFile: (p: string) => routedInvoke('mt::fs::is-file', [p]),
    isDirectory: (p: string) => routedInvoke('mt::fs::is-directory', [p]),
    emptyDir: (p: string) => routedInvoke('mt::fs::empty-dir', [p]),
    copy: (src: string, dest: string) => routedInvoke('mt::fs::copy', [src, dest]),
    ensureDir: (p: string) => routedInvoke('mt::fs::ensure-dir', [p]),
    outputFile: (p: string, data: string | Uint8Array) =>
      routedInvoke('mt::fs::output-file', [p, data]),
    move: (src: string, dest: string) => routedInvoke('mt::fs::move', [src, dest]),
    stat: (p: string) => routedInvoke('mt::fs::stat', [p]),
    writeFile: (p: string, data: string | Uint8Array) => routedInvoke('mt::fs::write-file', [p, data]),
    readFile: (p: string, encoding?: string) => routedInvoke('mt::fs::read-file', [p, encoding]),
    pathExists: (p: string) => routedInvoke('mt::fs::path-exists', [p]),
    unlink: (p: string) => routedInvoke('mt::fs::unlink', [p]),
    readdir: (p: string) => routedInvoke('mt::fs::readdir', [p]),
    isExecutable: (p: string) => routedInvoke('mt::fs::is-executable', [p]),
    isChildOfDirectory,
    hasMarkdownExtension,
    isSamePathSync,
    isImageFile: (p: string) => routedInvoke('mt::paths::is-image', [p]),
    MARKDOWN_INCLUSIONS: boot.MARKDOWN_INCLUSIONS || []
  }

  const path = {
    basename: (...a: Parameters<typeof pathe.basename>) => pathe.basename(...a),
    dirname: (...a: Parameters<typeof pathe.dirname>) => pathe.dirname(...a),
    extname: (...a: Parameters<typeof pathe.extname>) => pathe.extname(...a),
    join: (...a: string[]) => pathe.join(...a),
    resolve: (...a: string[]) => pathe.resolve(...a),
    relative: (...a: Parameters<typeof pathe.relative>) => pathe.relative(...a),
    isAbsolute: (...a: Parameters<typeof pathe.isAbsolute>) => pathe.isAbsolute(...a),
    normalize: (...a: Parameters<typeof pathe.normalize>) => pathe.normalize(...a),
    parse: (...a: Parameters<typeof pathe.parse>) => pathe.parse(...a),
    format: (...a: Parameters<typeof pathe.format>) => pathe.format(...a),
    sep: pathe.sep,
    delimiter: pathe.delimiter
  }

  const processShim = {
    platform: boot.platform,
    arch: boot.arch,
    versions: boot.versions || {},
    env: boot.env || {},
    resourcesPath: boot.paths?.resources,
    cwd: () => boot.paths?.cwd,
    nextTick: (fn: (...a: unknown[]) => void, ...a: unknown[]) =>
      Promise.resolve().then(() => fn(...a))
  }

  return { electron, fileUtils, path, processShim, boot }
}

// Channels for search/upload/i18n/fonts that still need a Rust home; stubbed so
// imports resolve and the app boots.
const stubbedExtras = () => {
  const noopUnsub = () => () => {}
  return {
    commandExists: { exists: (name: string) => routedInvoke('mt::cmd::exists', [name]) },
    i18nUtils: {
      loadTranslations: async(_language: string) => ({})
    },
    ripgrep: {
      start: async() => ({ searchId: '' }),
      cancel: () => {},
      onMatch: noopUnsub(),
      onProgress: noopUnsub(),
      onDone: noopUnsub(),
      onError: noopUnsub(),
      onCancelled: noopUnsub()
    },
    uploader: { uploadImage: async() => ({}) },
    fonts: { list: async() => [] as string[] }
  }
}

let installed = false

/**
 * The Electron main process opened editor windows at `index.html?type=editor&
 * wid=1&udp=<userData>&…`; `bootstrap.ts` parses those query args and throws on
 * a missing `wid` (and the router only routes to /editor when `type=editor`).
 * The Tauri window loads `index.html` bare, so reconstruct the minimum args from
 * boot-info before `bootstrapRenderer()` runs. Preserves any real query string.
 */
function synthesizeEditorUrlArgs(boot: BootInfo): void {
  const params = new URLSearchParams(window.location.search)
  if (params.get('type')) return
  params.set('type', 'editor')
  params.set('wid', '1')
  params.set('udp', boot.paths?.userData || '/tmp')
  params.set('theme', 'light')
  params.set('debug', '0')
  params.set('hsb', '0')
  params.set('tbs', 'custom')
  const search = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}?${search}${window.location.hash}`)
}

function applyGlobals(boot: BootInfo): void {
  const ipc = buildIpcWrapper()
  const { electron, fileUtils, path, processShim } = buildGlobals(boot, ipc)
  const extras = stubbedExtras()

  const w = window as unknown as Record<string, unknown>
  w.electron = electron
  w.process = processShim
  w.rgPath = boot.paths?.ripgrepBinary || ''
  w.fileUtils = fileUtils
  w.path = path
  w.commandExists = extras.commandExists
  w.i18nUtils = extras.i18nUtils
  w.ripgrep = extras.ripgrep
  w.uploader = extras.uploader
  w.fonts = extras.fonts
  // Consumed by the editor's Tauri self-bootstrap to open a CLI/associated file.
  w.__MT_INITIAL_FILE__ = boot.initialFile ?? null
}

/**
 * Synchronous boot defaults used before the async `boot_info` handshake
 * resolves. The only value read at module-init time is `window.path.sep`
 * (config.ts), which comes from bundled `pathe` and is correct regardless — the
 * rest (real userData path, platform) is refined by `installTauriBridge()`.
 */
function defaultBoot(): BootInfo {
  const ua = navigator.userAgent
  const platform = /Win/i.test(ua) ? 'win32' : /Mac/i.test(ua) ? 'darwin' : 'linux'
  return {
    platform: platform as NodeJS.Platform,
    arch: 'x64',
    versions: {},
    env: {},
    paths: { resources: '', userData: '', cwd: '', ripgrepBinary: '' },
    isUpdatable: false,
    MARKDOWN_INCLUSIONS: [...MARKDOWN_EXTENSIONS]
  }
}

let syncInstalled = false

/**
 * Install the `window.*` bridge SYNCHRONOUSLY with default boot values. Must run
 * before any other renderer module executes its top-level code, because several
 * modules read preload-provided globals at import time (e.g.
 * `config.ts`'s `window.path.sep`). Under Electron the preload already provided
 * these, so this is Tauri-only and imported for its side effect by
 * `tauri-bridge/preload-sync`.
 */
export function installTauriBridgeSync(): void {
  if (syncInstalled || installed) return
  syncInstalled = true
  applyGlobals(defaultBoot())
}

/**
 * Refine the bridge with real boot-info (userData path, platform) and rebuild
 * the editor URL args before `bootstrapRenderer()` runs. Awaited once in
 * main.ts after the synchronous install.
 */
export async function installTauriBridge(): Promise<void> {
  if (installed) return
  installed = true

  const boot = (await invoke('boot_info')) as BootInfo
  synthesizeEditorUrlArgs(boot)
  applyGlobals(boot)
}

/** True when running under the Tauri shell rather than Electron. */
export function isTauri(): boolean {
  return typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== 'undefined'
}
