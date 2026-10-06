import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { HARNESS } from '../harness/paths'

test('the fake gh reports a script it cannot read as an unscripted call instead of dying silently', async ({}, testInfo) => {
  const dir = testInfo.outputPath('run')
  mkdirSync(dir, { recursive: true })
  const script = join(dir, 'gh-script.json')
  const log = join(dir, 'gh.jsonl')
  writeFileSync(script, '{"user": {"std')

  const result = spawnSync(join(HARNESS, 'bin/gh'), ['api', 'user', '--jq', '.login'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, DOJO_E2E_NODE: process.execPath, DOJO_E2E_GH_SCRIPT: script, DOJO_E2E_GH_LOG: log },
  })

  expect(
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  ).toEqual([{ route: 'user', argv: ['api', 'user', '--jq', '.login'], stdin: '', exit: 1, unscripted: true }])
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('could not read the script')
})
