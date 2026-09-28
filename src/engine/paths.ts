import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

/** Resolves symlinks first, since a PR can add a link that points anywhere on the reviewer's disk. */
export async function resolveInside(root: string, path: string): Promise<string | null> {
  try {
    const [realRoot, target] = await Promise.all([realpath(root), realpath(resolve(root, path))])
    const inside = relative(realRoot, target)
    return inside === '' || inside.startsWith('..') || isAbsolute(inside) ? null : target
  } catch {
    return null
  }
}
