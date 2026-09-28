import { describe, expect, it } from 'vitest'
import { tourToMarkdown } from './guide'
import type { Diff, PullRequest, Stop, Tour } from './types'

const pr = { ref: { owner: 'o', repo: 'r', number: 7 }, title: 'Fix things' } as PullRequest

const diff: Diff = {
  mergeBaseSha: 'b',
  headSha: 'h',
  files: [
    {
      path: 'a.ts',
      oldPath: null,
      status: 'modified',
      isBinary: false,
      isGenerated: false,
      additions: 3,
      deletions: 0,
      hunks: [
        { id: 'H1', path: 'a.ts', header: '', oldStart: 10, oldLines: 0, newStart: 10, newLines: 3, lines: [] },
        { id: 'H2', path: 'a.ts', header: '', oldStart: 40, oldLines: 1, newStart: 42, newLines: 0, lines: [] },
      ],
    },
  ],
}

const stop = (overrides: Partial<Stop>): Stop => ({
  id: 'S1',
  title: 'Stop',
  hunkIds: [],
  explanation: 'Explained.',
  risk: 'low',
  riskReason: 'Small.',
  checks: [],
  context: [],
  conventions: [],
  question: null,
  ...overrides,
})

const tour = (stops: Stop[]): Tour => ({
  summary: 'Summary.',
  intent: { stated: [], claims: [], unexplained: [] },
  chapters: [{ id: 'C1', title: 'Core', goal: 'Goal.', stops }],
})

describe('tourToMarkdown', () => {
  it('cites the changed line range of each hunk, including pure deletions', () => {
    const markdown = tourToMarkdown(pr, tour([stop({ hunkIds: ['H1', 'H2'] })]), diff)
    expect(markdown).toContain('Changes: `a.ts:10-12`, `a.ts:42`')
  })

  it('leaves out sections the tour has nothing for', () => {
    const markdown = tourToMarkdown(pr, tour([stop({})]), diff)
    expect(markdown).not.toContain('Intent check')
    expect(markdown).not.toContain('**Verify**')
    expect(markdown).not.toContain('**Read also**')
  })
})
