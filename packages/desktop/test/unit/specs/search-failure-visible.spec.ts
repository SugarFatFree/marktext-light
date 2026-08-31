// A search that fails must say so, not read as "nothing matched".
//
// The panel clears its results on error and had only a `log.error` beside that,
// so an invalid regular expression — which the search backend rejects by name,
// and which the user has just typed into a box with a RegEx toggle right next
// to it — produced an empty list and no explanation. There is nowhere else to
// look: the panel is the whole UI for this.
//
// The affordance already existed. `searchErrorString` is rendered under the
// results and is where the hundred-file limit reports itself; the failure path
// simply never wrote to it.
//
// Static, because the alternative is mounting a component that pulls in the
// project store, the ripgrep shim and a directory searcher to assert one
// assignment. What can go wrong here is someone deleting the line.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const panel = readFileSync(
  resolve(__dirname, '../../../src/renderer/src/components/sideBar/search.vue'),
  'utf-8'
)

/** The `.catch` on the search promise, to its closing brace. */
const failurePath = (): string => {
  const start = panel.indexOf('.catch((err) => {')
  expect(start, 'the search no longer has a failure path').toBeGreaterThan(-1)
  return panel.slice(start, panel.indexOf('\n    })', start))
}

describe('a failed directory search', () => {
  it('writes the reason where the panel shows it', () => {
    expect(failurePath()).toContain('searchErrorString.value')
  })

  it('includes what actually went wrong, not a fixed sentence', () => {
    // The backend names the offending pattern; dropping that leaves the user
    // knowing only that something failed.
    expect(failurePath()).toContain('msg')
    expect(panel).toContain("t('search.searchFailed'")
  })

  it('still clears the stale results it is replacing', () => {
    expect(failurePath()).toContain('searchResult.value = []')
  })

  it('shows the message it sets', () => {
    // Setting a ref nothing renders would be the same bug with more steps.
    expect(panel).toContain('v-if="searchErrorString"')
    expect(panel).toContain('{{ searchErrorString }}')
  })

  it('clears it again when the next search starts', () => {
    // Otherwise a failure would outlive its cause and sit under good results.
    expect(panel).toContain("searchErrorString.value = ''")
  })
})
