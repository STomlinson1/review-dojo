import { useState } from 'react'
import { DEFAULT_CLAUDE_MODEL, PROVIDER_IDS, PROVIDER_NAMES } from '../../../shared/providers'
import type { ProviderId, ProviderSettings } from '../../../shared/types'
import { errorMessage } from '../api'
import { useDojo } from '../store'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { ErrorNote } from './ErrorNote'
import styles from './SettingsModal.module.css'

const LOGIN_COMMANDS: Record<ProviderId, string> = { claude: 'claude auth login', codex: 'npx @openai/codex login' }
const CLAUDE_MODELS = [DEFAULT_CLAUDE_MODEL, 'claude-sonnet-5', 'claude-haiku-4-5-20251001']
const EFFORTS = ['low', 'medium', 'high'] as const

export function SettingsModal({ onClose }: { onClose(): void }) {
  const settings = useDojo((state) => state.settings)
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!form) return null

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await useDojo.getState().saveSettings(form)
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
      setSaving(false)
    }
  }

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </>
  )

  return (
    <Dialog title="Settings" onClose={onClose} footer={footer}>
      <div className={styles.content}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Guide</legend>
          <div className={styles.choices}>
            {PROVIDER_IDS.map((id) => (
              <label key={id} className={styles.choice}>
                <input
                  type="radio"
                  name="provider"
                  checked={form.provider === id}
                  onChange={() => setForm({ ...form, provider: id })}
                />
                {PROVIDER_NAMES[id]}
              </label>
            ))}
          </div>
        </fieldset>

        {PROVIDER_IDS.map((id) => (
          <ProviderFields
            key={id}
            id={id}
            settings={form[id]}
            onChange={(patch) => setForm({ ...form, [id]: { ...form[id], ...patch } })}
          />
        ))}

        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={form.dojoMode}
            onChange={(event) => setForm({ ...form, dojoMode: event.target.checked })}
          />
          <span>
            <span className={styles.label}>Dojo mode by default</span>
            <span className={styles.help}>Predict what each stop does before its explanation is revealed.</span>
          </span>
        </label>

        {error ? <ErrorNote title="Settings weren't saved" message={error} /> : null}
      </div>
    </Dialog>
  )
}

interface ProviderFieldsProps {
  id: ProviderId
  settings: ProviderSettings
  onChange(patch: Partial<ProviderSettings>): void
}

function ProviderFields({ id, settings, onChange }: ProviderFieldsProps) {
  const { auth, model, reasoningEffort } = settings
  const status = useDojo((state) => state.environment?.providers[id])
  const name = PROVIDER_NAMES[id]

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{name}</legend>
      {status ? (
        <p className={styles.status}>
          <span className={styles.dot} data-ready={status.ready} aria-hidden="true" />
          {status.detail}
        </p>
      ) : null}

      <div className={styles.choices} role="radiogroup" aria-label={`${name} sign-in`}>
        <label className={styles.choice}>
          <input
            type="radio"
            name={`${id}-auth`}
            checked={auth === 'apiKey'}
            onChange={() => onChange({ auth: 'apiKey' })}
          />
          API key
        </label>
        <label className={styles.choice}>
          <input
            type="radio"
            name={`${id}-auth`}
            checked={auth === 'subscription'}
            onChange={() => onChange({ auth: 'subscription' })}
          />
          Subscription
        </label>
      </div>
      <p className={styles.help}>
        {auth === 'subscription' ? (
          <>
            Uses your own <code>{LOGIN_COMMANDS[id]}</code> session on this Mac, for personal use.
          </>
        ) : (
          <>Requests are billed to the API key's account.</>
        )}
      </p>

      {auth === 'apiKey' ? <ApiKeyField provider={id} hasApiKey={status?.hasApiKey ?? false} /> : null}

      <div className={styles.field}>
        <label htmlFor={`${id}-model`} className={styles.label}>
          Model
        </label>
        <input
          id={`${id}-model`}
          type="text"
          list={id === 'claude' ? 'claude-models' : undefined}
          value={model}
          placeholder={id === 'claude' ? CLAUDE_MODELS[0] : 'CLI default'}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange({ model: event.target.value })}
        />
        {id === 'claude' ? (
          <datalist id="claude-models">
            {CLAUDE_MODELS.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        ) : (
          <p className={styles.help}>Leave empty to use the Codex CLI's default model.</p>
        )}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-effort`} className={styles.label}>
          Reasoning effort
        </label>
        <select
          id={`${id}-effort`}
          className={styles.select}
          value={reasoningEffort}
          onChange={(event) => onChange({ reasoningEffort: event.target.value as ProviderSettings['reasoningEffort'] })}
        >
          {EFFORTS.map((effort) => (
            <option key={effort} value={effort}>
              {effort[0].toUpperCase() + effort.slice(1)}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  )
}

function ApiKeyField({ provider, hasApiKey }: { provider: ProviderId; hasApiKey: boolean }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const store = async (value: string | null) => {
    setBusy(true)
    setError(null)
    try {
      await useDojo.getState().setApiKey(provider, value)
      setKey('')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.field}>
      <label htmlFor={`${provider}-key`} className={styles.label}>
        API key
      </label>
      <div className={styles.row}>
        <input
          id={`${provider}-key`}
          type="password"
          value={key}
          placeholder={hasApiKey ? 'Enter a new key to replace the saved one' : 'Paste your API key'}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button disabled={busy || !key.trim()} onClick={() => void store(key.trim())}>
          Save key
        </Button>
        {hasApiKey ? (
          <Button variant="ghost" disabled={busy} onClick={() => void store(null)}>
            Clear
          </Button>
        ) : null}
      </div>
      <p className={styles.help}>{hasApiKey ? 'A key is saved on this Mac.' : 'No key saved.'}</p>
      {error ? <ErrorNote title="The key wasn't updated" message={error} /> : null}
    </div>
  )
}
