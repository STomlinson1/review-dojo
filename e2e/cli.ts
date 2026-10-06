import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { Gh, type GhReply } from './harness/gh'
import { openWorld, openedLinks, runPaths } from './harness/launcher'
import type { Turn } from './harness/mock-api'
import { ELECTRON } from './harness/paths'
import * as diff from './support/diff'
import * as review from './support/review'

interface Session {
  hostPid: number
  appPid: number
  cdpPort: number
  controlPort: number
}

const USAGE = `usage: npm run e2e:app -- <command> <run-dir> [argument]

  start <run-dir>             launch the built app with every stand-in; prints the session
  step  <run-dir> '<js>'      run an async function body with page, expect, diff and review in scope
  turns <run-dir> '<json>'    queue model turns: a JSON array of mock-api Turn objects
  release <run-dir> ['<text>']  finish held model replies, streaming the text first
  gh    <run-dir> <route> '<json>'   set the fake gh reply for a route: {"stdout","stderr","exit","delayMs"}
  state <run-dir>             print what reached the boundaries and what the stand-ins refused
  stop  <run-dir>             quit the app and its stand-ins`

const sessionPath = (dir: string) => join(dir, 'session.json')

function readSession(dir: string): Session {
  if (!existsSync(sessionPath(dir))) throw new Error(`No app is running for ${dir}. Start one with: start ${dir}`)
  return JSON.parse(readFileSync(sessionPath(dir), 'utf8')) as Session
}

/** `start` polls for this file, so it must never see a half-written one. */
function writeSession(dir: string, session: Session): void {
  const staging = join(dir, `session.${process.pid}.tmp`)
  writeFileSync(staging, JSON.stringify(session))
  renameSync(staging, sessionPath(dir))
}

/** Chromium creates the port file before writing it, so an empty or partial read is not a port yet. */
function readPort(portFile: string): number | null {
  if (!existsSync(portFile)) return null
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0])
  return port > 0 ? port : null
}

function isTurn(value: unknown): value is Turn {
  if (typeof value !== 'object' || value === null) return false
  const { provider, expect, text, tool } = value as Record<string, unknown>
  if ((provider !== 'claude' && provider !== 'codex') || typeof expect !== 'string') return false
  if (typeof text === 'string') return true
  const { name, input } = (tool ?? {}) as Record<string, unknown>
  return typeof name === 'string' && typeof input === 'object' && input !== null
}

function parseTurns(body: string): Turn[] {
  const turns: unknown = body ? JSON.parse(body) : undefined
  if (!Array.isArray(turns)) throw new Error(`turns needs a JSON array of Turn objects, got: ${body || 'nothing'}`)
  const bad = turns.findIndex((turn) => !isTurn(turn))
  if (bad !== -1) {
    throw new Error(
      `turns[${bad}] is not a Turn (provider claude|codex, expect, and text or tool {name, input}): ${JSON.stringify(turns[bad])}`,
    )
  }
  return turns as Turn[]
}

async function waitFor<T>(what: string, read: () => T | null | undefined, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== null && value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 50))
  }
}

async function control(dir: string, path: string, body?: string): Promise<string> {
  const { controlPort } = readSession(dir)
  const response = await fetch(
    `http://127.0.0.1:${controlPort}${path}`,
    body === undefined ? {} : { method: 'POST', body },
  )
  if (!response.ok) throw new Error(await response.text())
  return response.text()
}

async function host(dir: string): Promise<void> {
  const { run, mock, args, env } = await openWorld(dir)
  const portFile = join(run.userData, 'DevToolsActivePort')
  rmSync(portFile, { force: true })
  const app: ChildProcess = spawn(ELECTRON, [...args, '--remote-debugging-port=0'], { env, stdio: 'ignore' })
  process.on('exit', () => void app.kill())
  const shutdown = () => {
    rmSync(sessionPath(dir), { force: true })
    process.exit(0)
  }
  app.on('exit', shutdown)
  process.on('SIGTERM', shutdown)

  const cdpPort = await waitFor('the app to open its debugging port', () => readPort(portFile))
  const server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => (body += chunk))
    request.on('end', () => {
      try {
        if (request.url === '/turns') mock.script(...parseTurns(body))
        else if (request.url === '/release') mock.release(body)
      } catch (error) {
        response.writeHead(400).end(error instanceof Error ? error.message : String(error))
        return
      }
      response.end(JSON.stringify({ unexpected: mock.unexpected, blocked: mock.blocked, pendingTurns: mock.pending() }))
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  writeSession(dir, {
    hostPid: process.pid,
    appPid: app.pid!,
    cdpPort,
    controlPort: (server.address() as AddressInfo).port,
  })
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A pid from a stale session file may belong to anything by now. */
function commandOf(pid: number): string {
  if (!isRunning(pid)) return ''
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })
  } catch {
    return ''
  }
}

function isThisRunsApp(pid: number, dir: string): boolean {
  const command = commandOf(pid)
  return command.includes('Electron') && command.includes(runPaths(dir).userData)
}

const isThisRunsHost = (pid: number, dir: string): boolean => commandOf(pid).includes(` host ${dir}`)

function stop(dir: string): void {
  const session = readSession(dir)
  if (isThisRunsHost(session.hostPid, dir)) {
    process.kill(session.hostPid, 'SIGTERM')
    return
  }
  // A host that died never removed its session file or stopped its app.
  if (isThisRunsApp(session.appPid, dir)) process.kill(session.appPid)
  rmSync(sessionPath(dir))
}

function usage(): never {
  console.error(USAGE)
  process.exit(1)
}

async function start(dir: string): Promise<void> {
  if (existsSync(sessionPath(dir))) {
    if (isThisRunsHost(readSession(dir).hostPid, dir)) {
      throw new Error(`An app is already running for ${dir}. Stop it first.`)
    }
    stop(dir)
  }
  const child = spawn(process.execPath, [...process.execArgv, import.meta.filename, 'host', dir], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  try {
    const session = await waitFor('the app to start', () => (existsSync(sessionPath(dir)) ? readSession(dir) : null))
    console.log(JSON.stringify({ ...session, runDir: dir }))
  } catch (error) {
    child.kill()
    throw error
  }
}

async function step(dir: string, body: string): Promise<void> {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${readSession(dir).cdpPort}`)
  try {
    const page = browser.contexts()[0].pages()[0]
    page.setDefaultTimeout(5000)
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
      ...parameters: string[]
    ) => (...values: unknown[]) => Promise<unknown>
    const result = await new AsyncFunction('page', 'expect', 'diff', 'review', body)(page, expect, diff, review)
    if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
  } finally {
    await browser.close()
  }
}

async function state(dir: string): Promise<void> {
  const run = runPaths(dir)
  const gh = new Gh(run.ghScript, run.ghLog)
  console.log(
    JSON.stringify(
      {
        ...(JSON.parse(await control(dir, '/state')) as object),
        ghCalls: gh.calls().map((call) => ({ route: call.route, exit: call.exit, stdin: call.stdin })),
        ghUnscripted: gh.unscripted().map((call) => call.argv.join(' ')),
        openedLinks: openedLinks(run),
      },
      null,
      2,
    ),
  )
}

async function main(): Promise<void> {
  const [command, dirArgument, ...rest] = process.argv.slice(2)
  if (!command || !dirArgument) usage()
  const dir = resolve(dirArgument)
  if (command === 'host') await host(dir)
  else if (command === 'start') await start(dir)
  else if (command === 'step') await step(dir, rest[0] ?? '')
  else if (command === 'turns') console.log(await control(dir, '/turns', rest[0]))
  else if (command === 'release') console.log(await control(dir, '/release', rest[0] ?? ''))
  else if (command === 'gh') {
    const run = runPaths(dir)
    new Gh(run.ghScript, run.ghLog).set(rest[0], JSON.parse(rest[1]) as GhReply)
  } else if (command === 'state') await state(dir)
  else if (command === 'stop') stop(dir)
  else usage()
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message.split('\n').slice(0, 8).join('\n') : error)
  process.exit(1)
})
