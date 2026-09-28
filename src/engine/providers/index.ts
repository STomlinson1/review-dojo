import { API_KEY_ENV } from '../../shared/providers'
import type { ProviderId } from '../../shared/types'
import { ClaudeProvider } from './claude'
import { CodexProvider } from './codex'
import type { Provider, ProviderConfig } from './provider'

export function apiKeyFromEnv(provider: ProviderId): string | null {
  return API_KEY_ENV[provider].map((name) => process.env[name]).find(Boolean) ?? null
}

export function createProvider(id: ProviderId, config: ProviderConfig): Provider {
  return id === 'claude' ? new ClaudeProvider(config) : new CodexProvider(config)
}
