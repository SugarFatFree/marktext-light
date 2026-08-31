// A failure the user is waiting for must reach the user.
//
// Electron raised these from the main process through `mt::show-notification`.
// The bridge inherited the actions but not the notifications, and the result was
// always the same shape: a `catch` that writes to a console nobody has open and
// returns. The dialog closes, the file keeps its old name, the sidebar does not
// change, and there is no way to tell whether the click registered at all.
//
// This walks every `console.error` in the bridge and requires the block around
// it either to tell the user or to be listed below with a reason. Adding a new
// silent failure therefore fails here rather than in a bug report, and choosing
// silence stays possible — it just has to be argued for.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'

const BRIDGE = resolve(__dirname, '../../../src/renderer/src/tauri-bridge')

/**
 * Failures nobody is waiting for. Keyed by `file:fragment` so an exemption
 * cannot leak across files — two of these log the same words as sites that do
 * notify — and so a rewording is a deliberate act rather than an inheritance.
 */
const DELIBERATELY_SILENT: Record<string, string> = {
  'preferences.ts:cannot read':
    'A preferences file that does not exist yet on first run. Defaults apply.',
  'preferences.ts:cannot write':
    'A background write on every toggle; a toast per failure would be worse than the console.',
  'settings.ts:cannot open the settings window':
    'Raised from an event handler with no user gesture behind it.',
  'export.ts:cannot open the print dialog':
    'window.print() does not reject in practice, and the print DOM is restored either way.',
  'save.ts:invalid end of line character':
    'A programming error in our own data, not something the user did.',
  'index.ts:[renderer]': 'The console bridge itself.'
}

/**
 * Anything that puts the failure in front of the user: a `notifySomething`
 * helper, a notification raised inline, or a channel the renderer turns into
 * one. Matched by shape rather than by a list of names — the first draft of
 * this listed three helpers by name and immediately missed a fourth that was
 * doing the right thing.
 */
const TELLS_THE_USER =
  /notify[A-Z]\w*\(|reportMissingPandoc|show-notification|tab-save-failure|pandoc-not-exists/

interface Site {
  file: string
  line: number
  text: string
  /** The `catch` (or surrounding) block, as far as its closing brace. */
  block: string
}

const sites = (): Site[] => {
  const found: Site[] = []

  for (const name of readdirSync(BRIDGE).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(resolve(BRIDGE, name), 'utf-8')
    const lines = source.split('\n')

    lines.forEach((line, i) => {
      if (!line.includes('console.error')) return
      // Enough of what follows to see whether the user is told, without
      // needing to parse TypeScript to find the block's end.
      found.push({
        file: name,
        line: i + 1,
        text: line.trim(),
        block: lines.slice(Math.max(0, i - 6), i + 8).join('\n')
      })
    })
  }

  return found
}

const exemption = (site: Site): string | undefined =>
  Object.keys(DELIBERATELY_SILENT).find((key) => {
    const [file, fragment] = key.split(/:(.*)/s)
    return site.file === file && site.text.includes(fragment as string)
  })

describe('failures the user is waiting for', () => {
  it('finds the logging sites at all', () => {
    // If the shape of the bridge changes so much that nothing matches, this
    // suite would pass by finding nothing, which is the failure mode that
    // matters most for a test like this one.
    expect(sites().length).toBeGreaterThan(5)
  })

  it('either tells the user or is listed as deliberately silent', () => {
    const quiet = sites()
      .filter((site) => !exemption(site))
      .filter((site) => !TELLS_THE_USER.test(site.block))
      .map((site) => `${site.file}:${site.line}  ${site.text}`)

    expect(
      quiet,
      'these log a failure and return without telling anyone — notify, or add a reason to DELIBERATELY_SILENT'
    ).toEqual([])
  })

  it('has no exemption for a site that no longer exists', () => {
    const all = sites()
    const stale = Object.keys(DELIBERATELY_SILENT).filter((key) => {
      const [file, fragment] = key.split(/:(.*)/s)
      return !all.some((site) => site.file === file && site.text.includes(fragment as string))
    })

    // An exemption outliving its site is how the next one gets waved through.
    expect(stale, 'remove these from DELIBERATELY_SILENT').toEqual([])
  })
})
