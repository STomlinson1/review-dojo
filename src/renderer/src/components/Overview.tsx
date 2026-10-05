import { useEffect, useState } from 'react'
import { tourToMarkdown } from '../../../shared/guide'
import { PROVIDER_NAMES } from '../../../shared/providers'
import { tourStops } from '../../../shared/tour'
import type { DiffFile, Stop, Tour } from '../../../shared/types'
import { errorMessage } from '../api'
import { formatUsage } from '../lib/format'
import { useDojo, usePreviewing, useSession, useTour } from '../store'
import { ActivityLog } from './ActivityLog'
import { Button } from './Button'
import { ChangesSinceReview } from './ChangesSinceReview'
import { OpenDiscussion } from './Discussion'
import { ErrorNote } from './ErrorNote'
import { CheckIcon } from './icons'
import { IntentSection } from './Intent'
import { LessonsSection } from './Lessons'
import { InlineCode, Markdown } from './Markdown'
import styles from './Overview.module.css'
import { RiskBadge } from './Risk'

export function Overview() {
  const { pr, diff, review, lessons, tour: record } = useSession()
  const tour = useTour()
  const previewing = usePreviewing()
  if (!tour) return null
  const stops = tourStops(tour)

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
              <dd>{previewing ? `${stops.length} so far` : stops.length}</dd>
            </div>
            <div>
              <dt>Guide</dt>
              <dd>
                {previewing || !record
                  ? 'Writing…'
                  : `${PROVIDER_NAMES[record.provider]} · ${record.model}${record.usage ? ` · ${formatUsage(record.usage)}` : ''}`}
              </dd>
            </div>
          </dl>
          {previewing ? null : (
            <div className={styles.actions}>
              <CopyGuide tour={tour} />
              <Regenerate />
            </div>
          )}
        </div>
      </header>

      {previewing ? null : <RegenerationStatus />}
      {review.previous ? <ChangesSinceReview previous={review.previous} /> : null}
      <Markdown>{tour.summary}</Markdown>
      <UntouredFiles files={diff.files.filter((file) => file.hunks.length === 0)} />
      <IntentSection intent={tour.intent} />
      <OpenDiscussion />
      <RiskMap stops={stops} />
      <LessonsSection lessons={lessons} />
    </article>
  )
}

const COPIED_NOTICE_MS = 2000

type CopyState = { status: 'idle' } | { status: 'copied' } | { status: 'failed'; message: string }

function CopyGuide({ tour }: { tour: Tour }) {
  const { pr, diff } = useSession()
  const [copy, setCopy] = useState<CopyState>({ status: 'idle' })

  useEffect(() => {
    if (copy.status !== 'copied') return
    const timer = setTimeout(() => setCopy({ status: 'idle' }), COPIED_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [copy])

  const run = () =>
    navigator.clipboard.writeText(tourToMarkdown(pr, tour, diff)).then(
      () => setCopy({ status: 'copied' }),
      (error: unknown) => setCopy({ status: 'failed', message: errorMessage(error) }),
    )

  return (
    <>
      {copy.status === 'failed' ? (
        <span className={styles.copyFailed} role="alert">
          Couldn't copy: {copy.message}
        </span>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        aria-live="polite"
        title="Copy the tour as Markdown, for example to share in the pull request"
        onClick={() => void run()}
      >
        {copy.status === 'copied' ? (
          <>
            <CheckIcon />
            Copied
          </>
        ) : (
          "Copy reviewer's guide"
        )}
      </Button>
    </>
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
      Write a new tour? Your progress on this one is cleared only if the new one replaces it.
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
