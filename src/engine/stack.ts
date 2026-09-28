import type { Stack, StackEntry } from '../shared/types'

/** A branch point (several PRs based on one head) ends the upward walk, keeping the stack linear. */
export function detectStack(current: StackEntry, openPrs: StackEntry[]): Stack {
  const byHead = new Map(openPrs.map((pr) => [pr.headRefName, pr]))
  const seen = new Set([current.number])

  const below: StackEntry[] = []
  let base = current.baseRefName
  for (let parent = byHead.get(base); parent && !seen.has(parent.number); parent = byHead.get(base)) {
    seen.add(parent.number)
    below.unshift(parent)
    base = parent.baseRefName
  }

  const above: StackEntry[] = []
  let head = current.headRefName
  for (;;) {
    const children = openPrs.filter((pr) => pr.baseRefName === head && !seen.has(pr.number))
    if (children.length !== 1) break
    const [child] = children
    seen.add(child.number)
    above.push(child)
    head = child.headRefName
  }

  return { trunk: base, entries: [...below, current, ...above] }
}
