import { useEffect, useMemo, useState } from 'react'
import { tourToMarkdown } from '../../../shared/guide'
import { PROVIDER_NAMES } from '../../../shared/providers'
import type { DiffFile, IntentCheck, PreviousReview, Stop, TeamLessons, Tour } from '../../../shared/types'
import { dojo, errorMessage } from '../api'
import { formatUsage, relativeTime } from '../lib/format'
import { changedPathsByStop } from '../lib/locate'
import { findHunk, stopForHunk, tourStops } from '../../../shared/tour'
import { useDojo, usePreviewing, useSession, useTour } from '../store'
import { ActivityLog } from './ActivityLog'
import { Button } from './Button'
import { OpenDiscussion } from './Discussion'
import { ErrorNote } from './ErrorNote'
import { CheckIcon, ExternalIcon } from './icons'
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
      {review.previous ? <ChangesSinceReview previous={review.previous} tour={tour} /> : null}
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

function ChangesSinceReview({ previous, tour }: { previous: PreviousReview; tour: Tour }) {
  const { diff } = useSession()
  const { select } = useDojo.getState()
  const byStop = useMemo(() => changedPathsByStop(tour, diff, previous.changedPaths), [tour, diff, previous])
  const count = previous.changedPaths.length
  const firstStop = (path: string) => [...byStop].find(([, paths]) => paths.includes(path))?.[0]
  const inDiff = new Set(diff.files.map((file) => file.path))

  return (
    <section className={styles.changes} aria-labelledby="changes-heading">
      <h2 id="changes-heading" className={styles.changesTitle}>
        You reviewed an earlier version ({previous.headSha.slice(0, 7)}).{' '}
        {count === 0 ? 'No file changed since.' : `${count} ${count === 1 ? 'file' : 'files'} changed since.`}
      </h2>
      {count > 0 ? (
        <ul className={styles.changedList}>
          {previous.changedPaths.map((path) => {
            const stopId = firstStop(path)
            return (
              <li key={path}>
                {stopId ? (
                  <button type="button" className={styles.changedPath} onClick={() => select(stopId)}>
                    {path}
                  </button>
                ) : (
                  <span className={styles.changedPlain}>
                    <code>{path}</code>
                    {inDiff.has(path) ? null : ' (no longer in the pull request)'}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

function LessonsSection({ lessons }: { lessons: TeamLessons | null }) {
  const task = useDojo((state) => state.tasks.lessons)
  const error = useDojo((state) => state.errors.lessons)
  const { refreshLessons, cancelTask, dismissError } = useDojo.getState()
  const count = lessons?.lessons.length ?? 0

  const status = (
    <>
      {task ? (
        <ActivityLog task={task} label="Learning from past reviews" limit={3} onCancel={() => cancelTask('lessons')} />
      ) : null}
      {error ? (
        <ErrorNote title="Couldn't refresh the team's review lessons" message={error}>
          <Button size="sm" onClick={() => dismissError('lessons')}>
            Dismiss
          </Button>
        </ErrorNote>
      ) : null}
    </>
  )
  const refresh = (
    <Button size="sm" variant="ghost" disabled={task !== undefined} onClick={() => void refreshLessons()}>
      {lessons ? 'Refresh' : 'Learn now'}
    </Button>
  )

  if (!lessons || count === 0) {
    return (
      <section className={styles.section} aria-labelledby="lessons-heading">
        <h2 id="lessons-heading" className={styles.sectionTitle}>
          Team review lessons
        </h2>
        <p className={styles.lessonsEmpty}>
          <span className={styles.muted}>
            {lessons
              ? `No recurring expectations stood out in ${lessons.sourceCount} past review comments.`
              : "Lessons come from this repository's past review comments and are learned when a tour is generated."}
          </span>
          {refresh}
        </p>
        {status}
      </section>
    )
  }

  return (
    <details className={styles.lessons}>
      <summary className={styles.sectionTitle}>
        Team review lessons <span className={styles.lessonCount}>{count}</span>
      </summary>
      <div className={styles.lessonsBody}>
        <p className={styles.lessonsMeta}>
          <span>
            Learned from {lessons.sourceCount} review comments · {relativeTime(lessons.generatedAt)}
          </span>
          {refresh}
        </p>
        {status}
        <ol className={styles.lessonList}>
          {lessons.lessons.map((lesson, index) => (
            <li key={index} className={styles.lesson}>
              <p className={styles.lessonTitle}>{lesson.title}</p>
              <Markdown>{lesson.detail}</Markdown>
              {lesson.examples.length > 0 ? (
                <p className={styles.examples}>
                  Seen in{' '}
                  {exampleLabels(lesson.examples).map(({ url, label }) => (
                    <button
                      key={url}
                      type="button"
                      className={styles.example}
                      title={url}
                      onClick={() => void dojo.openExternal(url)}
                    >
                      {label}
                      <ExternalIcon />
                    </button>
                  ))}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </details>
  )
}

/** Several examples often come from one pull request, so repeats are numbered to tell the links apart. */
function exampleLabels(urls: string[]): { url: string; label: string }[] {
  const seen = new Map<string, number>()
  return urls.map((url) => {
    const pull = /\/pull\/(\d+)/.exec(url)?.[1]
    const base = pull ? `#${pull}` : 'comment'
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return { url, label: count === 1 ? base : `${base} (${count})` }
  })
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
      Replace this tour and reset your progress on it?
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
  const { diff } = useSession()
  const tour = useTour()
  const { select } = useDojo.getState()
  const hunk = findHunk(diff, hunkId)
  const stop = tour ? stopForHunk(tour, hunkId) : undefined
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
