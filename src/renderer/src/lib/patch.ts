import type { DiffFile, DiffLine, Hunk } from '../../../shared/types'

const LINE_PREFIX: Record<DiffLine['kind'], string> = { context: ' ', add: '+', del: '-' }

/** Builds a git-style single-file patch containing only `hunks`, which must belong to `file`. */
export function synthesizePatch(file: DiffFile, hunks: Hunk[]): string {
  const oldPath = file.oldPath ?? file.path
  const header = [`diff --git a/${oldPath} b/${file.path}`]
  if (file.status === 'added') header.push('new file mode 100644')
  if (file.status === 'deleted') header.push('deleted file mode 100644')
  if (file.status === 'renamed') {
    // Pierre only treats a git patch as a rename when a similarity line is present, and reads it
    // solely as "100%" (pure) versus anything else; the real percentage is not known here.
    const similarity = hunks.length > 0 ? 50 : 100
    header.push(`similarity index ${similarity}%`, `rename from ${oldPath}`, `rename to ${file.path}`)
  }
  header.push(file.status === 'added' ? '--- /dev/null' : `--- a/${oldPath}`)
  header.push(file.status === 'deleted' ? '+++ /dev/null' : `+++ b/${file.path}`)
  const body = hunks.flatMap((hunk) => [hunk.header, ...hunk.lines.map((line) => LINE_PREFIX[line.kind] + line.text)])
  return `${[...header, ...body].join('\n')}\n`
}
