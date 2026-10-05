import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '../../src/shared/types'
import { HARNESS, REPO } from './paths'

export interface Run {
  dir: string
  userData: string
  ghScript: string
  ghLog: string
  mockLog: string
  openLog: string
  claudeConfig: string
  codexHome: string
}

export const SEED_SETTINGS: Settings = {
  provider: 'claude',
  claude: { auth: 'apiKey', model: 'claude-opus-5-5', reasoningEffort: 'high' },
  codex: { auth: 'apiKey', model: '', reasoningEffort: 'high' },
  dojoMode: false,
}

export const BIN = join(HARNESS, 'bin')

export function runPaths(dir: string): Run {
  return {
    dir,
    userData: join(dir, 'user-data'),
    ghScript: join(dir, 'gh-script.json'),
    ghLog: join(dir, 'gh.jsonl'),
    mockLog: join(dir, 'mock.jsonl'),
    openLog: join(dir, 'opened-links.log'),
    claudeConfig: join(dir, 'claude'),
    codexHome: join(dir, 'codex'),
  }
}

function codexConfig(mockUrl: string): string {
  return `model = "mock-model"
model_provider = "mock"
cli_auth_credentials_store = "file"

[analytics]
enabled = false

[features]
plugins = false
remote_plugin = false
plugin_sharing = false
apps = false

[model_providers.mock]
name = "mock"
base_url = "${mockUrl}/v1"
wire_api = "responses"
env_key = "CODEX_API_KEY"
supports_websockets = false
`
}

/** Never overwrites settings.json: a relaunch must see what the app saved. */
export function prepareRun(dir: string, mockUrl: string, settings: Settings = SEED_SETTINGS): Run {
  const run = runPaths(dir)
  for (const path of [run.userData, run.claudeConfig, run.codexHome, join(dir, 'home'), join(dir, 'tmp')]) {
    mkdirSync(path, { recursive: true })
  }
  const settingsPath = join(run.userData, 'settings.json')
  if (!existsSync(settingsPath)) writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  writeFileSync(join(run.codexHome, 'config.toml'), codexConfig(mockUrl))
  return run
}

export function gitEnv(remotes: string): Record<string, string> {
  return {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.file://${remotes}/.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/',
  }
}

export function appEnv(run: Run, mockUrl: string, remotes: string): Record<string, string> {
  return {
    PATH: `${BIN}:/usr/bin:/bin`,
    SHELL: join(BIN, 'stub-shell'),
    HOME: join(run.dir, 'home'),
    TMPDIR: join(run.dir, 'tmp'),
    DOJO_E2E_NODE: process.execPath,
    DOJO_E2E_GH_SCRIPT: run.ghScript,
    DOJO_E2E_GH_LOG: run.ghLog,
    DOJO_E2E_OPEN_LOG: run.openLog,
    ANTHROPIC_API_KEY: 'e2e-anthropic-key',
    OPENAI_API_KEY: 'e2e-openai-key',
    ANTHROPIC_BASE_URL: mockUrl,
    CLAUDE_CONFIG_DIR: run.claudeConfig,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CODEX_HOME: run.codexHome,
    HTTP_PROXY: mockUrl,
    HTTPS_PROXY: mockUrl,
    ALL_PROXY: mockUrl,
    NO_PROXY: '127.0.0.1,localhost',
    ...gitEnv(remotes),
  }
}

export function appArgs(run: Run, mockUrl: string): string[] {
  return [
    '-r',
    join(HARNESS, 'hooks/open-links.cjs'),
    '-r',
    join(HARNESS, 'hooks/background.cjs'),
    REPO,
    `--user-data-dir=${run.userData}`,
    `--proxy-server=${mockUrl}`,
  ]
}
