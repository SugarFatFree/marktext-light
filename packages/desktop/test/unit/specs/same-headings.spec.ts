// The table-of-contents comparison that runs on every keystroke.
//
// It was `deep-equal`. A CPU profile of typing in a 210 KB document, taken in
// the real renderer through CDP, put that call and its brand checks — isMap,
// isWeakSet, tryBigIntObject, booleanBrandCheck — above 40% of all samples, to
// compare flat objects of strings and numbers.
//
// The replacement compares values with `Object.is`, so it is stricter than
// `deep-equal`: structurally equal but distinct objects read as different. That
// asymmetry is the point and is asserted below — a false "changed" only costs a
// TOC rebuild, while a false "unchanged" would leave the sidebar stale.

import { describe, it, expect } from 'vitest'
import { sameHeadings, type ListItem } from '@/util/listToTree'

const heading = (lvl: number, content: string): ListItem => ({
  lvl,
  content,
  slug: content.toLowerCase().replace(/\s+/g, '-')
})

const toc = (n: number): ListItem[] =>
  Array.from({ length: n }, (_, i) => heading((i % 6) + 1, `Section ${i}`))

describe('sameHeadings', () => {
  it('accepts two separately built lists with the same content', () => {
    expect(sameHeadings(toc(300), toc(300))).toBe(true)
  })

  it('rejects a changed heading text', () => {
    const a = toc(50)
    const b = toc(50)
    b[20] = { ...b[20], content: 'Renamed' } as ListItem

    expect(sameHeadings(a, b)).toBe(false)
  })

  it('rejects a changed level, which reshapes the tree', () => {
    const a = toc(10)
    const b = toc(10)
    b[3] = { ...b[3], lvl: 6 } as ListItem

    expect(sameHeadings(a, b)).toBe(false)
  })

  it('rejects an added or removed heading', () => {
    expect(sameHeadings(toc(10), toc(9))).toBe(false)
    expect(sameHeadings(toc(9), toc(10))).toBe(false)
  })

  it('rejects an entry that gained a key', () => {
    const a = toc(3)
    const b = toc(3)
    b[1] = { ...b[1], githubSlug: 'section-1' } as ListItem

    expect(sameHeadings(a, b)).toBe(false)
  })

  it('errs towards "changed" for nested values it cannot compare cheaply', () => {
    // Not a case the TOC produces — entries are flat — but if one ever did,
    // this is the direction that stays correct.
    const a: ListItem[] = [{ lvl: 1, content: 'x', extra: { deep: true } }]
    const b: ListItem[] = [{ lvl: 1, content: 'x', extra: { deep: true } }]

    expect(sameHeadings(a, b)).toBe(false)
  })

  it('is cheap enough to run on a keystroke', () => {
    const a = toc(300)
    const b = toc(300)
    const started = Date.now()
    for (let i = 0; i < 200; i++) sameHeadings(a, b)

    // Generous: the point is that 200 full comparisons of a 300-heading
    // document are not a keystroke's worth of work.
    expect(Date.now() - started).toBeLessThan(500)
  })
})
