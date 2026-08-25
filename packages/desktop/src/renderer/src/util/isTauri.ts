/**
 * True when running under the Tauri shell rather than Electron.
 *
 * Its own module, small on purpose. It used to live in `tauri-bridge/index.ts`,
 * so anything that merely wanted to know which shell it was in had to import
 * the whole bridge — which imports `@/i18n`, which registers an IPC listener as
 * it loads. That is a lot of machinery to answer a question about a global, and
 * it broke a unit test that had no reason to know the bridge exists.
 *
 * The bridge re-exports this, so `import { isTauri } from '@/tauri-bridge'`
 * still works for callers that are importing the bridge anyway.
 */
export function isTauri(): boolean {
  return typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== 'undefined'
}
