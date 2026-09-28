import type { Diff, DiffLine, DiffSide, DraftComment, Hunk } from './types'

export function lineOnSide(line: DiffLine, side: DiffSide): number | null {
  return side === 'RIGHT' ? line.newLine : line.oldLine
}

export function hunkContaining(hunks: Hunk[], side: DiffSide, lineNumber: number): Hunk | undefined {
  return hunks.find((hunk) => hunk.lines.some((line) => lineOnSide(line, side) === lineNumber))
}

/** GitHub rejects a whole review if any comment targets a line outside the diff, so drafts are checked locally first. */
export function draftProblem(draft: DraftComment, diff: Diff): string | null {
  const file = diff.files.find((candidate) => candidate.path === draft.path)
  if (!file) return `${draft.path} is not part of this diff.`
  const hunk = hunkContaining(file.hunks, draft.side, draft.line)
  if (!hunk) return `${draft.path}:${draft.line} is outside the diff.`
  if (draft.startLine === null) return null
  if (draft.startLine >= draft.line) return `${draft.path}: a range must start before it ends.`
  if (!hunk.lines.some((line) => lineOnSide(line, draft.side) === draft.startLine)) {
    return `${draft.path}:${draft.startLine}-${draft.line} spans more than one hunk.`
  }
  return null
}
