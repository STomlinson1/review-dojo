import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Dojo } from './engine/dojo'
import { apiKeyFromEnv, createProvider } from './engine/providers'
import { DEFAULT_SETTINGS, PROVIDER_IDS } from './shared/providers'
import { tourStops } from './shared/tour'
import type { ProviderId, TaskEvent } from './shared/types'

const USAGE = `Usage: review-dojo tour <pr-url | owner/repo#number> [--provider claude|codex] [--model <id>]

Prints the tour as JSON on stdout and progress on stderr. Uses ANTHROPIC_API_KEY, or CODEX_API_KEY /
OPENAI_API_KEY, when set; otherwise your \`claude auth login\` / \`codex login\` session.`

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { provider: { type: 'string', default: 'claude' }, model: { type: 'string' } },
  })
  const [command, target] = positionals
  const providerId = values.provider as ProviderId
  if (command !== 'tour' || !target || !PROVIDER_IDS.includes(providerId)) {
    console.error(USAGE)
    process.exitCode = 2
    return
  }

  const apiKey = apiKeyFromEnv(providerId)
  const provider = createProvider(providerId, {
    ...DEFAULT_SETTINGS[providerId],
    auth: apiKey ? 'apiKey' : 'subscription',
    apiKey,
    ...(values.model ? { model: values.model } : {}),
  })

  const dojo = new Dojo(join(homedir(), 'Library', 'Application Support', 'Review Dojo'))
  const log = (text: string) => process.stderr.write(`${text}\n`)
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  const task = {
    signal: controller.signal,
    onEvent: (event: TaskEvent) => {
      if (event.kind === 'step') log(`  ${event.text}`)
      else if (event.kind === 'text') log(`  » ${event.text.split('\n')[0]}`)
      else if (event.kind === 'tour' && event.tour) log(`  ${tourStops(event.tour).length} stops written`)
    },
  }
  const session = await dojo.openPullRequest(target, task)
  log(
    `${session.diff.files.length} files, ${session.diff.files.reduce((sum, file) => sum + file.hunks.length, 0)} hunks`,
  )

  const record = await dojo.generateTour(session.pr.ref, provider, task)
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
