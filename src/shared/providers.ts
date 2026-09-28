import type { ProviderId, Settings } from './types'

export const PROVIDER_IDS: readonly ProviderId[] = ['claude', 'codex']

export const PROVIDER_NAMES: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex' }

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'

export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude',
  claude: { auth: 'subscription', model: DEFAULT_CLAUDE_MODEL, reasoningEffort: 'high' },
  codex: { auth: 'subscription', model: '', reasoningEffort: 'high' },
  dojoMode: false,
}

/** Checked in order when no key is saved, matching what each provider's own CLI honors. */
export const API_KEY_ENV: Record<ProviderId, string[]> = {
  claude: ['ANTHROPIC_API_KEY'],
  codex: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
}
