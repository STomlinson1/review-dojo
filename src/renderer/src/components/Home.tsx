import { useCallback, useEffect, useState } from 'react'
import { PROVIDER_NAMES } from '../../../shared/providers'
import type { PrSummary } from '../../../shared/types'
import { dojo, errorMessage } from '../api'
import { relativeTime } from '../lib/format'
import { useDojo } from '../store'
import { ActivityLog } from './ActivityLog'
import { Button } from './Button'
import { ErrorNote } from './ErrorNote'
import styles from './Home.module.css'

type ReviewRequests =
  { status: 'loading' } | { status: 'ready'; items: PrSummary[] } | { status: 'error'; message: string }

export function Home() {
  const opening = useDojo((state) => state.tasks.open)
  const openError = useDojo((state) => state.errors.open)
  const { openPullRequest, cancelTask } = useDojo.getState()
  const [input, setInput] = useState('')

  return (
    <div className={styles.home}>
      <div className={styles.dragRegion} />
      <main className={styles.column}>
        <header>
          <h1 className={styles.wordmark}>Review Dojo</h1>
          <p className={styles.tagline}>Understand a pull request before you judge it.</p>
        </header>

        <SetupStatus />

        <form
          className={styles.openForm}
          onSubmit={(event) => {
            event.preventDefault()
            if (input.trim()) void openPullRequest(input)
          }}
        >
          <label htmlFor="pr-input" className={styles.label}>
            Open a pull request
          </label>
          <div className={styles.inputRow}>
            <input
              id="pr-input"
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="https://github.com/owner/repo/pull/123 or owner/repo#123"
              spellCheck={false}
              autoComplete="off"
              autoFocus
              disabled={opening !== undefined}
            />
            <Button type="submit" variant="primary" disabled={!input.trim() || opening !== undefined}>
              Open
            </Button>
          </div>
        </form>

        {opening ? (
          <ActivityLog task={opening} label="Opening pull request" onCancel={() => cancelTask('open')} />
        ) : null}
        {openError ? <ErrorNote title="Couldn't open that pull request" message={openError} /> : null}

        <ReviewRequestList disabled={opening !== undefined} onOpen={(url) => void openPullRequest(url)} />
      </main>
    </div>
  )
}

function SetupStatus() {
  const environment = useDojo((state) => state.environment)
  const environmentError = useDojo((state) => state.environmentError)
  const provider = useDojo((state) => state.settings?.provider ?? 'claude')
  const { refreshEnvironment, setOverlay } = useDojo.getState()

  if (environmentError) {
    return (
      <ErrorNote title="Couldn't check your setup" message={environmentError}>
        <Button size="sm" onClick={() => void refreshEnvironment()}>
          Check again
        </Button>
      </ErrorNote>
    )
  }
  if (!environment) return <p className={styles.muted}>Checking your setup…</p>

  const { gh } = environment
  const status = environment.providers[provider]
  return (
    <ul className={styles.status} aria-label="Setup">
      <li>
        <span className={styles.dot} data-ready={gh.ready} aria-hidden="true" />
        {gh.ready ? (
          <span>
            GitHub CLI signed in as <strong>{gh.user}</strong>
          </span>
        ) : (
          <span>
            GitHub CLI isn't signed in. Run <code>gh auth login</code> in a terminal, then{' '}
            <button type="button" className={styles.link} onClick={() => void refreshEnvironment()}>
              check again
            </button>
            .<span className={styles.detail}>{gh.detail}</span>
          </span>
        )}
      </li>
      <li>
        <span className={styles.dot} data-ready={status.ready} aria-hidden="true" />
        <span>
          {PROVIDER_NAMES[provider]}: {status.detail}{' '}
          <button type="button" className={styles.link} onClick={() => setOverlay({ kind: 'settings' })}>
            Settings
          </button>
        </span>
      </li>
    </ul>
  )
}

function ReviewRequestList({ disabled, onOpen }: { disabled: boolean; onOpen(url: string): void }) {
  const [requests, setRequests] = useState<ReviewRequests>({ status: 'loading' })

  const load = useCallback(() => {
    setRequests({ status: 'loading' })
    dojo.listReviewRequests().then(
      (items) => setRequests({ status: 'ready', items }),
      (error: unknown) => setRequests({ status: 'error', message: errorMessage(error) }),
    )
  }, [])

  useEffect(load, [load])

  return (
    <section className={styles.requests} aria-labelledby="requests-heading">
      <div className={styles.sectionHeader}>
        <h2 id="requests-heading" className={styles.sectionTitle}>
          Review requested
        </h2>
        <Button size="sm" variant="ghost" onClick={load} disabled={requests.status === 'loading'}>
          Refresh
        </Button>
      </div>
      {requests.status === 'loading' ? <p className={styles.muted}>Loading review requests…</p> : null}
      {requests.status === 'error' ? (
        <ErrorNote title="Couldn't load your review requests" message={requests.message} />
      ) : null}
      {requests.status === 'ready' && requests.items.length === 0 ? (
        <p className={styles.muted}>Nothing is waiting for your review.</p>
      ) : null}
      {requests.status === 'ready' && requests.items.length > 0 ? (
        <ul className={styles.requestList}>
          {requests.items.map((item) => (
            <li key={item.url}>
              <button type="button" className={styles.request} disabled={disabled} onClick={() => onOpen(item.url)}>
                <img
                  className={styles.avatar}
                  src={`https://avatars.githubusercontent.com/${encodeURIComponent(item.author)}?s=40`}
                  alt=""
                  width={20}
                  height={20}
                  onError={(event) => {
                    event.currentTarget.style.visibility = 'hidden'
                  }}
                />
                <span className={styles.requestMain}>
                  <span className={styles.requestTitle}>{item.title}</span>
                  <span className={styles.requestMeta}>
                    {item.ref.owner}/{item.ref.repo} #{item.ref.number} · {item.author} · {relativeTime(item.updatedAt)}
                  </span>
                </span>
                {item.isDraft ? <span className={styles.draft}>Draft</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
