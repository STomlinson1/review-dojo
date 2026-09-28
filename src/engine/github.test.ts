import { describe, expect, it } from 'vitest'
import { parsePrRef } from './github'

describe('parsePrRef', () => {
  it('accepts PR URLs with trailing path segments and shorthand with dotted, hyphenated names', () => {
    const expected = { owner: 'vitejs', repo: 'vite', number: 23596 }
    expect(parsePrRef('https://github.com/vitejs/vite/pull/23596/files?diff=split')).toEqual(expected)
    expect(parsePrRef('  vitejs/vite#23596 ')).toEqual(expected)
    expect(parsePrRef('my-org/web.app#7')).toEqual({ owner: 'my-org', repo: 'web.app', number: 7 })
  })

  it('rejects anything that is not a pull request', () => {
    expect(() => parsePrRef('https://github.com/vitejs/vite/issues/1')).toThrow()
    expect(() => parsePrRef('vitejs/vite')).toThrow()
  })
})
