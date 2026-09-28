import type { Chapter, Diff, DiffFile, Hunk, Stop, StopProgress, Tour } from './types'

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
