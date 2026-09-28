import type { AgentEvent, ProviderId, ProviderSettings, ProviderStatus, Usage } from '../../shared/types'

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
  signal: AbortSignal
  onEvent: (event: AgentEvent) => void
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
