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

test("stop leaves a process alone when a stale session names a pid that is not this run's app", async ({}, testInfo) => {
  const dir = testInfo.outputPath('run')
  mkdirSync(dir, { recursive: true })
  const deadHost = spawnSync('true').pid
  const bystander = spawn('sleep', ['60'])
  try {
    writeFileSync(
      join(dir, 'session.json'),
      JSON.stringify({ hostPid: deadHost, appPid: bystander.pid, cdpPort: 1, controlPort: 1 }),
    )

    expect(cli('stop', dir).status).toBe(0)

    expect(processState(bystander.pid!)).toMatch(/^S/)
    expect(existsSync(join(dir, 'session.json'))).toBe(false)
  } finally {
    bystander.kill()
  }
})

test('the usage text lists every command', () => {
  const result = cli()
  expect(result.status).toBe(1)
  for (const command of ['start', 'step', 'turns', 'release', 'gh', 'state', 'stop']) {
    expect(result.stderr).toMatch(new RegExp(`^  ${command} +<run-dir>`, 'm'))
  }
})
