import { useState } from 'react'
import { draftProblem } from '../../../shared/review'
import type { DraftComment, ReviewEvent } from '../../../shared/types'
import { docent, errorMessage } from '../api'
import { lineLabel } from '../lib/comments'
import { tourStops } from '../../../shared/tour'
import { useDocent, useSession } from '../store'
import { ActivityLog } from './ActivityLog'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { ErrorNote } from './ErrorNote'
import { ExternalIcon } from './icons'
import { InlineCode } from './Markdown'
import styles from './SubmitPanel.module.css'

const EVENTS: { value: ReviewEvent; label: string }[] = [
  { value: 'PENDING', label: 'Pending — finish on GitHub' },
  { value: 'COMMENT', label: 'Comment' },
  { value: 'APPROVE', label: 'Approve' },
  { value: 'REQUEST_CHANGES', label: 'Request changes' },
]

type Submission =
  { status: 'idle' } | { status: 'confirming' } | { status: 'submitting' } | { status: 'failed'; message: string }

export function SubmitPanel({ onClose }: { onClose(): void }) {
  const { diff, tour, review } = useSession()
  const { setReviewBody, submitReview, select } = useDocent.getState()
  const [event, setEvent] = useState<ReviewEvent>('PENDING')
  const [submission, setSubmission] = useState<Submission>({ status: 'idle' })

  const problems = new Map(review.drafts.map((draft) => [draft.id, draftProblem(draft, diff)]))
  const blocked = [...problems.values()].some((problem) => problem !== null)
  const unread = tour ? tourStops(tour.tour).filter((stop) => !review.stops[stop.id]?.understood) : []
  const byFile = Map.groupBy(review.drafts, (draft) => draft.path)
  const eventLabel = EVENTS.find((option) => option.value === event)?.label ?? event

  const submit = async () => {
    setSubmission({ status: 'submitting' })
    try {
      await submitReview(event)
      setSubmission({ status: 'idle' })
    } catch (error) {
      setSubmission({ status: 'failed', message: errorMessage(error) })
    }
  }

  const goTo = (stopId: string | null) => {
    if (stopId) select(stopId)
    onClose()
  }

  const footer = (
    <>
      <label className={styles.eventLabel} htmlFor="review-event">
        Submit as
      </label>
      <select
        id="review-event"
        className={styles.event}
        value={event}
        disabled={submission.status === 'submitting'}
        onChange={(change) => {
          setEvent(change.target.value as ReviewEvent)
          setSubmission({ status: 'idle' })
        }}
      >
        {EVENTS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {submission.status === 'confirming' ? (
        <>
          <Button variant="ghost" onClick={() => setSubmission({ status: 'idle' })}>
            Back
          </Button>
          <Button variant={event === 'REQUEST_CHANGES' ? 'danger' : 'primary'} onClick={() => void submit()}>
            Publish as {eventLabel}
          </Button>
        </>
      ) : (
        <Button
          variant="primary"
          disabled={blocked || submission.status === 'submitting'}
          onClick={() => (event === 'PENDING' ? void submit() : setSubmission({ status: 'confirming' }))}
        >
          {submission.status === 'submitting'
            ? 'Submitting…'
            : event === 'PENDING'
              ? 'Create pending review'
              : 'Submit review'}
        </Button>
      )}
    </>
  )

  return (
    <Dialog
      title="Review"
      subtitle={`${review.drafts.length} draft ${review.drafts.length === 1 ? 'comment' : 'comments'}`}
      variant="drawer"
      onClose={onClose}
      footer={footer}
    >
      <div className={styles.content}>
        {review.submittedReviewUrl ? (
          <div className={styles.submitted} role="status">
            <span>Your review was sent to GitHub.</span>
            <Button
              size="sm"
              onClick={() => review.submittedReviewUrl && void docent.openExternal(review.submittedReviewUrl)}
            >
              <ExternalIcon />
              Open on GitHub
            </Button>
          </div>
        ) : null}

        {review.carriedFromSha && review.drafts.length > 0 ? (
          <section className={styles.coverage} aria-labelledby="carried-heading">
            <h3 id="carried-heading" className={styles.coverageTitle}>
              These drafts were written against an earlier commit ({review.carriedFromSha.slice(0, 7)})
            </h3>
            <p>The pull request has new commits since. Check that each comment still sits on the line you meant.</p>
          </section>
        ) : null}

        {unread.length > 0 ? (
          <section className={styles.coverage} aria-labelledby="coverage-heading">
            <h3 id="coverage-heading" className={styles.coverageTitle}>
              {unread.length} {unread.length === 1 ? 'stop isn’t' : 'stops aren’t'} marked understood yet
            </h3>
            <ul className={styles.unread}>
              {unread.map((stop) => (
                <li key={stop.id}>
                  <button type="button" className={styles.link} onClick={() => goTo(stop.id)}>
                    <InlineCode>{stop.title}</InlineCode>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={styles.section} aria-label="Comments">
          {review.drafts.length === 0 ? (
            <p className={styles.muted}>
              No comments yet. Select lines in a diff, or use the + in its gutter, to draft one.
            </p>
          ) : (
            [...byFile].map(([path, drafts]) => (
              <div key={path} className={styles.file}>
                <h3 className={styles.path}>{path}</h3>
                {drafts.map((draft) => (
                  <DraftEditor
                    key={draft.id}
                    draft={draft}
                    problem={problems.get(draft.id) ?? null}
                    onLocate={() => goTo(draft.stopId)}
                  />
                ))}
              </div>
            ))
          )}
        </section>

        <section className={styles.section}>
          <label htmlFor="review-body" className={styles.label}>
            Overall comment
          </label>
          <textarea
            id="review-body"
            rows={5}
            value={review.body}
            placeholder="Summarize your review. Optional for a pending review."
            onChange={(change) => setReviewBody(change.target.value)}
          />
        </section>

        {submission.status === 'confirming' ? (
          <p className={styles.confirm} role="alert">
            This publishes your review on GitHub as <strong>{eventLabel}</strong>, visible to the author right away.
          </p>
        ) : null}
        {blocked ? (
          <p className={styles.blocked}>
            Fix the comments marked above before submitting; GitHub would reject the whole review.
          </p>
        ) : null}
        {submission.status === 'failed' ? (
          <ErrorNote title="The review wasn't submitted" message={submission.message} />
        ) : null}
      </div>
    </Dialog>
  )
}

function DraftEditor({ draft, problem, onLocate }: { draft: DraftComment; problem: string | null; onLocate(): void }) {
  const suggestion = useDocent((state) => state.polishSuggestions[draft.id])
  const polishing = useDocent((state) => state.tasks[`polish:${draft.id}`])
  const polishError = useDocent((state) => state.errors[`polish:${draft.id}`])
  const { updateDraft, deleteDraft, polishDraft, resolvePolish, cancelTask } = useDocent.getState()

  return (
    <div className={styles.draft} data-problem={problem !== null}>
      <div className={styles.draftHeader}>
        <button type="button" className={styles.link} disabled={!draft.stopId} onClick={onLocate}>
          {lineLabel(draft)}
        </button>
        <Button
          size="sm"
          variant="ghost"
          disabled={polishing !== undefined || !draft.body.trim()}
          onClick={() => void polishDraft(draft.id)}
        >
          Polish
        </Button>
        <Button size="sm" variant="ghost" onClick={() => deleteDraft(draft.id)}>
          Delete
        </Button>
      </div>
      <textarea
        rows={3}
        value={draft.body}
        aria-label={`Comment on ${draft.path} ${lineLabel(draft)}`}
        onChange={(change) => updateDraft(draft.id, change.target.value)}
      />
      {problem ? <p className={styles.problem}>{problem}</p> : null}
      {polishing ? (
        <ActivityLog task={polishing} label="Polishing" limit={2} onCancel={() => cancelTask(`polish:${draft.id}`)} />
      ) : null}
      {polishError ? <ErrorNote title="Couldn't polish this comment" message={polishError} /> : null}
      {suggestion !== undefined ? (
        <div className={styles.suggestion}>
          <div>
            <p className={styles.suggestionLabel}>Yours</p>
            <p className={styles.suggestionText}>{draft.body}</p>
          </div>
          <div>
            <p className={styles.suggestionLabel}>Suggested</p>
            <p className={styles.suggestionText}>{suggestion}</p>
          </div>
          <div className={styles.suggestionActions}>
            <Button size="sm" variant="ghost" onClick={() => resolvePolish(draft.id, false)}>
              Discard
            </Button>
            <Button size="sm" variant="primary" onClick={() => resolvePolish(draft.id, true)}>
              Use suggestion
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
