import type { AgentEvent, ProviderId, ProviderSettings, ProviderStatus, Usage, TaskEvent } from '../../shared/types'

export interface AgentRequest {
  cwd: string
  prompt: string
  /**
   * JSON schema for the final answer; null for free-form Markdown. Providers with constrained
   * decoding enforce it, others pass it in the prompt. Callers parse `text` either way.
   */
  schema: Record<string, unknown> | null
  /** Session to continue, so follow-ups keep everything the agent already explored. */
  resume: string | null
  /** `repo` grants read-only repository tools; `none` is a plain completion. */
  tools: 'repo' | 'none'
  streamDrafts: boolean
  signal: AbortSignal
  onEvent: (event: AgentEvent) => void
}

export interface TaskContext {
  signal: AbortSignal
  onEvent: (event: TaskEvent) => void
}

export interface AgentResult {
  text: string
  sessionId: string | null
  usage: Usage | null
}

export interface ProviderConfig extends ProviderSettings {
  apiKey: string | null
}

export interface Provider {
  readonly id: ProviderId
  readonly model: string
  run(request: AgentRequest): Promise<AgentResult>
  status(): Promise<ProviderStatus>
}

const DRAFT_INTERVAL_MS = 120

/** Throttles `draft` events so a fast token stream doesn't flood the renderer. */
export function draftStream(onEvent: (event: AgentEvent) => void): { update(text: string): void; flush(): void } {
  let latest = ''
  let sent = ''
  let lastSentAt = 0
  const send = () => {
    if (latest === sent || !latest.trim()) return
    sent = latest
    lastSentAt = Date.now()
    onEvent({ kind: 'draft', text: latest })
  }
  return {
    update(text) {
      latest = text
      if (Date.now() - lastSentAt >= DRAFT_INTERVAL_MS) send()
    },
    flush: send,
  }
}
