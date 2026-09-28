import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { readJson, writeJson } from '../engine/jsonFile'
import { apiKeyFromEnv } from '../engine/providers'
import type { ProviderConfig } from '../engine/providers/provider'
import { DEFAULT_SETTINGS } from '../shared/providers'
import type { ProviderId, Settings } from '../shared/types'

/** API keys are encrypted with the macOS keychain and never leave the main process. */
export class SettingsStore {
  constructor(private readonly dir: string) {}

  async load(): Promise<Settings> {
    const saved = await readJson<Partial<Settings>>(this.settingsPath())
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      claude: { ...DEFAULT_SETTINGS.claude, ...saved?.claude },
      codex: { ...DEFAULT_SETTINGS.codex, ...saved?.codex },
    }
  }

  async save(settings: Settings): Promise<void> {
    writeJson(this.settingsPath(), settings)
  }

  async apiKey(provider: ProviderId): Promise<string | null> {
    const encrypted = await readFile(this.keyPath(provider)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    return encrypted ? safeStorage.decryptString(encrypted) : apiKeyFromEnv(provider)
  }

  async setApiKey(provider: ProviderId, key: string | null): Promise<void> {
    if (!key) {
      await rm(this.keyPath(provider), { force: true })
      return
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS keychain encryption is unavailable.')
    await mkdir(join(this.dir, 'keys'), { recursive: true })
    await writeFile(this.keyPath(provider), safeStorage.encryptString(key.trim()), { mode: 0o600 })
  }

  async providerConfig(provider: ProviderId): Promise<ProviderConfig> {
    const chosen = (await this.load())[provider]
    return { ...chosen, apiKey: chosen.auth === 'apiKey' ? await this.apiKey(provider) : null }
  }

  private settingsPath(): string {
    return join(this.dir, 'settings.json')
  }

  private keyPath(provider: ProviderId): string {
    return join(this.dir, 'keys', `${provider}.bin`)
  }
}
