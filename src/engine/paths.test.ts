import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveInside } from './paths'

let root = ''
let outside = ''

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'docent-paths-'))
  root = join(base, 'repo')
  outside = join(base, 'secret.txt')
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src/a.ts'), '')
  await writeFile(outside, 'secret')
  await symlink(outside, join(root, 'notes.md'))
})

describe('resolveInside', () => {
  it('allows files inside the root', async () => {
    expect(await resolveInside(root, 'src/a.ts')).toMatch(/src\/a\.ts$/)
  })

  it('rejects traversal, absolute paths, and symlinks that escape the root', async () => {
    expect(await resolveInside(root, '../secret.txt')).toBeNull()
    expect(await resolveInside(root, outside)).toBeNull()
    expect(await resolveInside(root, 'notes.md')).toBeNull()
  })
})
