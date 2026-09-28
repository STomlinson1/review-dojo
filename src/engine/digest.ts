import { createHash } from 'node:crypto'
import type { Diff } from '../shared/types'

/** Hashes each file's changed content without line numbers, so a rebase alone doesn't count as a change. */
export function fileDigests(diff: Diff): Record<string, string> {
  return Object.fromEntries(
    diff.files.map((file) => {
      const hash = createHash('sha1').update(`${file.status}\0${file.oldPath ?? ''}\0${file.isBinary}`)
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) if (line.kind !== 'context') hash.update(`${line.kind}\0${line.text}\n`)
      }
      return [file.path, hash.digest('hex')]
    }),
  )
}

export function changedPaths(before: Record<string, string>, after: Record<string, string>): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...paths].filter((path) => before[path] !== after[path]).sort()
}
