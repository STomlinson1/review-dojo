import { getSingularPatch } from '@pierre/diffs'
import { describe, expect, it } from 'vitest'
import type { DiffFile, Hunk } from '../../../shared/types'
import { synthesizePatch } from './patch'

function hunk(id: string, path: string, oldStart: number, newStart: number, body: string[]): Hunk {
  const lines = body.map(
    (raw) => ({ kind: raw[0] === '+' ? 'add' : raw[0] === '-' ? 'del' : 'context', text: raw.slice(1) }) as const,
  )
  const oldLines = lines.filter((line) => line.kind !== 'add').length
  const newLines = lines.filter((line) => line.kind !== 'del').length
  let oldLine = oldStart
  let newLine = newStart
  return {
    id,
    path,
    header: `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`,
    oldStart,
    oldLines,
    newStart,
    newLines,
    lines: lines.map((line) => ({
      ...line,
      oldLine: line.kind === 'add' ? null : oldLine++,
      newLine: line.kind === 'del' ? null : newLine++,
    })),
  }
}

function file(overrides: Partial<DiffFile> & Pick<DiffFile, 'path' | 'hunks'>): DiffFile {
  return {
    oldPath: null,
    status: 'modified',
    isBinary: false,
    isGenerated: false,
    additions: 0,
    deletions: 0,
    ...overrides,
  }
}

describe('synthesizePatch', () => {
  it('keeps original line numbers when only a later hunk is selected', () => {
    const first = hunk('H1', 'src/a.ts', 1, 1, [' a', '-b', '+B'])
    const second = hunk('H2', 'src/a.ts', 40, 40, [' x', '+y', '+z', ' w'])
    const parsed = getSingularPatch(synthesizePatch(file({ path: 'src/a.ts', hunks: [first, second] }), [second]))

    expect(parsed.name).toBe('src/a.ts')
    expect(parsed.type).toBe('change')
    expect(parsed.hunks).toHaveLength(1)
    expect(parsed.hunks[0]).toMatchObject({ additionStart: 40, deletionStart: 40, additionLines: 2, deletionLines: 0 })
  })

  it('marks added and deleted files so the missing side is empty', () => {
    const added = file({
      path: 'new file.ts',
      status: 'added',
      hunks: [hunk('H1', 'new file.ts', 0, 1, ['+one', '+two'])],
    })
    const deleted = file({ path: 'gone.ts', status: 'deleted', hunks: [hunk('H2', 'gone.ts', 1, 0, ['-one'])] })

    expect(getSingularPatch(synthesizePatch(added, added.hunks))).toMatchObject({ name: 'new file.ts', type: 'new' })
    expect(getSingularPatch(synthesizePatch(deleted, deleted.hunks))).toMatchObject({
      name: 'gone.ts',
      type: 'deleted',
    })
  })

  it('carries both names for a renamed file', () => {
    const renamed = file({
      path: 'lib/new.ts',
      oldPath: 'lib/old.ts',
      status: 'renamed',
      hunks: [hunk('H1', 'lib/new.ts', 3, 3, [' a', '-b', '+c'])],
    })
    expect(getSingularPatch(synthesizePatch(renamed, renamed.hunks))).toMatchObject({
      name: 'lib/new.ts',
      prevName: 'lib/old.ts',
      type: 'rename-changed',
    })
  })
})
