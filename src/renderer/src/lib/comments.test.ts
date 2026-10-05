import { describe, expect, it } from 'vitest'
import type { DiffFile, DraftComment, Hunk, ReviewThread } from '../../../shared/types'
import { selectionForAsk, commentTarget, diffAnnotations } from './comments'

const hunks: Hunk[] = [
  {
    id: 'H1',
    path: 'a.ts',
    header: '@@ -10,3 +10,3 @@',
    oldStart: 10,
    oldLines: 3,
    newStart: 10,
    newLines: 3,
    lines: [
      { kind: 'context', oldLine: 10, newLine: 10, text: 'a' },
      { kind: 'del', oldLine: 11, newLine: null, text: 'b' },
      { kind: 'add', oldLine: null, newLine: 11, text: 'B' },
      { kind: 'context', oldLine: 12, newLine: 12, text: 'c' },
    ],
  },
  {
    id: 'H2',
    path: 'a.ts',
    header: '@@ -40,2 +40,3 @@',
    oldStart: 40,
    oldLines: 2,
    newStart: 40,
    newLines: 3,
    lines: [
      { kind: 'context', oldLine: 40, newLine: 40, text: 'x' },
      { kind: 'add', oldLine: null, newLine: 41, text: 'y' },
      { kind: 'context', oldLine: 41, newLine: 42, text: 'z' },
    ],
  },
]

describe('commentTarget', () => {
  it('maps a deletion-side range within one hunk to LEFT', () => {
    expect(commentTarget({ start: 10, end: 11, side: 'deletions' }, hunks)).toEqual({
      side: 'LEFT',
      startLine: 10,
      line: 11,
      note: null,
    })
  })

  it('orders a range selected bottom-up', () => {
    expect(commentTarget({ start: 42, end: 40, side: 'additions' }, hunks)).toMatchObject({ startLine: 40, line: 42 })
  })

  it('trims a range that starts in an earlier hunk', () => {
    const target = commentTarget({ start: 11, end: 41, side: 'additions' }, hunks)
    expect(target).toMatchObject({ side: 'RIGHT', startLine: 40, line: 41 })
    expect(target).toHaveProperty('note', expect.any(String))
  })

  it('collapses a selection across sides to its last line', () => {
    expect(commentTarget({ start: 11, side: 'deletions', end: 12, endSide: 'additions' }, hunks)).toMatchObject({
      side: 'RIGHT',
      startLine: null,
      line: 12,
    })
  })

  it('rejects lines outside every hunk, such as expanded context', () => {
    expect(commentTarget({ start: 20, end: 20, side: 'additions' }, hunks)).toHaveProperty('error')
  })
})

const file: DiffFile = {
  path: 'b.ts',
  oldPath: 'a.ts',
  status: 'renamed',
  isBinary: false,
  isGenerated: false,
  additions: 2,
  deletions: 1,
  hunks,
}

const thread = (id: string, side: 'LEFT' | 'RIGHT', line: number | null, path = 'b.ts'): ReviewThread => ({
  id,
  path,
  side,
  line,
  startLine: null,
  isResolved: false,
  isOutdated: line === null,
  comments: [],
})

const draft = (id: string, line: number): DraftComment => ({
  id,
  path: 'b.ts',
  side: 'RIGHT',
  startLine: null,
  line,
  body: '',
  stopId: null,
  createdAt: '',
})

describe('diffAnnotations', () => {
  it('places threads and drafts on their side and line, threads first', () => {
    const annotations = diffAnnotations(
      'b.ts',
      hunks,
      [thread('T1', 'RIGHT', 41), thread('T2', 'LEFT', 11)],
      [draft('D1', 41)],
    )
    expect(annotations.map(({ side, lineNumber, metadata }) => [metadata.kind, side, lineNumber])).toEqual([
      ['thread', 'additions', 41],
      ['thread', 'deletions', 11],
      ['draft', 'additions', 41],
    ])
  })

  it('leaves out outdated threads, other files and lines this view does not render', () => {
    const threads = [thread('T1', 'RIGHT', null), thread('T2', 'RIGHT', 41, 'c.ts'), thread('T3', 'RIGHT', 41)]
    expect(diffAnnotations('b.ts', hunks.slice(0, 1), threads, [draft('D1', 41), draft('D2', 12)])).toEqual([
      expect.objectContaining({ lineNumber: 12, metadata: expect.objectContaining({ kind: 'draft' }) }),
    ])
  })
})

describe('selectionForAsk', () => {
  it('orders an old-side selection and keeps the file path for the engine to map', () => {
    expect(selectionForAsk({ start: 12, end: 10, side: 'deletions' }, file)).toEqual({
      path: 'b.ts',
      side: 'LEFT',
      startLine: 10,
      endLine: 12,
    })
  })

  it('keeps expanded unchanged lines that a comment could not target', () => {
    expect(selectionForAsk({ start: 20, end: 25, side: 'additions' }, file)).toMatchObject({
      startLine: 20,
      endLine: 25,
    })
  })

  it('reads a selection across both sides on the new side', () => {
    expect(selectionForAsk({ start: 11, side: 'deletions', end: 42, endSide: 'additions' }, file)).toEqual({
      path: 'b.ts',
      side: 'RIGHT',
      startLine: 11,
      endLine: 42,
    })
  })
})
