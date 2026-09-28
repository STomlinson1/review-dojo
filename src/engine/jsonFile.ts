import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Synchronous so a write the main process has accepted is on disk before the app can quit, and so
 * two saves of one file can never interleave on the shared temporary path.
 */
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2))
  renameSync(temporary, path)
}
