import { describe, expect, it } from 'vitest'
import { parseCodeRef } from './codeRefs'

describe('parseCodeRef', () => {
  it('turns path:line references into locations', () => {
    expect(parseCodeRef('src/app.tsx:40')).toEqual({ path: 'src/app.tsx', startLine: 40, endLine: 40 })
    expect(parseCodeRef('src/app.tsx:40-45')).toEqual({ path: 'src/app.tsx', startLine: 40, endLine: 45 })
    expect(parseCodeRef('src/app.tsx:40–45')).toEqual({ path: 'src/app.tsx', startLine: 40, endLine: 45 })
    expect(parseCodeRef('./src/x.ts:3')).toEqual({ path: 'src/x.ts', startLine: 3, endLine: 3 })
  })

  it('leaves ordinary code alone', () => {
    expect(parseCodeRef('foo:1')).toBeNull()
    expect(parseCodeRef('1:2')).toBeNull()
    expect(parseCodeRef('HTTP:200')).toBeNull()
    expect(parseCodeRef('a ? b : c')).toBeNull()
  })
})
