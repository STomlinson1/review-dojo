import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProviderId, Settings } from '../../src/shared/types'
import { Gh } from './gh'
import { type Mock, startMock } from './mock-api'
import { ARTIFACTS, HARNESS, MANIFEST, REPO } from './paths'
import { GIT_ISOLATION, type Manifest, buildFixtures, readManifest } from './remotes'
import { pullRequest, signedIn } from './world'

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

/** Everything a launched app needs, with the fixture pull request and a signed-in `gh` already scripted. */
export interface World {
  run: Run
  gh: Gh
  mock: Mock
  prs: Manifest['prs']
  args: string[]
  env: Record<string, string>
  openedLinks(): string[]
}

const SEED_SETTINGS: Settings = {
  provider: 'claude',
  claude: { auth: 'apiKey', model: 'claude-opus-5-5', reasoningEffort: 'high' },
  codex: { auth: 'apiKey', model: '', reasoningEffort: 'high' },
  dojoMode: false,
}

const BIN = join(HARNESS, 'bin')

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
function prepareRun(dir: string, mockUrl: string, settings: Settings): Run {
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
    ...GIT_ISOLATION,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.file://${remotes}/.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/',
  }
}

function appEnv(run: Run, mockUrl: string, remotes: string): Record<string, string> {
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

function appArgs(run: Run, mockUrl: string): string[] {
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

export const openedLinks = (run: Run): string[] =>
  existsSync(run.openLog) ? readFileSync(run.openLog, 'utf8').split('\n').filter(Boolean) : []

export async function openWorld(dir: string, provider: ProviderId = 'claude'): Promise<World> {
  const manifest = existsSync(MANIFEST) ? readManifest(MANIFEST) : buildFixtures(ARTIFACTS)
  const mock = await startMock(runPaths(dir).mockLog)
  const run = prepareRun(dir, mock.url, { ...SEED_SETTINGS, provider })
  const gh = new Gh(run.ghScript, run.ghLog)
  signedIn(gh)
  pullRequest(gh, manifest.prs.widget)
  return {
    run,
    gh,
    mock,
    prs: manifest.prs,
    args: appArgs(run, mock.url),
    env: appEnv(run, mock.url, manifest.remotes),
    openedLinks: () => openedLinks(run),
  }
}
