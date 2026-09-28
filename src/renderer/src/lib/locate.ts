import { hunkContaining } from '../../../shared/review'
import { stopForHunk, tourStops } from '../../../shared/tour'
import type { Diff, DiffSide, Stop, Tour } from '../../../shared/types'

export function stopAtLine(tour: Tour, diff: Diff, path: string, side: DiffSide, line: number): Stop | undefined {
  const file = diff.files.find((candidate) => candidate.path === path)
  const hunk = file ? hunkContaining(file.hunks, side, line) : undefined
  return hunk ? stopForHunk(tour, hunk.id) : undefined
}

/** In tour order, so the first stop listing a path is where the reader meets that file first. */
export function changedPathsByStop(tour: Tour, diff: Diff, changedPaths: string[]): Map<string, string[]> {
  const changed = new Set(changedPaths)
  const pathOfHunk = new Map(diff.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, file.path])))
  const byStop = new Map<string, string[]>()
  for (const stop of tourStops(tour)) {
    const paths = new Set(stop.hunkIds.map((id) => pathOfHunk.get(id)).filter((path) => path !== undefined))
    const touched = [...paths].filter((path) => changed.has(path))
    if (touched.length > 0) byStop.set(stop.id, touched)
  }
  return byStop
}
