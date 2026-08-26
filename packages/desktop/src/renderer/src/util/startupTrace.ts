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
const marks: Array<[string, number]> = []
let reported = false

export const markStartup = (stage: string): void => {
  if (reported) return
  marks.push([stage, Math.round(performance.now())])
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
  ;(window as unknown as { __MT_STARTUP__?: string }).__MT_STARTUP__ = line
}
