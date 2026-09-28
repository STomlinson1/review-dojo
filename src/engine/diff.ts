import type { DiffFile, DiffLine, Hunk } from '../shared/types'

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

const GENERATED_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'npm-shrinkwrap.json',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'composer.lock',
  'go.sum',
])

const GENERATED_PATTERNS = [
  /(^|\/)(dist|build|out|coverage|__generated__|generated)\//,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.snap$/,
  /\.generated\.\w+$/,
]

function isGeneratedPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return GENERATED_NAMES.has(name) || GENERATED_PATTERNS.some((pattern) => pattern.test(path))
}

/**
 * Parses `git diff` output produced with `core.quotePath=false`, `--no-color`, and default
 * `a/` `b/` prefixes. Hunk ids are assigned sequentially across files.
 */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: Hunk | null = null
  let oldLine = 0
  let newLine = 0
  let hunkCount = 0

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = startFile(line)
      files.push(file)
      hunk = null
      continue
    }
    if (!file) continue

    const header = HUNK_HEADER.exec(line)
    if (header) {
      hunkCount += 1
      oldLine = Number(header[1])
      newLine = Number(header[3])
      hunk = {
        id: `H${hunkCount}`,
        path: file.path,
        header: line,
        oldStart: oldLine,
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: newLine,
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      }
      file.hunks.push(hunk)
      continue
    }

    if (hunk) {
      const entry = parseBodyLine(line, oldLine, newLine)
      if (entry) {
        hunk.lines.push(entry)
        if (entry.kind !== 'add') oldLine += 1
        if (entry.kind !== 'del') newLine += 1
        if (entry.kind === 'add') file.additions += 1
        if (entry.kind === 'del') file.deletions += 1
      }
      continue
    }

    applyHeaderLine(file, line)
  }

  for (const parsed of files) parsed.isGenerated = isGeneratedPath(parsed.path)
  return files
}

function parseBodyLine(line: string, oldLine: number, newLine: number): DiffLine | null {
  switch (line[0]) {
    case ' ':
      return { kind: 'context', oldLine, newLine, text: line.slice(1) }
    case '+':
      return { kind: 'add', oldLine: null, newLine, text: line.slice(1) }
    case '-':
      return { kind: 'del', oldLine, newLine: null, text: line.slice(1) }
    default:
      return null
  }
}

function startFile(line: string): DiffFile {
  const path = pathFromGitHeader(line.slice('diff --git '.length))
  return {
    path,
    oldPath: null,
    status: 'modified',
    isBinary: false,
    isGenerated: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  }
}

function applyHeaderLine(file: DiffFile, line: string): void {
  if (line.startsWith('new file mode')) file.status = 'added'
  else if (line.startsWith('deleted file mode')) file.status = 'deleted'
  else if (line.startsWith('rename from ')) {
    file.status = 'renamed'
    file.oldPath = unquote(line.slice('rename from '.length))
  } else if (line.startsWith('rename to ')) file.path = unquote(line.slice('rename to '.length))
  else if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.isBinary = true
  else if (line.startsWith('+++ ')) {
    const target = stripPatchPath(line.slice(4), 'b/')
    if (target) file.path = target
  } else if (line.startsWith('--- ') && file.status === 'deleted') {
    const source = stripPatchPath(line.slice(4), 'a/')
    if (source) file.path = source
  }
}

function stripPatchPath(raw: string, prefix: string): string | null {
  const value = unquote(raw.replace(/\t$/, ''))
  if (value === '/dev/null') return null
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

/** `a/<p> b/<p>` is ambiguous when paths contain spaces; it is only authoritative when both sides match. */
function pathFromGitHeader(rest: string): string {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest)
    return unquote(rest.slice(0, end + 1)).replace(/^a\//, '')
  }
  const half = (rest.length - 5) / 2
  if (Number.isInteger(half) && rest.startsWith('a/') && rest.slice(half + 2, half + 5) === ' b/') {
    return rest.slice(2, half + 2)
  }
  return rest.slice(2, rest.indexOf(' b/'))
}

function closingQuote(value: string): number {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === '\\') index += 1
    else if (value[index] === '"') return index
  }
  return value.length - 1
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\' }

function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value
  const bytes: number[] = []
  const body = value.slice(1, -1)
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char !== '\\') {
      bytes.push(...Buffer.from(char))
      continue
    }
    const next = body[index + 1]
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(index + 1, index + 4), 8))
      index += 3
    } else {
      bytes.push(...Buffer.from(ESCAPES[next] ?? next))
      index += 1
    }
  }
  return Buffer.from(bytes).toString('utf8')
}
