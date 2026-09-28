import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'

const require = createRequire(import.meta.url)

const DARWIN_TRIPLES: Record<string, string> = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' }

/** Executables cannot be spawned from inside an asar archive; packaging unpacks them alongside it. */
function unpacked(path: string): string {
  return path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
}

export function claudeBinary(): string {
  return unpacked(require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`))
}

export function codexVendorDir(): string {
  const triple = DARWIN_TRIPLES[process.arch]
  if (process.platform !== 'darwin' || !triple) throw new Error('Review Dojo currently supports macOS only.')
  const manifest = require.resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`)
  return unpacked(join(dirname(manifest), 'vendor', triple))
}

export function codexBinary(): string {
  return join(codexVendorDir(), 'bin', 'codex')
}
