import { describe, expect, it } from 'vitest'
import type { Hunk } from '../../../shared/types'
import { commentTarget } from './comments'

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
