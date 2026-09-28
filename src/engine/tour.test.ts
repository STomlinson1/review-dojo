import { describe, expect, it } from 'vitest'
import type { Diff, DiffFile } from '../shared/types'
import { normalizeTour, type RawTour } from './tour'

function file(path: string, hunkIds: string[], isGenerated = false): DiffFile {
  return {
    path,
    oldPath: null,
    status: 'modified',
    isBinary: false,
    isGenerated,
    additions: 1,
    deletions: 0,
    hunks: hunkIds.map((id) => ({
      id,
      path,
      header: '@@ -1 +1 @@',
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [],
    })),
  }
}

const diff: Diff = {
  mergeBaseSha: 'base',
  headSha: 'head',
  files: [file('src/a.ts', ['H1', 'H2']), file('src/b.ts', ['H3']), file('pnpm-lock.yaml', ['H4'], true)],
}

function stop(hunkIds: string[], title = 'stop'): RawTour['chapters'][number]['stops'][number] {
  return {
    title,
    hunkIds,
    explanation: '',
    risk: 'low',
    riskReason: '',
    checks: [],
    context: [],
    conventions: [],
    question: null,
  }
}

function raw(stops: RawTour['chapters'][number]['stops']): RawTour {
  return {
    summary: '',
    intent: { stated: [], claims: [], unexplained: [{ description: 'x', hunkIds: ['H3', 'H99'] }] },
    chapters: [{ title: 'Core', goal: '', stops }],
  }
}

const allHunkIds = (tour: ReturnType<typeof normalizeTour>) =>
  tour.chapters.flatMap((chapter) => chapter.stops.flatMap((entry) => entry.hunkIds))

describe('normalizeTour', () => {
  it('places every hunk in exactly one stop even when the agent forgets or repeats hunks', () => {
    const tour = normalizeTour(raw([stop(['H1', 'H99']), stop(['H1'], 'duplicate')]), diff)
    expect(allHunkIds(tour).sort()).toEqual(['H1', 'H2', 'H3', 'H4'])
    expect(tour.chapters.map((chapter) => chapter.title)).toEqual([
      'Core',
      'Not covered by the tour',
      'Generated files and lockfiles',
    ])
  })

  it('keeps hunk-less stops only when they point at context', () => {
    const conceptual = {
      ...stop([], 'conceptual'),
      context: [{ path: 'src/c.ts', startLine: 0, endLine: -4, why: '' }],
    }
    const tour = normalizeTour(raw([stop(['H1', 'H2', 'H3']), conceptual, stop([], 'empty')]), diff)
    const titles = tour.chapters[0].stops.map((entry) => entry.title)
    expect(titles).toEqual(['stop', 'conceptual'])
    expect(tour.chapters[0].stops[1].context[0]).toMatchObject({ startLine: 1, endLine: 1 })
  })

  it('assigns unique stop ids and drops unknown ids from unexplained changes', () => {
    const tour = normalizeTour(raw([stop(['H1']), stop(['H2'])]), diff)
    const ids = tour.chapters.flatMap((chapter) => chapter.stops.map((entry) => entry.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(tour.intent.unexplained[0].hunkIds).toEqual(['H3'])
  })
})
