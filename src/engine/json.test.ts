import { describe, expect, it } from 'vitest'
import { parseModelJson } from './json'

describe('parseModelJson', () => {
  it('repairs escapes JSON forbids and raw newlines inside strings', () => {
    const text = '{"id": "\\0virtual:module", "pattern": "\\s+\\.ts", "body": "line one\nline two"}'
    expect(parseModelJson(text)).toEqual({ id: '\\0virtual:module', pattern: '\\s+\\.ts', body: 'line one\nline two' })
  })

  it('keeps valid escapes and ignores prose or fences around the object', () => {
    const text = 'Here is the tour:\n```json\n{"quote": "say \\"hi\\"", "path": "a\\\\b", "unicode": "\\u00e9"}\n```'
    expect(parseModelJson(text)).toEqual({ quote: 'say "hi"', path: 'a\\b', unicode: 'é' })
  })
})
