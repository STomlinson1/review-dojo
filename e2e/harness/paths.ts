import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

export const REPO = resolve(import.meta.dirname, '../..')
export const HARNESS = import.meta.dirname
export const ARTIFACTS = join(REPO, 'e2e/.artifacts')
export const MANIFEST = join(ARTIFACTS, 'manifest.json')
export const ELECTRON: string = createRequire(import.meta.url)('electron')
