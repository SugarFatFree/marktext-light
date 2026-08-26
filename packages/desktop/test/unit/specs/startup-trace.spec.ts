import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as StartupTrace from '@/util/startupTrace'

// The startup trace is only useful if its numbers mean what they say. Two
// things can quietly break that: reading the clock instead of the recorded
// timestamp (which would report when app code got round to looking, not when
// the resource arrived), and picking the wrong script out of the resource list
// (which would attribute the entry chunk's cost to a stray one).

const stubEntries = (nav: unknown, resources: unknown[]): void => {
  vi.stubGlobal('performance', {
    now: () => 9999,
    timeOrigin: 0,
    getEntriesByType: (type: string) => {
      if (type === 'navigation') return nav ? [nav] : []
      if (type === 'resource') return resources
      return []
    }
  })
}

const loadTrace = async(): Promise<typeof StartupTrace> => {
  vi.resetModules()
  return import('@/util/startupTrace')
}

const reportedLine = async(mod: typeof StartupTrace): Promise<string> => {
  mod.reportStartup('done')
  return (window as unknown as { __MT_STARTUP__: string }).__MT_STARTUP__
}

describe('markNetworkTimings', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports when the document finished loading, not when it was asked', async() => {
    stubEntries({ responseEnd: 120.4, decodedBodySize: 2048 }, [])
    const mod = await loadTrace()
    mod.markNetworkTimings()

    // 120, not the 9999 the clock would have given.
    expect(await reportedLine(mod)).toContain('document fetched 120ms')
  })

  it('measures the entry chunk, not whichever script happens to be first', async() => {
    stubEntries({ responseEnd: 10, decodedBodySize: 1 }, [
      { name: 'https://app/assets/polyfill.js', decodedBodySize: 4 * 1024, responseEnd: 30 },
      { name: 'https://app/assets/index-abc123.js', decodedBodySize: 1900 * 1024, responseEnd: 500 },
      { name: 'https://app/assets/style.css', decodedBodySize: 9000 * 1024, responseEnd: 999 }
    ])
    const mod = await loadTrace()
    mod.markNetworkTimings()

    const line = await reportedLine(mod)
    // The 1900 KB script, not the 4 KB one that loaded first and not the
    // stylesheet that is larger than either.
    expect(line).toContain('bundle fetched (1900 KB) 500ms')
    expect(line).not.toContain('30ms')
  })

  it('says nothing rather than throwing when the timing API has no entries', async() => {
    stubEntries(null, [])
    const mod = await loadTrace()
    expect(() => mod.markNetworkTimings()).not.toThrow()
    expect(await reportedLine(mod)).toBe('done 9999ms')
  })
})
