import { type SpawnSyncReturns, execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { REPO } from '../harness/paths'

const cli = (...args: string[]): SpawnSyncReturns<string> =>
  spawnSync('npm', ['run', '--silent', 'e2e:app', '--', ...args], { cwd: REPO, encoding: 'utf8' })

/** A signalled child stays a zombie that `kill -0` accepts until it is reaped, so `ps` says whether it died. */
const processState = (pid: number): string =>
  execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })

const gone = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

async function stopAndWait(dir: string, pids: number[]): Promise<void> {
  if (!existsSync(`${dir}/session.json`)) return
  expect(cli('stop', dir).status).toBe(0)
  await expect.poll(() => pids.every(gone)).toBe(true)
}

const BAD_TURNS: [string[], string][] = [
  [[], 'got: nothing'],
  [['[{"provider":"claude"'], 'JSON'],
  [['{"provider":"claude","expect":"x","text":"y"}'], 'needs a JSON array'],
  [['[null]'], 'turns[0]'],
  [['[{"provider":"claude","expect":"x","text":"y"},{"provider":"claude","expect":"x"}]'], 'turns[1]'],
]

test('malformed turns are refused with a message while the app stays up', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const dir = testInfo.outputPath('run')
  const started = cli('start', dir)
  expect(started.stderr).toBe('')
  const session = JSON.parse(started.stdout) as { hostPid: number; appPid: number }
  try {
    for (const [args, message] of BAD_TURNS) {
      const result = cli('turns', dir, ...args)
      expect(result.status, `turns ${JSON.stringify(args)} exit`).toBe(1)
      expect(result.stderr, `turns ${JSON.stringify(args)} message`).toContain(message)
    }
    const state = cli('state', dir)
    expect(state.stderr).toBe('')
    expect(JSON.parse(state.stdout)).toMatchObject({ unexpected: [], ghUnscripted: [], pendingTurns: 0 })
  } finally {
    await stopAndWait(dir, [session.hostPid, session.appPid])
  }
  expect(existsSync(`${dir}/session.json`)).toBe(false)
})

/** A session file whose pids now belong to unrelated live processes, as after a crash and pid reuse. */
function writeStaleSession(dir: string, hostPid: number, appPid: number): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({ hostPid, appPid, cdpPort: 1, controlPort: 1 }))
}

test("stop leaves processes alone when a stale session names pids that are not this run's host or app", async ({}, testInfo) => {
  const dir = testInfo.outputPath('run')
  const host = spawn('sleep', ['60'])
  const app = spawn('sleep', ['60'])
  try {
    writeStaleSession(dir, host.pid!, app.pid!)

    expect(cli('stop', dir).status).toBe(0)

    expect(processState(host.pid!)).toMatch(/^S/)
    expect(processState(app.pid!)).toMatch(/^S/)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
  } finally {
    host.kill()
    app.kill()
  }
})

test("start replaces a stale session whose host pid is alive but is not this run's host", async ({}, testInfo) => {
  test.setTimeout(60_000)
  const dir = testInfo.outputPath('run')
  const bystander = spawn('sleep', ['60'])
  let session = { hostPid: 0, appPid: 0 }
  try {
    writeStaleSession(dir, bystander.pid!, bystander.pid!)

    const started = cli('start', dir)

    expect(started.stderr).toBe('')
    session = JSON.parse(started.stdout) as typeof session
    expect(session.hostPid).not.toBe(bystander.pid)
    expect(processState(bystander.pid!)).toMatch(/^S/)
  } finally {
    bystander.kill()
    await stopAndWait(dir, [session.hostPid, session.appPid].filter(Boolean))
  }
})

test('the usage text lists every command', () => {
  const result = cli()
  expect(result.status).toBe(1)
  for (const command of ['start', 'step', 'turns', 'release', 'gh', 'state', 'stop']) {
    expect(result.stderr).toMatch(new RegExp(`^  ${command} +<run-dir>`, 'm'))
  }
})
