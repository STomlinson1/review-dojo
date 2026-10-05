import { describe, expect, it } from 'vitest'
import { changedPathsByStop, firstHunkInDiff, stopAtLine } from './tour'
import type { Diff, DiffFile, Hunk, Stop, Tour } from './types'

const hunk = (id: string, path: string, newStart: number): Hunk => ({
  id,
  path,
  header: '',
  oldStart: newStart,
  oldLines: 2,
  newStart,
  newLines: 2,
  lines: [
    { kind: 'del', oldLine: newStart, newLine: null, text: 'old' },
    { kind: 'add', oldLine: null, newLine: newStart, text: 'new' },
    { kind: 'context', oldLine: newStart + 1, newLine: newStart + 1, text: 'same' },
  ],
})

const file = (path: string, hunks: Hunk[]): DiffFile => ({
  path,
  oldPath: null,
  status: 'modified',
  isBinary: false,
  isGenerated: false,
  additions: 1,
  deletions: 1,
  hunks,
})

const stop = (id: string, hunkIds: string[]): Stop => ({
  id,
  title: id,
  hunkIds,
  explanation: '',
  risk: 'low',
  riskReason: '',
  checks: [],
  context: [],
  conventions: [],
  question: null,
})

const diff: Diff = {
  mergeBaseSha: '',
  headSha: '',
  files: [file('a.ts', [hunk('H1', 'a.ts', 10), hunk('H2', 'a.ts', 50)]), file('b.ts', [hunk('H3', 'b.ts', 1)])],
}

const tour: Tour = {
  summary: '',
  intent: { stated: [], claims: [], unexplained: [] },
  chapters: [
    { id: 'C1', title: '', goal: '', stops: [stop('S1', ['H3']), stop('S2', ['H2', 'H1'])] },
    { id: 'C2', title: '', goal: '', stops: [stop('S3', [])] },
  ],
}

describe('stopAtLine', () => {
  it('finds the stop owning the hunk that contains the line on the given side', () => {
    expect(stopAtLine(tour, diff, 'a.ts', 'RIGHT', 51)?.id).toBe('S2')
    expect(stopAtLine(tour, diff, 'b.ts', 'LEFT', 1)?.id).toBe('S1')
  })

  it('finds nothing for lines outside the diff or files not in it', () => {
    expect(stopAtLine(tour, diff, 'a.ts', 'RIGHT', 30)).toBeUndefined()
    expect(stopAtLine(tour, diff, 'gone.ts', 'RIGHT', 10)).toBeUndefined()
  })
})

describe('changedPathsByStop', () => {
  it('lists each stop touching a changed path once, in tour order', () => {
    expect([...changedPathsByStop(tour, diff, ['a.ts', 'removed.ts'])]).toEqual([['S2', ['a.ts']]])
    expect([...changedPathsByStop(tour, diff, ['a.ts', 'b.ts']).keys()]).toEqual(['S1', 'S2'])
  })
})

describe('firstHunkInDiff', () => {
  it('follows diff order rather than the order the stop lists its hunks', () => {
    expect(firstHunkInDiff(diff, ['H3', 'H2'])?.id).toBe('H2')
    expect(firstHunkInDiff(diff, [])).toBeUndefined()
  })
})
