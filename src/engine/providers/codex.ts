import { join } from 'node:path'
import { Codex, type ThreadOptions } from '@openai/codex-sdk'
import type { ProviderStatus } from '../../shared/types'
import { CommandError, run } from '../exec'
import { codexBinary, codexVendorDir } from './binaries'
import { type AgentRequest, type AgentResult, draftStream, type Provider, type ProviderConfig } from './provider'

/**
 * Without an explicit key the bundled Codex CLI uses the user's `codex login` (ChatGPT) session.
 * Overriding the binary path drops the SDK's own PATH additions, so its bundled ripgrep is re-added.
 */
function codexEnv(): Record<string, string> {
  const { CODEX_API_KEY, OPENAI_API_KEY, ...base } = process.env
  const env = Object.fromEntries(
    Object.entries(base).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  return { ...env, PATH: `${join(codexVendorDir(), 'codex-path')}:${env.PATH ?? ''}` }
}

export class CodexProvider implements Provider {
  readonly id = 'codex' as const

  constructor(private readonly config: ProviderConfig) {}

  get model(): string {
    return this.config.model
  }

  async run(request: AgentRequest): Promise<AgentResult> {
    request.signal.throwIfAborted()
    const codex = new Codex({
      codexPathOverride: codexBinary(),
      env: codexEnv(),
      ...(this.config.auth === 'apiKey' && this.config.apiKey ? { apiKey: this.config.apiKey } : {}),
    })
    const options: ThreadOptions = {
      workingDirectory: request.cwd,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      webSearchMode: 'disabled',
      modelReasoningEffort: request.tools === 'none' ? 'low' : this.config.reasoningEffort,
      ...(this.config.model ? { model: this.config.model } : {}),
    }
    const thread = request.resume ? codex.resumeThread(request.resume, options) : codex.startThread(options)
    const { events } = await thread.runStreamed(request.prompt, {
      signal: request.signal,
      ...(request.schema ? { outputSchema: request.schema } : {}),
    })

    const drafts = draftStream(request.onEvent)
    let finalText = ''
    let usage: AgentResult['usage'] = null
    for await (const event of events) {
      switch (event.type) {
        case 'item.started':
          if (event.item.type === 'command_execution')
            request.onEvent({ kind: 'step', text: `$ ${event.item.command}` })
          break
        case 'item.updated':
          if (request.streamDrafts && event.item.type === 'agent_message') drafts.update(event.item.text)
          break
        case 'item.completed':
          if (event.item.type === 'reasoning' && event.item.text.trim())
            request.onEvent({ kind: 'text', text: event.item.text })
          if (event.item.type === 'agent_message') finalText = event.item.text
          break
        case 'turn.completed':
          usage = { inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens, costUsd: null }
          break
        case 'turn.failed':
          throw new Error(`Codex failed: ${event.error.message}`)
        case 'error':
          throw new Error(`Codex failed: ${event.message}`)
      }
    }

    return { text: finalText, sessionId: thread.id, usage }
  }

  async status(): Promise<ProviderStatus> {
    if (this.config.auth === 'apiKey') {
      return this.config.apiKey
        ? { ready: true, detail: 'Using your OpenAI API key.' }
        : { ready: false, detail: 'Add an OpenAI API key in Settings.' }
    }
    try {
      const output = await run(codexBinary(), ['login', 'status'], { env: codexEnv() })
      return { ready: true, detail: output.trim() || 'Signed in to Codex.' }
    } catch (error) {
      const detail = error instanceof CommandError ? error.stderr.trim() : ''
      return {
        ready: false,
        detail: `${detail ? `${detail}. ` : ''}Run \`npx @openai/codex login\` in a terminal to use your ChatGPT plan.`,
      }
    }
  }
}
