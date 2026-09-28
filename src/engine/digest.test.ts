import { describe, expect, it } from 'vitest'
import type { Diff, DiffFile, DiffLine } from '../shared/types'
import { changedPaths, fileDigests } from './digest'

function file(path: string, start: number, lines: DiffLine[]): DiffFile {
  return {
    path,
    oldPath: null,
    status: 'modified',
    isBinary: false,
    isGenerated: false,
    additions: 0,
    deletions: 0,
    hunks: [{ id: 'H1', path, header: '', oldStart: start, oldLines: 0, newStart: start, newLines: 0, lines }],
  }
}

const diff = (...files: DiffFile[]): Diff => ({ mergeBaseSha: 'b', headSha: 'h', files })
const add = (text: string, newLine: number): DiffLine => ({ kind: 'add', oldLine: null, newLine, text })
const context = (text: string, line: number): DiffLine => ({ kind: 'context', oldLine: line, newLine: line, text })

describe('changed files since the last review', () => {
  it('ignores line shifts from a rebase but catches edited, added and dropped files', () => {
    const before = fileDigests(diff(file('a.ts', 10, [context('x', 10), add('y', 11)]), file('b.ts', 1, [add('z', 1)])))
    const after = fileDigests(
      diff(file('a.ts', 40, [context('moved', 40), add('y', 41)]), file('c.ts', 1, [add('new', 1)])),
    )
    expect(changedPaths(before, after)).toEqual(['b.ts', 'c.ts'])
    expect(changedPaths(before, fileDigests(diff(file('a.ts', 10, [add('edited', 11)]))))).toContain('a.ts')
  })
})
