import type { DiffFile, Hunk } from '../../../shared/types'

/** Consecutive hunks of a file explained by the same stop; `end` is exclusive. */
export interface Segment {
  stopId: string | null
  start: number
  end: number
}

export function fileSegments(file: DiffFile, stopIdsByHunk: ReadonlyMap<string, string>): Segment[] {
  const segments: Segment[] = []
  file.hunks.forEach((hunk, index) => {
    const stopId = stopIdsByHunk.get(hunk.id) ?? null
    const last = segments.at(-1)
    if (last && last.stopId === stopId) last.end = index + 1
    else segments.push({ stopId, start: index, end: index + 1 })
  })
  return segments
}

export function unchangedLinesBefore(file: DiffFile, hunk: Hunk): number {
  const previous = file.hunks[file.hunks.indexOf(hunk) - 1]
  const firstUnseen = previous ? previous.newStart + previous.newLines : 1
  return Math.max(0, hunk.newStart - firstUnseen)
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
