import { hunkContaining } from './review'
import type { Chapter, Diff, DiffFile, DiffSide, Hunk, Stop, StopProgress, Tour } from './types'

export const EMPTY_PROGRESS: StopProgress = {
  understood: false,
  prediction: '',
  revealed: false,
  predictionFeedback: null,
  checksDone: [],
}

export function tourStops(tour: Tour): Stop[] {
  return tour.chapters.flatMap((chapter) => chapter.stops)
}

export function findStop(tour: Tour, stopId: string): { stop: Stop; chapter: Chapter } | null {
  for (const chapter of tour.chapters) {
    const stop = chapter.stops.find((candidate) => candidate.id === stopId)
    if (stop) return { stop, chapter }
  }
  return null
}

export function stopForHunk(tour: Tour, hunkId: string): Stop | undefined {
  return tourStops(tour).find((stop) => stop.hunkIds.includes(hunkId))
}

export function findHunk(diff: Diff, hunkId: string): Hunk | undefined {
  for (const file of diff.files) {
    const hunk = file.hunks.find((candidate) => candidate.id === hunkId)
    if (hunk) return hunk
  }
  return undefined
}

export function selectHunks(diff: Diff, keep: (hunk: Hunk) => boolean): { file: DiffFile; hunks: Hunk[] }[] {
  return diff.files.map((file) => ({ file, hunks: file.hunks.filter(keep) })).filter((entry) => entry.hunks.length > 0)
}

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

export function firstHunkInDiff(diff: Diff, hunkIds: string[]): Hunk | undefined {
  const wanted = new Set(hunkIds)
  return selectHunks(diff, (hunk) => wanted.has(hunk.id))[0]?.hunks[0]
}

export function stopIdsByHunk(tour: Tour): Map<string, string> {
  const owners = new Map<string, string>()
  for (const stop of tourStops(tour)) {
    for (const hunkId of stop.hunkIds) if (!owners.has(hunkId)) owners.set(hunkId, stop.id)
  }
  return owners
}
