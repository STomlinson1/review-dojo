import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs'
import { hunkContaining, lineOnSide } from '../../../shared/review'
import type { DiffSide, DraftComment, Hunk } from '../../../shared/types'

export interface CommentTarget {
  side: DiffSide
  startLine: number | null
  line: number
  /** Explains how the selection was narrowed to something GitHub accepts. */
  note: string | null
}

export const toDiffSide = (side: AnnotationSide): DiffSide => (side === 'deletions' ? 'LEFT' : 'RIGHT')
export const toAnnotationSide = (side: DiffSide): AnnotationSide => (side === 'LEFT' ? 'deletions' : 'additions')

/**
 * Maps a line selection in the diff to a GitHub review comment position. GitHub only accepts
 * ranges inside one hunk and on one side, so wider selections are narrowed to their end line's
 * hunk and side.
 */
export function commentTarget(range: SelectedLineRange, hunks: Hunk[]): CommentTarget | { error: string } {
  const startSide = toDiffSide(range.side ?? 'additions')
  const side = toDiffSide(range.endSide ?? range.side ?? 'additions')
  const crossesSides = startSide !== side
  const line = crossesSides ? range.end : Math.max(range.start, range.end)
  const hunk = hunkContaining(hunks, side, line)
  if (!hunk) return { error: 'Comments can only go on lines that are part of the diff.' }
  if (crossesSides) {
    return {
      side,
      startLine: null,
      line,
      note: 'A comment can cover old or new lines, not both, so it targets the last line.',
    }
  }

  const requested = Math.min(range.start, range.end)
  const sideLines = hunk.lines.map((candidate) => lineOnSide(candidate, side)).filter((value) => value !== null)
  const start = Math.max(requested, Math.min(...sideLines))
  return {
    side,
    startLine: start === line ? null : start,
    line,
    note: start === requested ? null : 'A comment can only span one hunk, so the range was trimmed.',
  }
}

export function lineLabel({ side, startLine, line }: Pick<DraftComment, 'side' | 'startLine' | 'line'>): string {
  const lines = startLine === null ? `Line ${line}` : `Lines ${startLine}–${line}`
  return side === 'LEFT' ? `${lines} (old)` : lines
}
