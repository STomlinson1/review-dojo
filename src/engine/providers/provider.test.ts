import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../shared/types'
import { draftStream } from './provider'

afterEach(() => {
  vi.useRealTimers()
})

describe('draftStream', () => {
  it('throttles updates but never loses the final text', () => {
    vi.useFakeTimers()
    const events: AgentEvent[] = []
    const drafts = draftStream((event) => events.push(event))
    drafts.update('a')
    drafts.update('ab')
    drafts.flush()
    drafts.flush()
    expect(events.map((event) => event.text)).toEqual(['a', 'ab'])
  })
})
