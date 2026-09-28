import { spawn } from 'node:child_process'

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`${command} failed${exitCode === null ? '' : ` (exit ${exitCode})`}: ${stderr.trim() || 'no output'}`)
    this.name = 'CommandError'
  }
}

interface RunOptions {
  cwd?: string
  input?: string
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
}

export function run(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      signal: options.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'))
      else reject(new CommandError(`${command} ${args[0] ?? ''}`.trim(), code, Buffer.concat(stderr).toString('utf8')))
    })
    // A command that fails before reading its input closes the pipe; `close` reports the real error.
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.input ?? '')
  })
}
