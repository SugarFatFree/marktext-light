/**
 * Phase timings from navigation start to the first document on screen.
 *
 * A report of "three seconds from icon to content" splits into a part the
 * renderer can see and a part only the shell can. This is the renderer's half,
 * printed as one line so it can be read off a console without tooling; the
 * shell prints its own to stderr.
 *
 * Marks are milliseconds since `performance.timeOrigin`, which is the
 * navigation — so they exclude process spawn and WebView creation, and that
 * exclusion is the point: subtract this from the wall-clock total and what is
 * left is everything before the first line of JavaScript.
 */
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './isTauri'

const marks: Array<[string, number]> = []
let reported = false

export const markStartup = (stage: string, when = performance.now()): void => {
  if (reported) return
  const at = Math.round(when)
  marks.push([stage, at])

  // Also send it to the shell, which writes a file. On Windows a released
  // Tauri binary has no console, so a console line is unreachable there — and
  // one file with both halves in order beats two places to look.
  if (isTauri()) {
    invoke('startup_trace', { stage, sinceNavigationMs: at }).catch(() => {
      // A missing trace must never be the reason startup fails.
    })
  }
}

/**
 * Splits the stretch before the first line of app code into fetching and
 * compiling, which is the difference between "the bundle is too big" and
 * "serving it is slow" — opposite fixes.
 *
 * Read off the timing API rather than marked by hand: by the time app code
 * runs, both the document and the script that carries it have finished
 * loading, and the browser already recorded when. Call this before the first
 * mark so the log reads in order.
 */
export const markNetworkTimings = (): void => {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (nav) markStartup('document fetched', nav.responseEnd)

  // The entry chunk, identified by size: it is by far the largest script an
  // editor window loads, and its name carries a build hash.
  const scripts = performance
    .getEntriesByType('resource')
    .filter((entry): entry is PerformanceResourceTiming => entry.name.endsWith('.js'))
  const entry = scripts.reduce<PerformanceResourceTiming | null>(
    (largest, script) => (!largest || script.decodedBodySize > largest.decodedBodySize ? script : largest),
    null
  )
  if (entry) {
    markStartup(`bundle fetched (${Math.round(entry.decodedBodySize / 1024)} KB)`, entry.responseEnd)
  }
}

/**
 * Print the line, once. Safe to call from more than one place — whichever
 * phase finishes last wins, and later calls are ignored rather than appending
 * to a line nobody will read twice.
 */
export const reportStartup = (finalStage: string): void => {
  if (reported) return
  markStartup(finalStage)
  reported = true

  const line = marks.map(([stage, at]) => `${stage} ${at}ms`).join(' · ')
  console.log(`[startup] ${line}`)
  if (isTauri()) {
    invoke<string | null>('startup_log_path')
      .then((path) => {
        // Where the whole trace lives, shell phases included. Printed because
        // the directory is a platform convention, not something anyone chose.
        console.log(`[startup] full trace: ${path ?? '(no log file)'}`)
      })
      .catch(() => {})
  }
  ;(window as unknown as { __MT_STARTUP__?: string }).__MT_STARTUP__ = line
}
