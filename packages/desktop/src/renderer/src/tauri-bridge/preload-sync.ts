// Side-effect import: installs the Tauri `window.*` bridge globals synchronously
// at module-load time, before any other renderer module runs its top-level code.
//
// This MUST be the first import in main.ts. Several modules read
// preload-provided globals during module initialization (e.g. config.ts's
// `export const PATH_SEPARATOR = window.path.sep`). Under Electron the preload
// script sets those globals before the bundle executes; under Tauri there is no
// preload, so we set them here first. No-op under Electron.

import { isTauri, installTauriBridgeSync } from './index'

if (isTauri()) {
  installTauriBridgeSync()
}
