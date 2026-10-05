import { describe, expect, it } from 'vitest'
import { EMPTY_PROGRESS } from '../../../shared/tour'
import type { DraftComment, ReviewState } from '../../../shared/types'
import { withTourProgressOf, withoutTourProgress } from './progress'

const draft = (id: string, stopId: string | null, body = 'text'): DraftComment => ({
  id,
  path: 'a.ts',
  side: 'RIGHT',
  startLine: null,
  line: 1,
  body,
  stopId,
  createdAt: '',
})

const review: ReviewState = {
  pr: { owner: 'o', repo: 'r', number: 1 },
  headSha: 'abc',
  previous: null,
  fileDigests: {},
  visitedStopIds: ['S1', 'S2'],
  stops: { S1: { ...EMPTY_PROGRESS, understood: true } },
  drafts: [draft('kept', 'S2')],
  chat: [],
  body: '',
  submittedReviewUrl: null,
}

describe('withTourProgressOf', () => {
  it('brings back the earlier progress and keeps edits, but unlinks drafts written against the discarded tour', () => {
    const during = withoutTourProgress(review)
    const edited: ReviewState = {
      ...during,
      visitedStopIds: ['S1'],
      stops: { S3: { ...EMPTY_PROGRESS, understood: true } },
      drafts: [draft('kept', null, 'edited'), draft('added', 'S3')],
    }
    const restored = withTourProgressOf(edited, review)
    expect(restored.visitedStopIds).toEqual(['S1', 'S2'])
    expect(restored.stops).toEqual(review.stops)
    expect(restored.drafts).toEqual([draft('kept', 'S2', 'edited'), draft('added', null)])
  })
})
