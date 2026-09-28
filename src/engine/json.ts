import { type ZodType, z } from 'zod'

const VALID_ESCAPE = /["\\/bfnrtu]/

/**
 * Parses a JSON object written by a model. Models quoting source code routinely emit escapes JSON
 * does not allow (`\0`, `\s`) and raw newlines inside strings; both are repaired rather than
 * rejected, since the intended text is unambiguous.
 */
export function parseModelJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end < start) throw new SyntaxError('No JSON object in the response.')
  const candidate = text.slice(start, end + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return JSON.parse(repairStrings(candidate))
  }
}

function repairStrings(json: string): string {
  let output = ''
  let inString = false
  for (let index = 0; index < json.length; index += 1) {
    const char = json[index]
    if (!inString) {
      if (char === '"') inString = true
      output += char
      continue
    }
    if (char === '\\') {
      const next = json[index + 1] ?? ''
      output += VALID_ESCAPE.test(next) ? `\\${next}` : `\\\\${next}`
      index += 1
    } else if (char === '"') {
      inString = false
      output += char
    } else if (char === '\n') output += '\\n'
    else if (char === '\r') output += '\\r'
    else if (char === '\t') output += '\\t'
    else output += char
  }
  return output
}

export type Parsed<T> = { success: true; data: T } | { success: false; error: string }

export function parseStructured<T>(text: string, schema: ZodType<T>): Parsed<T> {
  try {
    const result = schema.safeParse(parseModelJson(text))
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: z.prettifyError(result.error) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Cuts a JSON document that is still being written back to its last complete member and closes the
 * open containers, so everything finished so far can be parsed.
 */
export function closeTruncatedJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  const closers: string[] = []
  let inString = false
  let escaped = false
  let cut = -1
  let closersAtCut: string[] = []
  const markCut = (index: number) => {
    cut = index
    closersAtCut = [...closers]
  }
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') {
      closers.push(char === '{' ? '}' : ']')
      markCut(index + 1)
    } else if (char === '}' || char === ']') {
      closers.pop()
      if (closers.length === 0) return text.slice(start, index + 1)
      markCut(index + 1)
    } else if (char === ',') markCut(index)
  }
  return cut === -1 ? null : text.slice(start, cut) + closersAtCut.reverse().join('')
}
