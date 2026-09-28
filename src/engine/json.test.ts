import { describe, expect, it } from 'vitest'
import { closeTruncatedJson, parseModelJson } from './json'

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

describe('closeTruncatedJson', () => {
  const close = (text: string) => JSON.parse(closeTruncatedJson(text) ?? 'null') as unknown

  it('keeps only members that were completely written', () => {
    expect(close('{"summary": "done", "chapters": [{"title": "One", "stops": [1, 2')).toEqual({
      summary: 'done',
      chapters: [{ title: 'One', stops: [1] }],
    })
    expect(close('{"a": {"b": "unfinished str')).toEqual({ a: {} })
  })

  it('ignores structural characters and escaped quotes inside strings', () => {
    expect(close('{"text": "a, b } ] ok", "next": [')).toEqual({ text: 'a, b } ] ok', next: [] })
    expect(close('{"text": "say \\"hi\\", ok", "next": [')).toEqual({ text: 'say "hi", ok', next: [] })
  })

  it('returns a finished document unchanged and nothing before the object starts', () => {
    expect(closeTruncatedJson('Here you go: {"a": 1} trailing')).toBe('{"a": 1}')
    expect(closeTruncatedJson('Still exploring')).toBeNull()
  })
})
