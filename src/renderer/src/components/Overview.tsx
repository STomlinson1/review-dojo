import { useState } from 'react'
import { PROVIDER_NAMES } from '../../../shared/providers'
import type { DiffFile, IntentCheck, Stop } from '../../../shared/types'
import { formatUsage } from '../lib/format'
import { findHunk, stopForHunk, tourStops } from '../../../shared/tour'
import { useDojo, useSession } from '../store'
import { ActivityLog } from './ActivityLog'
import { Button } from './Button'
import { ErrorNote } from './ErrorNote'
import { CheckIcon } from './icons'
import { InlineCode, Markdown } from './Markdown'
import styles from './Overview.module.css'
import { RiskBadge } from './Risk'

export function Overview() {
  const { pr, diff, tour } = useSession()
  if (!tour) return null
  const stops = tourStops(tour.tour)

  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Overview</p>
        <h1 className={styles.title}>{pr.title}</h1>
        <div className={styles.statsRow}>
          <dl className={styles.stats}>
            <div>
              <dt>Files</dt>
              <dd>{diff.files.length}</dd>
            </div>
            <div>
              <dt>Lines</dt>
              <dd>
                <span className={styles.additions}>+{pr.additions}</span>{' '}
                <span className={styles.deletions}>−{pr.deletions}</span>
              </dd>
            </div>
            <div>
              <dt>Stops</dt>
              <dd>{stops.length}</dd>
            </div>
            <div>
              <dt>Guide</dt>
              <dd>
                {PROVIDER_NAMES[tour.provider]} · {tour.model}
                {tour.usage ? ` · ${formatUsage(tour.usage)}` : ''}
              </dd>
            </div>
          </dl>
          <Regenerate />
        </div>
      </header>

      <RegenerationStatus />
      <Markdown>{tour.tour.summary}</Markdown>
      <UntouredFiles files={diff.files.filter((file) => file.hunks.length === 0)} />
      <IntentSection intent={tour.tour.intent} />
      <RiskMap stops={stops} />
    </article>
  )
}

function UntouredFiles({ files }: { files: DiffFile[] }) {
  if (files.length === 0) return null
  return (
    <p className={styles.untoured}>
      Also changed, with no lines to review in the tour:{' '}
      {files.map((file, index) => (
        <span key={file.path}>
          {index > 0 ? ', ' : ''}
          <code>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</code> (
          {file.isBinary ? 'binary' : file.status})
        </span>
      ))}
      .
    </p>
  )
}

function Regenerate() {
  const running = useDojo((state) => state.tasks.tour !== undefined)
  const [confirming, setConfirming] = useState(false)
  const { generateTour } = useDojo.getState()
  if (running) return null

  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Regenerate
      </Button>
    )
  }
  return (
    <span className={styles.confirm}>
      Replace this tour?
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          setConfirming(false)
          void generateTour()
        }}
      >
        Regenerate
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  )
}

function RegenerationStatus() {
  const task = useDojo((state) => state.tasks.tour)
  const error = useDojo((state) => state.errors.tour)
  const { cancelTask, dismissError } = useDojo.getState()

  if (task) return <ActivityLog task={task} label="Regenerating the tour" onCancel={() => cancelTask('tour')} />
  if (!error) return null
  return (
    <ErrorNote title="The tour couldn't be regenerated. The current one is unchanged." message={error}>
      <Button size="sm" onClick={() => dismissError('tour')}>
        Dismiss
      </Button>
    </ErrorNote>
  )
}

function IntentSection({ intent }: { intent: IntentCheck }) {
  const unexplained = intent.unexplained.length
  return (
    <section className={styles.section} aria-labelledby="intent-heading">
      <h2 id="intent-heading" className={styles.sectionTitle}>
        Intent check
        {unexplained > 0 ? (
          <span className={styles.flag}>
            {unexplained} unexplained {unexplained === 1 ? 'change' : 'changes'}
          </span>
        ) : null}
      </h2>

      {intent.stated.length > 0 ? (
        <div>
          <h3 className={styles.subTitle}>The description promises</h3>
          <ul className={styles.stated}>
            {intent.stated.map((item, index) => (
              <li key={index}>
                <Markdown inline>{item}</Markdown>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.muted}>The description doesn't state an intent to check the code against.</p>
      )}

      {intent.claims.length > 0 ? (
        <div>
          <h3 className={styles.subTitle}>What the code delivers</h3>
          <ul className={styles.claims}>
            {intent.claims.map((claim, index) => (
              <li key={index} className={styles.claim}>
                <span className={styles.status} data-status={claim.status}>
                  {claim.status}
                </span>
                <div className={styles.claimBody}>
                  <p className={styles.claimText}>{claim.claim}</p>
                  <div className={styles.evidence}>
                    <Markdown>{claim.evidence}</Markdown>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {unexplained > 0 ? (
        <div className={styles.unexplained}>
          <h3 className={styles.subTitle}>Changes the intent doesn't explain</h3>
          <ul className={styles.unexplainedList}>
            {intent.unexplained.map((item, index) => (
              <li key={index}>
                <Markdown inline>{item.description}</Markdown>
                {item.hunkIds.length > 0 ? (
                  <span className={styles.chips}>
                    {item.hunkIds.map((hunkId) => (
                      <HunkChip key={hunkId} hunkId={hunkId} />
                    ))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.clean}>
          <CheckIcon /> Every change traces back to the stated intent.
        </p>
      )}
    </section>
  )
}

function HunkChip({ hunkId }: { hunkId: string }) {
  const { diff, tour } = useSession()
  const { select } = useDojo.getState()
  const hunk = findHunk(diff, hunkId)
  const stop = tour ? stopForHunk(tour.tour, hunkId) : undefined
  const label = hunk ? `${hunk.path.slice(hunk.path.lastIndexOf('/') + 1)}:${hunk.newStart}` : hunkId

  return (
    <button
      type="button"
      className={styles.chip}
      disabled={!stop}
      title={hunk ? `${hunk.path} ${hunk.header}${stop ? ` · in “${stop.title}”` : ''}` : undefined}
      onClick={() => stop && select(stop.id)}
    >
      {label}
    </button>
  )
}

function RiskMap({ stops }: { stops: Stop[] }) {
  const { review } = useSession()
  const { select } = useDojo.getState()
  const risky = [...stops.filter((stop) => stop.risk === 'high'), ...stops.filter((stop) => stop.risk === 'medium')]

  return (
    <section className={styles.section} aria-labelledby="risk-heading">
      <h2 id="risk-heading" className={styles.sectionTitle}>
        Risk map
      </h2>
      {risky.length === 0 ? (
        <p className={styles.muted}>No stop is rated medium or high risk.</p>
      ) : (
        <ul className={styles.risks}>
          {risky.map((stop) => (
            <li key={stop.id}>
              <button type="button" className={styles.risk} onClick={() => select(stop.id)}>
                <RiskBadge risk={stop.risk} />
                <span className={styles.riskText}>
                  <span className={styles.riskTitle}>
                    <InlineCode>{stop.title}</InlineCode>
                  </span>
                  <span className={styles.riskReason}>
                    <InlineCode>{stop.riskReason}</InlineCode>
                  </span>
                </span>
                {review.stops[stop.id]?.understood ? (
                  <span className={styles.understood} role="img" aria-label="Understood">
                    <CheckIcon />
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
