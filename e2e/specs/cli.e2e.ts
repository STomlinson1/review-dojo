import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { REPO } from '../harness/paths'

const cli = (...args: string[]): SpawnSyncReturns<string> =>
  spawnSync('npm', ['run', '--silent', 'e2e:app', '--', ...args], { cwd: REPO, encoding: 'utf8' })

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

// failure means: a bad turns argument gets past the control server, so an agent's typo kills the host and
// strands the app with no message, and every later command fails with fetch failed
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
    expect(JSON.parse(state.stdout)).toMatchObject({ unexpected: [], pendingTurns: 0 })
  } finally {
    await stopAndWait(dir, [session.hostPid, session.appPid])
  }
  expect(existsSync(`${dir}/session.json`)).toBe(false)
})

// failure means: the usage text no longer names every command, so an agent following it cannot discover stop
// and leaves the app running
test('the usage text lists every command', () => {
  const result = cli()
  expect(result.status).toBe(1)
  for (const command of ['start', 'step', 'turns', 'release', 'gh', 'state', 'stop']) {
    expect(result.stderr).toMatch(new RegExp(`^  ${command} +<run-dir>`, 'm'))
  }
})
