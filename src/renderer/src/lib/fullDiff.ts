import { selectHunks, stopForHunk } from '../../../shared/tour'
import type { Diff, DiffFile, Hunk, Stop, Tour } from '../../../shared/types'

export interface Segment {
  stop: Stop | null
  hunks: Hunk[]
}

export function fileSegments(file: DiffFile, tour: Tour | null): Segment[] {
  const segments: Segment[] = []
  for (const hunk of file.hunks) {
    const stop = (tour && stopForHunk(tour, hunk.id)) ?? null
    const last = segments.at(-1)
    if (last && last.stop === stop) last.hunks.push(hunk)
    else segments.push({ stop, hunks: [hunk] })
  }
  return segments
}

export function unchangedLinesBefore(file: DiffFile, hunk: Hunk): number {
  const previous = file.hunks[file.hunks.indexOf(hunk) - 1]
  const firstUnseen = previous ? previous.newStart + previous.newLines : 1
  return Math.max(0, hunk.newStart - firstUnseen)
}

export function firstHunkInDiff(diff: Diff, hunkIds: string[]): string | null {
  const wanted = new Set(hunkIds)
  return selectHunks(diff, (hunk) => wanted.has(hunk.id))[0]?.hunks[0].id ?? null
}

/** `topOf` must not decrease with the index, as for elements laid out top to bottom. */
export function lastStartingAtOrAbove(count: number, topOf: (index: number) => number, y: number): number {
  let low = 0
  let high = count - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (topOf(middle) <= y) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}
