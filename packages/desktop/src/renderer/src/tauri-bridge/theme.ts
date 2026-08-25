// Theme control for the Tauri build.
//
// Follows the OS light/dark preference by default and remembers an explicit
// choice in localStorage (Tauri preferences persistence lands in phase 5). The
// native Theme menu (src-tauri/src/menu) emits `mt::set-theme` with 'system',
// 'light', 'dark', or a specific theme id.

const STORAGE_KEY = 'mt-tauri-theme-choice'
const LIGHT = 'light'
const DARK = 'dark'

function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

function getChoice(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'system'
  } catch {
    return 'system'
  }
}

/**
 * Record the theme choice. The durable copy lives in the preferences file, but
 * first paint happens before that file can be read, so the choice is mirrored
 * here where it can be read synchronously. Every writer of the `theme`
 * preference must come through here or a restart will show the previous theme.
 */
export function rememberThemeChoice(choice: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    /* localStorage unavailable — the preferences file still has it */
  }
}

function themeForChoice(choice: string): string {
  if (choice === 'system') return systemPrefersDark() ? DARK : LIGHT
  return choice
}

/** The theme to apply on first paint, honoring a saved choice or the OS. */
export function resolveInitialTheme(): string {
  return themeForChoice(getChoice())
}

/**
 * Wire ongoing theme changes: react to OS light/dark switches while following
 * the system, and to the native Theme menu's `mt::set-theme` events.
 * `applyTheme` sets the renderer's active theme.
 */
export function initThemeController(applyTheme: (theme: string) => void): void {
  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', () => {
      if (getChoice() === 'system') applyTheme(systemPrefersDark() ? DARK : LIGHT)
    })
  }
  window.electron.ipcRenderer.on('mt::set-theme', (_e, choice) => {
    rememberThemeChoice(String(choice))
    applyTheme(themeForChoice(String(choice)))
  })
}
