import { describe, expect, it } from 'vitest'
import type { StackEntry } from '../shared/types'
import { detectStack } from './stack'

const pr = (number: number, headRefName: string, baseRefName: string): StackEntry => ({
  number,
  title: `PR ${number}`,
  url: '',
  headRefName,
  baseRefName,
})

describe('detectStack', () => {
  it('walks down to the trunk and up through a single child', () => {
    const open = [pr(1, 'a', 'main'), pr(2, 'b', 'a'), pr(3, 'c', 'b'), pr(9, 'x', 'main')]
    const stack = detectStack(open[1], open)
    expect(stack.trunk).toBe('main')
    expect(stack.entries.map((entry) => entry.number)).toEqual([1, 2, 3])
  })

  it('stops climbing at a branch point', () => {
    const open = [pr(1, 'a', 'main'), pr(2, 'b', 'a'), pr(3, 'c', 'a')]
    expect(detectStack(open[0], open).entries.map((entry) => entry.number)).toEqual([1])
  })

  it('terminates on cyclic branch links', () => {
    const open = [pr(1, 'a', 'b'), pr(2, 'b', 'a')]
    expect(detectStack(open[0], open).entries.map((entry) => entry.number)).toEqual([2, 1])
  })
})
