import { describe, expect, it } from 'vitest'
import { firstProseLine } from './format'

describe('firstProseLine', () => {
  it('describes a comment that is only a suggested change', () => {
    expect(firstProseLine('```suggestion\nconst a = 1\n```')).toBe('Suggested a change.')
  })

  it('treats everything after an unterminated fence as code', () => {
    expect(firstProseLine('```ts\nconst a = 1\n\nstill code')).toBe('Shared a code snippet.')
  })

  it('skips leading blank lines and code to reach the prose', () => {
    expect(firstProseLine('\n\n```ts\nx\n```\n  Why not reuse the helper?\nMore.')).toBe('Why not reuse the helper?')
  })
})
