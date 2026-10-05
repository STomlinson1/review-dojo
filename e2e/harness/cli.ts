import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import * as diff from '../support/diff'
import * as review from '../support/review'
import { Gh, type GhReply } from './gh'
import { appArgs, appEnv, prepareRun, runPaths } from './launcher'
import { type Turn, startMock } from './mock-api'
import { ARTIFACTS, ELECTRON, MANIFEST } from './paths'
import { buildFixtures, readManifest } from './remotes'
import { pullRequest, signedIn } from './world'

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
  release <run-dir> ['<rest>']  finish held model replies
  gh    <run-dir> <route> '<json>'   set the fake gh reply for a route: {"stdout","stderr","exit","delayMs"}
  state <run-dir>             print what reached the boundaries and what the stand-ins refused
  stop  <run-dir>             quit the app and its stand-ins`

const sessionPath = (dir: string) => join(dir, 'session.json')

function readSession(dir: string): Session {
  if (!existsSync(sessionPath(dir))) throw new Error(`No app is running for ${dir}. Start one with: start ${dir}`)
  return JSON.parse(readFileSync(sessionPath(dir), 'utf8')) as Session
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
  const manifest = existsSync(MANIFEST) ? readManifest(MANIFEST) : buildFixtures(ARTIFACTS)
  const mock = await startMock(runPaths(dir).mockLog)
  const run = prepareRun(dir, mock.url)
  const gh = new Gh(run.ghScript, run.ghLog)
  signedIn(gh)
  pullRequest(gh, manifest.prs.widget)

  const app: ChildProcess = spawn(ELECTRON, [...appArgs(run, mock.url), '--remote-debugging-port=0'], {
    env: appEnv(run, mock.url, manifest.remotes),
    stdio: 'ignore',
  })
  try {
    const portFile = join(run.userData, 'DevToolsActivePort')
    rmSync(portFile, { force: true })
    const cdpPort = await waitFor('the app to open its debugging port', () =>
      existsSync(portFile) ? Number(readFileSync(portFile, 'utf8').split('\n')[0]) : null,
    )

    const server = http.createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        try {
          if (request.url === '/turns') mock.script(...parseTurns(body))
          else if (request.url === '/release') mock.release(body)
        } catch (error) {
          response.writeHead(400).end(error instanceof Error ? error.message : String(error))
          return
        }
        response.end(
          JSON.stringify({ unexpected: mock.unexpected, blocked: mock.blocked, pendingTurns: mock.pending() }),
        )
      })
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const session: Session = {
      hostPid: process.pid,
      appPid: app.pid!,
      cdpPort,
      controlPort: (server.address() as AddressInfo).port,
    }
    writeFileSync(sessionPath(dir), JSON.stringify(session))

    const shutdown = () => {
      rmSync(sessionPath(dir), { force: true })
      app.kill()
      process.exit(0)
    }
    app.on('exit', shutdown)
    process.on('SIGTERM', shutdown)
  } catch (error) {
    app.kill()
    throw error
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function stop(dir: string): void {
  const session = readSession(dir)
  if (isRunning(session.hostPid)) {
    process.kill(session.hostPid, 'SIGTERM')
    return
  }
  // A host that died never removed its session file or stopped its app.
  if (isRunning(session.appPid)) process.kill(session.appPid)
  rmSync(sessionPath(dir))
}

function usage(): never {
  console.error(USAGE)
  process.exit(1)
}

async function start(dir: string): Promise<void> {
  if (existsSync(sessionPath(dir))) {
    if (isRunning(readSession(dir).hostPid)) throw new Error(`An app is already running for ${dir}. Stop it first.`)
    stop(dir)
  }
  const child = spawn(process.execPath, [...process.execArgv, import.meta.filename, 'host', dir], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  const session = await waitFor('the app to start', () => (existsSync(sessionPath(dir)) ? readSession(dir) : null))
  console.log(JSON.stringify({ ...session, runDir: dir }))
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
        openedLinks: existsSync(run.openLog) ? readFileSync(run.openLog, 'utf8').split('\n').filter(Boolean) : [],
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
  else if (command === 'gh')
    new Gh(runPaths(dir).ghScript, runPaths(dir).ghLog).set(rest[0], JSON.parse(rest[1]) as GhReply)
  else if (command === 'state') await state(dir)
  else if (command === 'stop') stop(dir)
  else usage()
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message.split('\n').slice(0, 8).join('\n') : error)
  process.exit(1)
})
