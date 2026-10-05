import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface FixturePr {
  owner: string
  repo: string
  number: number
  url: string
  title: string
  body: string
  baseRefName: string
  headRefName: string
  baseSha: string
  headSha: string
  additions: number
  deletions: number
  changedFiles: number
  /** Hunk ids per changed path, numbered across the whole diff in the order git prints it. */
  hunks: Record<string, string[]>
}

export interface Manifest {
  remotes: string
  prs: {
    widget: FixturePr
    widgetPushed: FixturePr
    widgetStacked: FixturePr
  }
}

const GIT_ENV = {
  PATH: process.env.PATH,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture Author',
  GIT_AUTHOR_EMAIL: 'author@example.test',
  GIT_COMMITTER_NAME: 'Fixture Author',
  GIT_COMMITTER_EMAIL: 'author@example.test',
  GIT_AUTHOR_DATE: '2026-01-05T10:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-05T10:00:00Z',
}

const GREET_BASE = [
  'export function greet(name: string): string {',
  '  const cleaned = name.trim()',
  "  return 'Hello, ' + cleaned",
  '}',
  '',
  ...Array.from({ length: 16 }, (_, index) => `export const pad${index + 1} = ${index + 1}`),
  '',
  'export function shout(name: string): string {',
  '  return greet(name).toUpperCase()',
  '}',
  '',
].join('\n')

const GREET_HEAD = GREET_BASE.replace("return 'Hello, ' + cleaned", 'return `Hello, ${cleaned}!`').replace(
  'return greet(name).toUpperCase()',
  "return greet(name).toUpperCase() + '!'",
)

const MATH_BASE = ['export function add(a: number, b: number): number {', '  return a + b', '}', ''].join('\n')

const MATH_HEAD = [MATH_BASE, 'export function double(n: number): number {', '  return add(n, n)', '}', ''].join('\n')

const FAREWELL = [
  "import { greet } from './greet'",
  '',
  'export function farewell(name: string): string {',
  "  return greet(name).replace('Hello', 'Goodbye')",
  '}',
  '',
].join('\n')

const FAREWELL_PUSHED = [FAREWELL, 'export function wave(): string {', "  return 'o/'", '}', ''].join('\n')

const INDEX = ["export { greet, shout } from './greet'", "export { farewell } from './farewell'", ''].join('\n')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim()
}

function commit(work: string, message: string, files: Record<string, string>): string {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(work, path)), { recursive: true })
    writeFileSync(join(work, path), contents)
  }
  git(work, 'add', '-A')
  git(work, 'commit', '--quiet', '-m', message)
  return git(work, 'rev-parse', 'HEAD')
}

function describe(
  work: string,
  pr: Pick<FixturePr, 'number' | 'title' | 'body' | 'baseRefName' | 'headRefName' | 'baseSha' | 'headSha'>,
): FixturePr {
  const mergeBase = git(work, 'merge-base', pr.baseSha, pr.headSha)
  const hunks: Record<string, string[]> = {}
  let path = ''
  let count = 0
  for (const line of git(work, 'diff', '--no-color', '--no-ext-diff', mergeBase, pr.headSha).split('\n')) {
    if (line.startsWith('diff --git ')) path = line.slice(line.indexOf(' b/') + 3)
    else if (line.startsWith('@@ ')) (hunks[path] ??= []).push(`H${(count += 1)}`)
  }
  const stats = git(work, 'diff', '--numstat', mergeBase, pr.headSha)
    .split('\n')
    .map((line) => line.split('\t').map(Number))
  return {
    owner: 'acme',
    repo: 'widget',
    url: `https://github.com/acme/widget/pull/${pr.number}`,
    ...pr,
    additions: stats.reduce((total, [added]) => total + added, 0),
    deletions: stats.reduce((total, [, deleted]) => total + deleted, 0),
    changedFiles: stats.length,
    hunks,
  }
}

export function buildFixtures(artifacts: string): Manifest {
  const work = join(artifacts, 'work/acme/widget')
  const remotes = join(artifacts, 'remotes')
  const bare = join(remotes, 'acme/widget.git')
  rmSync(join(artifacts, 'work'), { recursive: true, force: true })
  rmSync(remotes, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  mkdirSync(dirname(bare), { recursive: true })

  git(work, 'init', '--quiet', '--initial-branch', 'main')
  commit(work, 'Add greeting helpers', {
    'README.md': '# widget\n\nGreeting helpers.\n',
    'src/greet.ts': GREET_BASE,
    'src/util/math.ts': MATH_BASE,
  })
  git(work, 'checkout', '--quiet', '-b', 'feature')
  const head = commit(work, 'Friendlier greetings', {
    'src/greet.ts': GREET_HEAD,
    'src/util/math.ts': MATH_HEAD,
    'src/farewell.ts': FAREWELL,
  })
  git(work, 'checkout', '--quiet', '-b', 'feature-2')
  const stacked = commit(work, 'Export the helpers', { 'src/index.ts': INDEX })
  git(work, 'checkout', '--quiet', 'feature')
  const pushed = commit(work, 'Add wave, drop double', {
    'src/farewell.ts': FAREWELL_PUSHED,
    'src/util/math.ts': MATH_BASE,
  })
  // main moves on after the branch point, so a diff against the base tip is not the merge-base diff.
  git(work, 'checkout', '--quiet', 'main')
  const baseTip = commit(work, 'Reword the README', {
    'README.md': '# widget\n\nGreeting helpers for every occasion.\n',
  })

  // A file:// URL keeps git from taking its local-clone shortcut, which would ignore --filter.
  git(artifacts, 'clone', '--quiet', '--bare', `file://${work}`, bare)
  git(bare, 'config', 'uploadpack.allowFilter', 'true')
  git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true')

  const widget = {
    number: 7,
    title: 'Friendlier greetings',
    body: 'Adds an exclamation mark to greetings and a farewell helper.',
    baseRefName: 'main',
    headRefName: 'feature',
    baseSha: baseTip,
  }
  const manifest: Manifest = {
    remotes,
    prs: {
      widget: describe(work, { ...widget, headSha: head }),
      widgetPushed: describe(work, { ...widget, headSha: pushed }),
      widgetStacked: describe(work, {
        number: 8,
        title: 'Export the helpers',
        body: 'Adds an index module.',
        baseRefName: 'feature',
        headRefName: 'feature-2',
        baseSha: head,
        headSha: stacked,
      }),
    },
  }
  writeFileSync(join(artifacts, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

export function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest
}
