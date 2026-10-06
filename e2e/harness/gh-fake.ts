import { appendFileSync, readFileSync } from 'node:fs'
import type { GhCall, GhReply } from './gh'

const ROUTES: [RegExp, (match: RegExpExecArray) => string][] = [
  [/^api user --jq \.login$/, () => 'user'],
  [/^search prs --review-requested=@me --state=open --limit 50 --json \S+$/, () => 'review-requests'],
  [/^pr view (\d+) --repo (\S+) --json \S+$/, (m) => `pr ${m[2]}#${m[1]}`],
  [/^api repos\/(\S+)\/issues\/(\d+)$/, (m) => `issue ${m[1]}#${m[2]}`],
  [
    /^api graphql --paginate --slurp -f query=[\s\S]+ -F owner=(\S+) -F repo=(\S+) -F number=(\d+)$/,
    (m) => `threads ${m[1]}/${m[2]}#${m[3]}`,
  ],
  [
    /^api graphql -f query=[\s\S]+ -F owner=(\S+) -F repo=(\S+) -F number=(\d+)$/,
    (m) => `stack ${m[1]}/${m[2]}#${m[3]}`,
  ],
  [/^pr list --repo (\S+) --state open --limit 500 --json \S+$/, (m) => `open-prs ${m[1]}`],
  [/^api --method POST repos\/(\S+)\/pulls\/(\d+)\/reviews --input -$/, (m) => `submit ${m[1]}#${m[2]}`],
  [
    /^api repos\/(\S+)\/pulls\/comments\?sort=created&direction=desc&per_page=100&page=(\d+)$/,
    (m) => `review-comments ${m[1]} page ${m[2]}`,
  ],
]

function routeOf(argv: string[]): string | null {
  const line = argv.join(' ')
  for (const [pattern, name] of ROUTES) {
    const match = pattern.exec(line)
    if (match) return name(match)
  }
  return null
}

function readAll(stream: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => (data += chunk))
    stream.on('end', () => resolve(data))
  })
}

const scriptPath = process.env.DOJO_E2E_GH_SCRIPT ?? ''
const logPath = process.env.DOJO_E2E_GH_LOG ?? ''
if (!scriptPath || !logPath) {
  process.stderr.write('fake gh: DOJO_E2E_GH_SCRIPT and DOJO_E2E_GH_LOG must be set\n')
  process.exit(2)
}

const argv = process.argv.slice(2)
const stdin = await readAll(process.stdin)
const route = routeOf(argv)

function log(call: GhCall): void {
  appendFileSync(logPath, `${JSON.stringify(call)}\n`)
}

function refuse(why: string): never {
  log({ route, argv, stdin, exit: 1, unscripted: true })
  process.stderr.write(`fake gh: ${why}: gh ${argv.join(' ')}\n`)
  process.exit(1)
}

let script: Record<string, GhReply>
try {
  script = JSON.parse(readFileSync(scriptPath, 'utf8')) as Record<string, GhReply>
} catch (error) {
  refuse(`could not read the script at ${scriptPath} (${error instanceof Error ? error.message : String(error)})`)
}
const reply = route === null ? undefined : script[route]
if (!reply) refuse('unscripted call')

const exit = reply.exit ?? 0
log({ route, argv, stdin, exit, unscripted: false })
if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs))
process.stdout.write(reply.stdout ?? '')
process.stderr.write(reply.stderr ?? '')
process.exit(exit)
