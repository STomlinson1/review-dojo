import { useMemo, useState } from 'react'
import type {
  CodeLocation,
  ComprehensionQuestion,
  ContextRef,
  ConventionNote,
  StopProgress,
} from '../../../shared/types'
import { formatLocation } from '../lib/codeRefs'
import { EMPTY_PROGRESS, findStop, selectHunks, tourStops } from '../../../shared/tour'
import { useDojo, usePreviewing, useSession, useTour } from '../store'
import { ActivityLog } from './ActivityLog'
import { Button } from './Button'
import { ErrorNote } from './ErrorNote'
import { FileDiffView } from './FileDiffView'
import { InlineCode, Markdown } from './Markdown'
import { RiskBadge } from './Risk'
import styles from './StopView.module.css'

export function StopView({ stopId, showDiffs }: { stopId: string; showDiffs: boolean }) {
  const { diff, review } = useSession()
  const tour = useTour()
  const dojoMode = useDojo((state) => state.dojoMode)
  const found = tour ? findStop(tour, stopId) : null
  const hunkIdsKey = found?.stop.hunkIds.join(' ') ?? ''
  const files = useMemo(() => {
    const wanted = new Set(hunkIdsKey.split(' '))
    return selectHunks(diff, (hunk) => wanted.has(hunk.id))
  }, [diff, hunkIdsKey])

  if (!found) return <p className={styles.missing}>This stop isn't part of the current tour.</p>
  const { stop, chapter } = found
  const progress = review.stops[stop.id] ?? EMPTY_PROGRESS
  const gated = dojoMode && stop.question !== null && !progress.revealed

  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <p className={styles.crumb}>
          <span className={styles.chapter}>
            <InlineCode>{chapter.title}</InlineCode>
          </span>
          <span className={styles.goal}>
            {' · '}
            <InlineCode>{chapter.goal}</InlineCode>
          </span>
        </p>
        <h1 className={styles.title}>
          <InlineCode>{stop.title}</InlineCode>
        </h1>
        <p className={styles.risk}>
          <RiskBadge risk={stop.risk} />
          <Markdown inline>{stop.riskReason}</Markdown>
        </p>
      </header>

      {dojoMode && stop.question ? <DojoCard stopId={stop.id} question={stop.question} progress={progress} /> : null}

      {gated ? null : (
        <div className={styles.reading}>
          <Markdown>{stop.explanation}</Markdown>
        </div>
      )}

      {files.length === 0 ? (
        <p className={styles.muted}>This stop changes no lines. It points at related code to read.</p>
      ) : showDiffs ? (
        <section className={styles.diffs} aria-label="Changes in this stop">
          {files.map(({ file, hunks }) => (
            <FileDiffView key={file.path} file={file} hunks={hunks} stopId={stop.id} />
          ))}
        </section>
      ) : null}

      {gated ? null : (
        <div className={styles.reading}>
          {!dojoMode && stop.question ? <QuestionDisclosure question={stop.question} /> : null}
          <Checks stopId={stop.id} checks={stop.checks} done={progress.checksDone} />
          <Conventions notes={stop.conventions} />
          <ReadAlso refs={stop.context} />
        </div>
      )}

      <StopFooter stopId={stop.id} understood={progress.understood} />
    </article>
  )
}

function DojoCard({
  stopId,
  question,
  progress,
}: {
  stopId: string
  question: ComprehensionQuestion
  progress: StopProgress
}) {
  const taskKey = `grade:${stopId}` as const
  const grading = useDojo((state) => state.tasks[taskKey])
  const gradeError = useDojo((state) => state.errors[taskKey])
  const previewing = usePreviewing()
  const { updateStop, gradePrediction, cancelTask } = useDojo.getState()
  const hasPrediction = progress.prediction.trim().length > 0
  const predictionId = `prediction-${stopId}`
  const feedback = grading?.draft ?? progress.predictionFeedback

  if (!progress.revealed) {
    return (
      <section className={styles.dojo} aria-label="Predict before you read">
        <p className={styles.dojoLabel}>Before you read</p>
        <Markdown>{question.prompt}</Markdown>
        <label htmlFor={predictionId} className={styles.fieldLabel}>
          Your prediction
        </label>
        <textarea
          id={predictionId}
          rows={4}
          value={progress.prediction}
          onChange={(event) => updateStop(stopId, { prediction: event.target.value })}
          placeholder="Read the diff, then commit to an answer in your own words."
        />
        <div className={styles.dojoActions}>
          <Button variant="primary" disabled={!hasPrediction} onClick={() => updateStop(stopId, { revealed: true })}>
            Reveal
          </Button>
          <span className={styles.hint}>The explanation stays hidden until you reveal.</span>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.dojo} aria-label="Your prediction and the answer">
      <p className={styles.dojoLabel}>Check your read</p>
      <Markdown>{question.prompt}</Markdown>
      {hasPrediction ? (
        <div>
          <p className={styles.fieldLabel}>You predicted</p>
          <p className={styles.prediction}>{progress.prediction}</p>
        </div>
      ) : null}
      <div>
        <p className={styles.fieldLabel}>Answer</p>
        <Markdown>{question.answer}</Markdown>
      </div>
      {feedback ? (
        <div className={styles.feedback}>
          <p className={styles.fieldLabel}>Feedback on your read</p>
          <Markdown>{feedback}</Markdown>
        </div>
      ) : null}
      {grading ? (
        <ActivityLog
          task={grading}
          label="Grading your read"
          limit={3}
          quiet={grading.draft !== null}
          onCancel={() => cancelTask(taskKey)}
        />
      ) : hasPrediction ? (
        <div className={styles.dojoActions}>
          <Button disabled={previewing} onClick={() => void gradePrediction(stopId)}>
            {progress.predictionFeedback ? 'Grade again' : 'Grade my read'}
          </Button>
          {previewing ? <span className={styles.hint}>Grading opens once the tour is finished.</span> : null}
        </div>
      ) : null}
      {gradeError ? <ErrorNote title="Couldn't grade your read" message={gradeError} /> : null}
    </section>
  )
}

function QuestionDisclosure({ question }: { question: ComprehensionQuestion }) {
  const [answerShown, setAnswerShown] = useState(false)
  return (
    <details className={styles.question}>
      <summary>Check your understanding</summary>
      <div className={styles.questionBody}>
        <Markdown>{question.prompt}</Markdown>
        {answerShown ? (
          <div className={styles.answer}>
            <Markdown>{question.answer}</Markdown>
          </div>
        ) : (
          <Button size="sm" onClick={() => setAnswerShown(true)}>
            Reveal answer
          </Button>
        )}
      </div>
    </details>
  )
}

function Checks({ stopId, checks, done }: { stopId: string; checks: string[]; done: number[] }) {
  const { updateStop } = useDojo.getState()
  if (checks.length === 0) return null

  const toggle = (index: number) =>
    updateStop(stopId, {
      checksDone: done.includes(index) ? done.filter((item) => item !== index) : [...done, index].sort((a, b) => a - b),
    })

  return (
    <section className={styles.block} aria-labelledby={`checks-${stopId}`}>
      <h2 id={`checks-${stopId}`} className={styles.blockTitle}>
        Verify{' '}
        <span className={styles.count}>
          {done.length}/{checks.length}
        </span>
      </h2>
      <ul className={styles.checks}>
        {checks.map((check, index) => (
          <li key={index} className={styles.checkItem}>
            <input
              type="checkbox"
              id={`check-${stopId}-${index}`}
              checked={done.includes(index)}
              onChange={() => toggle(index)}
            />
            <label htmlFor={`check-${stopId}-${index}`} data-done={done.includes(index)}>
              <Markdown inline>{check}</Markdown>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Conventions({ notes }: { notes: ConventionNote[] }) {
  if (notes.length === 0) return null
  return (
    <section className={styles.block} aria-label="Conventions">
      <h2 className={styles.blockTitle}>Conventions</h2>
      {notes.map((note, index) => (
        <div key={index} className={styles.callout}>
          <Markdown>{note.observation}</Markdown>
          {note.precedents.length > 0 ? (
            <p className={styles.precedents}>
              Precedent{note.precedents.length > 1 ? 's' : ''}:{' '}
              {note.precedents.map((precedent, precedentIndex) => (
                <LocationLink key={precedentIndex} location={precedent} />
              ))}
            </p>
          ) : null}
        </div>
      ))}
    </section>
  )
}

function ReadAlso({ refs }: { refs: ContextRef[] }) {
  if (refs.length === 0) return null
  return (
    <section className={styles.block} aria-label="Read also">
      <h2 className={styles.blockTitle}>Read also</h2>
      <ul className={styles.refs}>
        {refs.map((ref, index) => (
          <li key={index}>
            <LocationLink location={ref} />
            <span className={styles.why}>
              <Markdown inline>{ref.why}</Markdown>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function LocationLink({ location }: { location: CodeLocation | ContextRef }) {
  const { setOverlay } = useDojo.getState()
  return (
    <button type="button" className={styles.location} onClick={() => setOverlay({ kind: 'peek', target: location })}>
      {formatLocation(location)}
    </button>
  )
}

function StopFooter({ stopId, understood }: { stopId: string; understood: boolean }) {
  const tour = useTour()
  const previewing = usePreviewing()
  const { step, updateStop, setOverlay } = useDojo.getState()
  const stops = tour ? tourStops(tour) : []
  const index = stops.findIndex((stop) => stop.id === stopId)
  const isLast = index === stops.length - 1
  const awaitingNext = isLast && previewing

  return (
    <footer className={styles.footer}>
      <Button variant="ghost" onClick={() => step(-1)}>
        {index === 0 ? '← Overview' : '← Previous'}
      </Button>
      <div className={styles.footerActions}>
        {awaitingNext ? <span className={styles.hint}>The next stop is still being written.</span> : null}
        <label className={styles.understood}>
          <input
            type="checkbox"
            checked={understood}
            onChange={() => updateStop(stopId, { understood: !understood })}
          />
          Understood
        </label>
        {awaitingNext ? null : (
          <Button
            variant="primary"
            onClick={() => {
              updateStop(stopId, { understood: true })
              if (isLast) setOverlay({ kind: 'submit' })
              else step(1)
            }}
          >
            {isLast ? 'Mark understood & review' : 'Mark understood & next'}
          </Button>
        )}
        {isLast ? null : (
          <Button variant="ghost" onClick={() => step(1)}>
            Next →
          </Button>
        )}
      </div>
    </footer>
  )
}
