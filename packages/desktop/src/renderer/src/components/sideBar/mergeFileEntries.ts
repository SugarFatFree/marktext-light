import type { FileEntry, TabDescriptor } from './types'

interface RecentEntry {
  pathname: string
  filename: string
}

/**
 * The drawer's single file list: everything opened recently, with the ones
 * still open marked.
 *
 * Order is the recent list's, which is by recency, and every saved file that
 * opens is recorded there — so open files sit near the top on their own,
 * without regrouping them into the section this replaces.
 *
 * Rows come first for open documents the recent list does not account for.
 * That covers two cases, and the second is the one worth stating: untitled
 * documents have no path to record, and anything still open after "clear
 * recent" has just lost its entry. Without this the drawer would empty itself
 * while documents sat open in it.
 *
 * @param includeOpen mirrors the "show opened files" preference. Off, the list
 * is the recent files alone — no marks, no rows for open documents.
 */
export const mergeFileEntries = (
  tabs: TabDescriptor[],
  recent: RecentEntry[],
  includeOpen: boolean
): FileEntry[] => {
  const openTabs = includeOpen ? tabs : []
  const byPath = new Map<string, TabDescriptor>()
  for (const tab of openTabs) {
    if (tab.pathname) byPath.set(tab.pathname, tab)
  }

  const listed = recent.map((file) => ({
    key: file.pathname,
    filename: file.filename,
    pathname: file.pathname,
    tab: byPath.get(file.pathname) ?? null
  }))

  const known = new Set(listed.map((entry) => entry.pathname))
  const unlisted = openTabs
    .filter((tab) => !tab.pathname || !known.has(tab.pathname))
    .map((tab) => ({
      key: tab.id,
      filename: tab.filename,
      pathname: tab.pathname ?? '',
      tab
    }))

  return [...unlisted, ...listed]
}
