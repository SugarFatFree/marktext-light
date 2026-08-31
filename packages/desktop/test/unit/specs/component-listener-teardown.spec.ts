// A component must undo what it registered.
//
// Nothing here is visible while it is going wrong. A `bus.on` left behind after
// unmount does not throw — the handlers guard on template refs, which Vue has
// already set to null — it just keeps the whole component scope alive through
// its closure. The sidebar tree mounts one component per file and per folder, so
// collapsing a folder or switching projects leaves them behind by the hundred,
// and the only symptom is that the app uses more memory the longer it is used.
//
// A `document.addEventListener` left behind is worse: it outlives the component
// that wanted it and goes on running on every click and keystroke in the app.
// `tree.vue` had three, all anonymous — which is why they could not be removed
// even in principle.
//
// Stores are not scanned. A Pinia store here is a singleton created once at
// startup and never torn down, so its handlers are meant to outlive everything;
// requiring symmetry there would be requiring the wrong thing.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'

const RENDERER = resolve(__dirname, '../../../src/renderer/src')

/**
 * Components that are mounted once for the lifetime of the window, so there is
 * no unmount at which to undo anything. Each has to be a component the router or
 * the shell keeps forever — not merely one that is usually on screen.
 */
const LIVES_AS_LONG_AS_THE_WINDOW: Record<string, string> = {
  'pages/app.vue': 'The editor window shell itself; unmounting it means the window is gone.'
}

const vueFiles = (dir: string, acc: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) vueFiles(full, acc)
    else if (name.endsWith('.vue')) acc.push(full)
  }
  return acc
}

interface Unbalanced {
  file: string
  registered: string[]
}

/** Every `x('name', …)` call, counted, so two registrations need two removals. */
const counted = (source: string, pattern: RegExp): Map<string, number> => {
  const found = new Map<string, number>()
  for (const match of source.matchAll(pattern)) {
    const key = match.slice(1).join(':')
    found.set(key, (found.get(key) ?? 0) + 1)
  }
  return found
}

const ON = /bus\.on\(\s*['"]([^'"]+)['"]/g
const OFF = /bus\.off\(\s*['"]([^'"]+)['"]/g
const ADD = /(document|window)\.addEventListener\(\s*['"]([^'"]+)['"]/g
const REMOVE = /(document|window)\.removeEventListener\(\s*['"]([^'"]+)['"]/g

const unbalanced = (register: RegExp, unregister: RegExp): Unbalanced[] => {
  const rows: Unbalanced[] = []

  for (const file of vueFiles(RENDERER)) {
    const key = relative(RENDERER, file).split('\\').join('/')
    if (LIVES_AS_LONG_AS_THE_WINDOW[key]) continue

    const source = readFileSync(file, 'utf-8')
    const on = counted(source, register)
    if (!on.size) continue
    const off = counted(source, unregister)

    const registered = [...on]
      .filter(([name, times]) => (off.get(name) ?? 0) < times)
      .map(([name]) => name)

    if (registered.length) rows.push({ file: key, registered })
  }

  return rows
}

const render = (rows: Unbalanced[]): string[] =>
  rows.map((row) => `${row.file}: ${row.registered.join(', ')}`)

describe('components undo what they register', () => {
  it('scans something', () => {
    // A refactor that moved every component elsewhere would otherwise leave
    // this suite passing on an empty set.
    expect(vueFiles(RENDERER).length).toBeGreaterThan(20)
  })

  it('removes every bus handler it adds', () => {
    expect(render(unbalanced(ON, OFF)), 'add a matching bus.off in onBeforeUnmount').toEqual([])
  })

  it('removes every document or window listener it adds', () => {
    // An anonymous listener cannot be removed at all, so this also forces the
    // handler to be named.
    expect(
      render(unbalanced(ADD, REMOVE)),
      'add a matching removeEventListener in onBeforeUnmount'
    ).toEqual([])
  })

  it('has no exemption for a component that no longer exists', () => {
    const present = vueFiles(RENDERER).map((f) => relative(RENDERER, f).split('\\').join('/'))
    const stale = Object.keys(LIVES_AS_LONG_AS_THE_WINDOW).filter((f) => !present.includes(f))

    expect(stale, 'remove these from LIVES_AS_LONG_AS_THE_WINDOW').toEqual([])
  })
})
