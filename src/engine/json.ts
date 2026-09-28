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
