import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderStatus } from '../../shared/types'
import { run } from '../exec'
import { resolveInside } from '../paths'
import { claudeBinary } from './binaries'
import { type AgentRequest, type AgentResult, draftStream, type Provider, type ProviderConfig } from './provider'

/**
 * Subscription mode strips every credential variable so the bundled Claude Code falls back to the
 * user's own `claude auth login` session; Anthropic permits that only for individual use.
 */
function claudeEnv(config: ProviderConfig): Record<string, string | undefined> {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, ...base } = process.env
  return {
    ...base,
    CLAUDE_AGENT_SDK_CLIENT_APP: 'review-dojo',
    ...(config.auth === 'apiKey' && config.apiKey ? { ANTHROPIC_API_KEY: config.apiKey } : {}),
  }
}

export class ClaudeProvider implements Provider {
  readonly id = 'claude' as const

  constructor(private readonly config: ProviderConfig) {}

  get model(): string {
    return this.config.model
  }

  async run(request: AgentRequest): Promise<AgentResult> {
    request.signal.throwIfAborted()
    const abortController = new AbortController()
    const abort = () => abortController.abort()
    request.signal.addEventListener('abort', abort, { once: true })

    // PR checkouts are untrusted: no project settings, hooks, or MCP servers; no shell, since git
    // subcommands such as `log --output` can write files; and no reads outside the checkout, which
    // prompt-injected PR content could otherwise request.
    const options: Options = {
      cwd: request.cwd,
      model: this.config.model || undefined,
      effort: this.config.reasoningEffort,
      tools: request.tools === 'repo' ? ['Read', 'Grep', 'Glob'] : [],
      permissionMode: 'default',
      canUseTool: async (_tool, input) => {
        const path = input.file_path ?? input.path
        const allowed = typeof path !== 'string' || (await resolveInside(request.cwd, path)) !== null
        return allowed
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'Only files inside the repository checkout can be read.' }
      },
      settingSources: [],
      strictMcpConfig: true,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      env: claudeEnv(this.config),
      abortController,
      pathToClaudeCodeExecutable: claudeBinary(),
      maxTurns: request.schema ? 150 : 40,
      includePartialMessages: request.streamDrafts,
      ...(request.resume ? { resume: request.resume } : {}),
    }
    // The SDK's structured output makes the model emit one large tool call, which fails outright on
    // the invalid escapes models write when quoting code. A final JSON message can be repaired.
    const prompt = request.schema
      ? `${request.prompt}\n\nWhen you are done exploring, reply with only a JSON object matching this JSON Schema:\n${JSON.stringify(request.schema)}`
      : request.prompt

    const drafts = draftStream(request.onEvent)
    let draft = ''
    try {
      let sessionId: string | null = null
      for await (const message of query({ prompt, options })) {
        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = message.session_id
          continue
        }
        if (message.type === 'stream_event' && !message.parent_tool_use_id) {
          const { event } = message
          if (event.type === 'content_block_start' && event.content_block.type === 'text') draft = ''
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            draft += event.delta.text
            drafts.update(draft)
          }
          if (event.type === 'content_block_stop') drafts.flush()
          continue
        }
        if (message.type === 'assistant' && !message.parent_tool_use_id) {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text.trim()) request.onEvent({ kind: 'text', text: block.text })
            if (block.type === 'tool_use')
              request.onEvent({ kind: 'step', text: describeTool(block.name, block.input, request.cwd) })
          }
          continue
        }
        if (message.type !== 'result') continue

        const usage = Object.values(message.modelUsage).reduce(
          (total, model) => ({
            inputTokens:
              total.inputTokens + model.inputTokens + model.cacheReadInputTokens + model.cacheCreationInputTokens,
            outputTokens: total.outputTokens + model.outputTokens,
            costUsd: total.costUsd,
          }),
          { inputTokens: 0, outputTokens: 0, costUsd: this.config.auth === 'apiKey' ? message.total_cost_usd : null },
        )
        if (message.subtype !== 'success') {
          throw new Error(`Claude stopped early (${message.subtype}): ${message.errors.join('; ') || 'no details'}`)
        }
        return { text: message.result, sessionId: message.session_id ?? sessionId, usage }
      }
      throw new Error('Claude exited without a result.')
    } finally {
      request.signal.removeEventListener('abort', abort)
    }
  }

  async status(): Promise<ProviderStatus> {
    if (this.config.auth === 'apiKey') {
      return this.config.apiKey
        ? { ready: true, detail: 'Using your Anthropic API key.' }
        : { ready: false, detail: 'Add an Anthropic API key in Settings.' }
    }
    try {
      const output = await run(claudeBinary(), ['auth', 'status', '--json'], { env: claudeEnv(this.config) })
      const status = JSON.parse(output) as { loggedIn: boolean; authMethod?: string; subscriptionType?: string }
      return status.loggedIn
        ? {
            ready: true,
            detail: `Signed in with Claude${status.subscriptionType ? ` ${status.subscriptionType}` : ''}.`,
          }
        : { ready: false, detail: 'Run `claude auth login` in a terminal to use your Claude subscription.' }
    } catch {
      return { ready: false, detail: 'Run `claude auth login` in a terminal to use your Claude subscription.' }
    }
  }
}

function describeTool(name: string, input: unknown, cwd: string): string {
  const args = (input ?? {}) as Record<string, unknown>
  const target = String(args.file_path ?? args.pattern ?? args.path ?? '')
  return `${name} ${target.startsWith(`${cwd}/`) ? target.slice(cwd.length + 1) : target}`.trim()
}
