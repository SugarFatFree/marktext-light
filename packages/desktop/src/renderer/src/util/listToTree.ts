// Generic list-to-tree builder driven by the `lvl` property each item carries.
// The classic call-site is the TOC: an ordered list of `{ lvl, content, slug }`
// records becomes a nested hierarchy where each entry's parent is the most
// recently seen entry with a smaller `lvl`.

export interface ListItem {
  lvl: number | null
  content?: unknown
  slug?: unknown
  [key: string]: unknown
}

export interface TreeNode<T extends ListItem = ListItem> {
  parent: TreeNode<T> | null
  lvl: number | null
  label: unknown
  slug: unknown
  githubSlug: unknown
  children: Array<TreeNode<T>>
}

class Node<T extends ListItem> implements TreeNode<T> {
  parent: TreeNode<T> | null
  lvl: number | null
  label: unknown
  slug: unknown
  githubSlug: unknown
  children: Array<TreeNode<T>>

  constructor(item: {
    parent: TreeNode<T> | null
    lvl: number | null
    content?: unknown
    slug?: unknown
    githubSlug?: unknown
  }) {
    const { parent, lvl, content, slug, githubSlug } = item
    this.parent = parent
    this.lvl = lvl
    this.label = content
    this.slug = slug
    // Carried through for the TOC: a content-derived id that, unlike `slug`
    // (a per-render object id), survives a document reload / tab switch (#3791).
    this.githubSlug = githubSlug
    this.children = []
  }

  // Add child node.
  addChild(node: TreeNode<T>): void {
    this.children.push(node)
  }
}

const findParent = <T extends ListItem>(
  item: T,
  lastNode: TreeNode<T> | null,
  rootNode: TreeNode<T>
): TreeNode<T> => {
  if (!lastNode) {
    return rootNode
  }
  const { lvl: lastLvl } = lastNode
  const { lvl } = item

  if (lvl === null || lastLvl === null) {
    return rootNode
  }

  if (lvl < lastLvl) {
    return findParent(item, lastNode.parent, rootNode)
  } else if (lvl === lastLvl) {
    return lastNode.parent ?? rootNode
  } else {
    return lastNode
  }
}

const listToTree = <T extends ListItem>(list: T[]): Array<TreeNode<T>> => {
  const rootNode = new Node<T>({ parent: null, lvl: null, content: null, slug: null })
  let lastNode: TreeNode<T> | null = null

  for (const item of list) {
    const parent: TreeNode<T> = findParent<T>(item, lastNode, rootNode)

    const node: TreeNode<T> = new Node<T>({ parent, ...item })
    ;(parent as Node<T>).addChild(node)
    lastNode = node
  }

  return rootNode.children
}

export default listToTree

export /**
 * Whether two heading lists describe the same table of contents.
 *
 * This runs on every keystroke, against a list with one entry per heading, and
 * it used to be `deep-equal`. In a CPU profile of typing in a 210 KB document,
 * that one call and its type brand-checks (`isMap`, `isWeakSet`,
 * `tryBigIntObject`, …) accounted for more than 40% of the samples — for a
 * comparison of flat objects holding strings and numbers.
 *
 * Entries carry an index signature, so the keys are not fixed and cannot be
 * hardcoded. Values are compared with `Object.is`, which means two structurally
 * equal but distinct objects would read as different. That direction is safe:
 * the only cost of a false "changed" is recomputing the TOC. A false
 * "unchanged" would leave a stale sidebar, and cannot happen here.
 */
const sameHeadings = <T extends ListItem>(next: T[], current: T[]): boolean => {
  if (next === current) return true
  if (next.length !== current.length) return false

  for (let i = 0; i < next.length; i++) {
    const a = next[i] as Record<string, unknown>
    const b = current[i] as Record<string, unknown>
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    for (const key of keys) {
      if (!Object.is(a[key], b[key])) return false
    }
  }

  return true
}
