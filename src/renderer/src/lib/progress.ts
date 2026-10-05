import type { ReviewState } from '../../../shared/types'

export function withoutTourProgress(review: ReviewState): ReviewState {
  return {
    ...review,
    visitedStopIds: [],
    stops: {},
    chat: review.chat.map((message) => ({ ...message, stopId: null })),
    drafts: review.drafts.map((draft) => ({ ...draft, stopId: null })),
  }
}

/** Messages and drafts written since `before` belong to stops of a discarded tour, so they end up unlinked. */
export function withTourProgressOf(review: ReviewState, before: ReviewState): ReviewState {
  const stopIds = new Map([...before.chat, ...before.drafts].map((item) => [item.id, item.stopId]))
  return {
    ...review,
    visitedStopIds: before.visitedStopIds,
    stops: before.stops,
    chat: review.chat.map((message) => ({ ...message, stopId: stopIds.get(message.id) ?? null })),
    drafts: review.drafts.map((draft) => ({ ...draft, stopId: stopIds.get(draft.id) ?? null })),
  }
}
