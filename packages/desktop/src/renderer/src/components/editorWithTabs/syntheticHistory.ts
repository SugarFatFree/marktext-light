// Synthetic save-tracking history for the WYSIWYG engine.
//
// The `@muyajs/core` engine's undo/redo history (`getHistory()`) has a
// different shape than the desktop store's `tab.history` (which drives the
// save/dirty indicator). The renderer therefore feeds the store a SYNTHETIC,
// desktop-shaped history whose single stack entry carries an `id` the store
// compares against `tab.lastSavedHistoryId`: when the current id equals the
// saved id the tab is shown as clean, otherwise dirty.
//
// The id MUST satisfy two properties:
//   1. clean  <=> the live document content matches the saved-on-disk content.
//   2. monotonic & never-reused: a divergent edit can never collide with the
//      saved id, even when it returns the engine undo-stack to the same DEPTH.
//
// An earlier implementation used the undo-stack DEPTH as the id. Depth is
// REUSED across distinct documents at the same stack height, so the sequence
//   type A, type B, save, undo B, type C  (a NEW divergent edit)
// returned the depth — and therefore the id — to the saved value while the
// document was actually A+C, falsely showing the tab as clean and risking
// data loss on close-without-save (Phase G — G6).
//
// Legacy muyajs avoided this by assigning every pushed history entry a
// MONOTONIC, never-reused id and splicing the redo tail on a new edit. We
// reproduce the exact semantics here, but keyed on the live document content
// rather than on the engine's internal stack objects (the engine regenerates
// its undo operations via invert on every undo/redo, so object identity is not
// stable). Each DISTINCT content snapshot is assigned a fresh monotonic id the
// first time it is seen; revisiting an earlier snapshot (undo/redo back to it)
// reuses that snapshot's original id. Undoing back to the saved content
// therefore restores the saved id (clean); a divergent re-edit produces brand
// new content and hence a brand new id (dirty) — never the saved one.

// Trailing newlines are NOT meaningful content for save/dirty tracking — the
// store itself normalizes them via `adjustTrailingNewlines`/`trimTrailingNewline`
// before saving. The engine's markdown serialization is also unstable across a
// `setContent` -> edit -> undo round-trip purely in trailing newlines (loading
// `'x\n'` may serialize to `'x\n\n\n'`, while undoing an edit lands on `'x\n'`),
// so the content signature must ignore them or undo-to-saved would never match.
const stripTrailingNewlines = (content: string): string =>
  content.replace(/[\r\n]+$/, '')

// A stable content signature over the trailing-newline-normalized content,
// used so the content -> id map stores short keys instead of whole documents.
// A collision would map two genuinely different documents to the same id and
// could reintroduce the false-clean this guards against, so the key is wide:
// two 32-bit FNV-1a lanes with different primes, concatenated.
//
// It was one 64-bit lane in BigInt, which is exact but pays a heap-allocating
// multiply per character — and this runs on every keystroke, over the whole
// document. Measured: 200 KB took 27 ms, 800 KB took 98 ms. The same two lanes
// through `Math.imul`, which stays in the integer fast path, take 0 ms and
// 3 ms. On a large file that was a visible share of the typing latency.
//
// Two 32-bit lanes are not the same guarantee as one true 64-bit hash — the
// lanes are not provably independent — but they are far past what this needs:
// the map lives for one editing session and holds one entry per distinct
// snapshot, thousands at most.
const FNV32_OFFSET = 0x811c9dc5
const FNV32_PRIME = 0x01000193
const SECOND_LANE_OFFSET = 0x9dc5811c
const SECOND_LANE_PRIME = 0x85ebca6b

const hashContent = (content: string): string => {
  const normalized = stripTrailingNewlines(content)
  let a = FNV32_OFFSET
  let b = SECOND_LANE_OFFSET
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i)
    a = Math.imul(a ^ code, FNV32_PRIME)
    b = Math.imul(b ^ code, SECOND_LANE_PRIME)
  }

  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`
}

export interface IFileHistoryLike {
  stack: Array<{ id: number | string; [key: string]: unknown }>
  index: number
  lastEditIndex: number
  lastInitIndex: number
}

// Per-tab monotonic id allocator. Created once when a tab's content baseline is
// established and reset whenever the engine reloads the document (`setContent`
// clears the engine history), so the baseline id is always 0 — matching the
// store's seeded `lastSavedHistoryId: 0` for a freshly loaded/clean document.
export class SyntheticHistory {
  private counter = 0
  private readonly idByContent = new Map<string, number>()

  constructor(baselineContent: string = '') {
    // The freshly-loaded document is its own clean baseline; the store seeds
    // `lastSavedHistoryId` to 0, so the baseline content must map to id 0.
    this.idByContent.set(hashContent(baselineContent), 0)
  }

  // Return the monotonic id for the given content snapshot, assigning a fresh,
  // never-reused id the first time a snapshot is seen and reusing the original
  // id on every subsequent revisit (undo/redo back to it).
  idFor(content: string): number {
    const key = hashContent(content)
    let id = this.idByContent.get(key)
    if (id === undefined) {
      id = ++this.counter
      this.idByContent.set(key, id)
    }
    return id
  }

  // Build the desktop-shaped synthetic history the store consumes. The store
  // only reads `stack[lastEditIndex].id`; the remaining fields keep its
  // bookkeeping happy (a single committed edit at index 0).
  build(content: string): IFileHistoryLike {
    return {
      stack: [{ id: this.idFor(content) }],
      index: 0,
      lastEditIndex: 0,
      lastInitIndex: -1
    }
  }
}
