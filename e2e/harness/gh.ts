import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export interface GhReply {
  stdout?: string
  stderr?: string
  exit?: number
  delayMs?: number
}

export interface GhCall {
  route: string | null
  argv: string[]
  stdin: string
  exit: number
  unscripted: boolean
}

export const json = (value: unknown): GhReply => ({ stdout: JSON.stringify(value) })

export const failure = (stderr: string): GhReply => ({ exit: 1, stderr })

export class Gh {
  private readonly script: Record<string, GhReply>

  /** Continues the script already at `scriptPath`, so a second process can add to a running app's replies. */
  constructor(
    readonly scriptPath: string,
    readonly logPath: string,
  ) {
    this.script = existsSync(scriptPath) ? JSON.parse(readFileSync(scriptPath, 'utf8')) : {}
    if (!existsSync(scriptPath)) this.write()
  }

  set(route: string, reply: GhReply): void {
    this.script[route] = reply
    this.write()
  }

  calls(route?: string): GhCall[] {
    if (!existsSync(this.logPath)) return []
    const calls = readFileSync(this.logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as GhCall)
    return route === undefined ? calls : calls.filter((call) => call.route === route)
  }

  unscripted(): GhCall[] {
    return this.calls().filter((call) => call.unscripted)
  }

  /** The fake gh reads this file while the app runs, so it must never see a half-written one. */
  private write(): void {
    const staging = `${this.scriptPath}.${process.pid}.tmp`
    writeFileSync(staging, JSON.stringify(this.script, null, 2))
    renameSync(staging, this.scriptPath)
  }
}
