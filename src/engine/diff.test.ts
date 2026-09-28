import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDiff } from './diff'

const files = parseDiff(readFileSync(join(__dirname, '__fixtures__/mixed.diff'), 'utf8'))
const byPath = (path: string) => {
  const file = files.find((candidate) => candidate.path === path)
  if (!file) throw new Error(`missing ${path}`)
  return file
}

describe('parseDiff', () => {
  it('numbers hunks sequentially across files', () => {
    const ids = files.flatMap((file) => file.hunks.map((hunk) => hunk.id))
    expect(ids).toEqual(ids.map((_, index) => `H${index + 1}`))
  })

  it('tracks old and new line numbers through deletions', () => {
    const [, second, third] = byPath('a.ts').hunks
    const afterDeletion = second.lines.find((line) => line.text === 'line11')
    expect(afterDeletion).toMatchObject({ oldLine: 11, newLine: 10 })
    expect(third.lines.find((line) => line.text === 'line eighteen')).toMatchObject({ kind: 'add', newLine: 17 })
  })

  it('classifies file status, renames, binaries and generated files', () => {
    expect(byPath('new-name.ts')).toMatchObject({ status: 'renamed', oldPath: 'old-name.ts' })
    expect(byPath('removed.txt')).toMatchObject({ status: 'deleted', deletions: 1 })
    expect(byPath('src/added.ts')).toMatchObject({ status: 'added', additions: 3 })
    expect(byPath('img.bin')).toMatchObject({ isBinary: true, hunks: [] })
    expect(byPath('package-lock.json').isGenerated).toBe(true)
  })

  it('decodes paths git quotes because of quotes or control characters', () => {
    expect(byPath('say "hi".md').status).toBe('added')
    expect(byPath('tab\tname.md').additions).toBe(1)
  })

  it('reads paths containing spaces and ignores the no-newline marker', () => {
    expect(byPath('with space.md').additions).toBe(1)
    expect(byPath('nonl.txt').hunks[0].lines.map((line) => line.kind)).toEqual(['del', 'add'])
  })
})
