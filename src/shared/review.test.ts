import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDiff } from '../engine/diff'
import { draftProblem } from './review'
import type { Diff, DraftComment } from './types'

const diff: Diff = {
  mergeBaseSha: 'base',
  headSha: 'head',
  files: parseDiff(readFileSync(join(__dirname, '../engine/__fixtures__/mixed.diff'), 'utf8')),
}

const draft = (overrides: Partial<DraftComment>): DraftComment => ({
  id: 'd',
  path: 'a.ts',
  side: 'RIGHT',
  startLine: null,
  line: 2,
  body: 'x',
  stopId: null,
  createdAt: '',
  ...overrides,
})

describe('draftProblem', () => {
  it('accepts added, context and deleted lines on their own side', () => {
    expect(draftProblem(draft({ line: 2 }), diff)).toBeNull()
    expect(draftProblem(draft({ line: 4 }), diff)).toBeNull()
    expect(draftProblem(draft({ side: 'LEFT', line: 10 }), diff)).toBeNull()
  })

  it('rejects lines outside every hunk', () => {
    expect(draftProblem(draft({ line: 13 }), diff)).toMatch(/outside the diff/)
  })

  it('rejects ranges that cross hunks', () => {
    expect(draftProblem(draft({ startLine: 2, line: 8 }), diff)).toMatch(/more than one hunk/)
    expect(draftProblem(draft({ startLine: 1, line: 4 }), diff)).toBeNull()
  })
})
