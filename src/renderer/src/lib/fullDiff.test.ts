import { describe, expect, it } from 'vitest'
import { stopIdsByHunk } from '../../../shared/tour'
import type { Chapter, DiffFile, Hunk, Stop, Tour } from '../../../shared/types'
import { fileSegments, lastStartingAtOrAbove, unchangedLinesBefore } from './fullDiff'

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
    const owners = stopIdsByHunk(tourOf(stop('S1', ['H1', 'H2', 'H4']), stop('S2', ['H3'])))
    expect(fileSegments(file('a.ts', ['H1', 'H2', 'H3', 'H4', 'H5']), owners)).toEqual([
      { stopId: 'S1', start: 0, end: 2 },
      { stopId: 'S2', start: 2, end: 3 },
      { stopId: 'S1', start: 3, end: 4 },
      { stopId: null, start: 4, end: 5 },
    ])
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
