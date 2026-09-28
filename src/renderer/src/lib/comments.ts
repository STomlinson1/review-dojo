import type { AnnotationSide, DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs'
import { hunkContaining, lineOnSide } from '../../../shared/review'
import type { CodeSelection, DiffFile, DiffSide, DraftComment, Hunk, ReviewThread } from '../../../shared/types'

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

export type DiffAnnotation =
  { kind: 'thread'; thread: ReviewThread } | { kind: 'draft'; draft: DraftComment } | { kind: 'composer' }

/** Lines outside `hunks` are not rendered, so annotations there are left out. Threads come first on a shared line. */
export function diffAnnotations(
  path: string,
  hunks: Hunk[],
  threads: ReviewThread[],
  drafts: DraftComment[],
): DiffLineAnnotation<DiffAnnotation>[] {
  const shown = (side: DiffSide, line: number) => hunkContaining(hunks, side, line) !== undefined
  return [
    ...threads.flatMap((thread) =>
      thread.path === path && thread.line !== null && shown(thread.side, thread.line)
        ? [
            {
              side: toAnnotationSide(thread.side),
              lineNumber: thread.line,
              metadata: { kind: 'thread', thread } as const,
            },
          ]
        : [],
    ),
    ...drafts.flatMap((draft) =>
      draft.path === path && shown(draft.side, draft.line)
        ? [{ side: toAnnotationSide(draft.side), lineNumber: draft.line, metadata: { kind: 'draft', draft } as const }]
        : [],
    ),
  ]
}

/**
 * Maps a line selection to the code a question is about. Unlike a comment it may include expanded
 * unchanged lines. A selection spanning both sides is read on the new side.
 */
export function askSelection(range: SelectedLineRange, file: DiffFile): CodeSelection {
  const startSide = toDiffSide(range.side ?? 'additions')
  const endSide = toDiffSide(range.endSide ?? range.side ?? 'additions')
  const side = startSide === endSide ? endSide : 'RIGHT'
  const start = startSide === side ? range.start : newLineNear(file, range.start)
  const end = endSide === side ? range.end : newLineNear(file, range.end)
  return {
    path: side === 'LEFT' ? (file.oldPath ?? file.path) : file.path,
    side,
    startLine: Math.min(start, end),
    endLine: Math.max(start, end),
  }
}

function newLineNear(file: DiffFile, oldLine: number): number {
  for (const hunk of file.hunks) {
    const index = hunk.lines.findIndex((line) => line.oldLine === oldLine)
    if (index === -1) continue
    const after = hunk.lines.slice(index).find((line) => line.newLine !== null)
    const before = hunk.lines.slice(0, index).findLast((line) => line.newLine !== null)
    return after?.newLine ?? before?.newLine ?? hunk.newStart
  }
  return oldLine
}

export function selectionLabel({ path, side, startLine, endLine }: CodeSelection): string {
  const lines = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`
  return `${path}:${lines}${side === 'LEFT' ? ' (old)' : ''}`
}
