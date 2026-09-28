import { describe, expect, it } from 'vitest'
import type { Chapter, Diff, DiffFile, Hunk, Stop, Tour } from '../../../shared/types'
import { fileSegments, firstHunkInDiff, lastStartingAtOrAbove, unchangedLinesBefore } from './fullDiff'

const hunk = (id: string, path: string): Hunk => ({
  id,
  path,
  header: '@@ -1 +1 @@',
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  lines: [],
})

const file = (path: string, ids: string[]): DiffFile => ({
  path,
  oldPath: null,
  status: 'modified',
  isBinary: false,
  isGenerated: false,
  additions: 0,
  deletions: 0,
  hunks: ids.map((id) => hunk(id, path)),
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

const tourOf = (...stops: Stop[]): Tour => {
  const chapter: Chapter = { id: 'c1', title: '', goal: '', stops }
  return { summary: '', intent: { stated: [], claims: [], unexplained: [] }, chapters: [chapter] }
}

describe('fileSegments', () => {
  it('groups consecutive hunks by owning stop and splits where ownership changes', () => {
    const tour = tourOf(stop('S1', ['H1', 'H2', 'H4']), stop('S2', ['H3']))
    const segments = fileSegments(file('a.ts', ['H1', 'H2', 'H3', 'H4']), tour)
    expect(segments.map((segment) => [segment.stop?.id, segment.hunks.map((item) => item.id)])).toEqual([
      ['S1', ['H1', 'H2']],
      ['S2', ['H3']],
      ['S1', ['H4']],
    ])
  })

  it('keeps the whole file in one unlabeled segment without a tour', () => {
    const segments = fileSegments(file('a.ts', ['H1', 'H2']), null)
    expect(segments).toHaveLength(1)
    expect(segments[0].stop).toBeNull()
  })
})

describe('unchangedLinesBefore', () => {
  it('counts the new-side lines between a hunk and the one before it', () => {
    const changed = file('a.ts', ['H1', 'H2'])
    Object.assign(changed.hunks[0], { newStart: 26, newLines: 7 })
    Object.assign(changed.hunks[1], { newStart: 34, newLines: 7 })
    expect(unchangedLinesBefore(changed, changed.hunks[0])).toBe(25)
    expect(unchangedLinesBefore(changed, changed.hunks[1])).toBe(1)
  })
})

describe('firstHunkInDiff', () => {
  it('follows diff order rather than the order the stop lists its hunks', () => {
    const diff: Diff = { mergeBaseSha: '', headSha: '', files: [file('a.ts', ['H1', 'H2']), file('b.ts', ['H3'])] }
    expect(firstHunkInDiff(diff, ['H3', 'H2'])).toBe('H2')
    expect(firstHunkInDiff(diff, [])).toBeNull()
  })
})

describe('lastStartingAtOrAbove', () => {
  const tops = [0, 100, 250, 400]
  const find = (y: number) => lastStartingAtOrAbove(tops.length, (index) => tops[index], y)

  it('finds the item spanning a position, including exact boundaries', () => {
    expect(find(-1)).toBe(-1)
    expect(find(0)).toBe(0)
    expect(find(249)).toBe(1)
    expect(find(250)).toBe(2)
    expect(find(9999)).toBe(3)
  })
})
