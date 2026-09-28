import { useEffect, useRef, useState } from 'react'
import { findStop } from '../../../shared/tour'
import type { CodeSelection } from '../../../shared/types'
import { selectionLabel } from '../lib/comments'
import { useDojo, usePreviewing, useSession, useTour } from '../store'
import { ActivityLog } from './ActivityLog'
import styles from './AskPanel.module.css'
import { Button } from './Button'
import { ErrorNote } from './ErrorNote'
import { CloseIcon } from './icons'
import { InlineCode, Markdown } from './Markdown'

const STOP_STARTERS = [
  'What calls this?',
  'What breaks if this input is empty?',
  'Why this approach over the existing pattern?',
  'How is this tested?',
]

const OVERVIEW_STARTERS = [
  'Where should I start reading?',
  'What is the riskiest part of this change?',
  'Which changes are least related to the stated intent?',
]

export function AskPanel({ embedded = false }: { embedded?: boolean }) {
  const { review } = useSession()
  const tour = useTour()
  const previewing = usePreviewing()
  const stopId = useDojo((state) => state.selectedStopId)
  const pending = useDojo((state) => state.tasks.ask)
  const error = useDojo((state) => state.errors.ask)
  const focusRequest = useDojo((state) => state.askFocusRequest)
  const selection = useDojo((state) => state.askSelection)
  const { ask, askAbout, cancelTask, dismissError, setAskOpen } = useDojo.getState()
  const [showAll, setShowAll] = useState(false)
  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const followsLatest = useRef(true)

  const messages = showAll ? review.chat : review.chat.filter((message) => message.stopId === stopId)
  const stopTitle = (id: string | null) => (id && tour ? findStop(tour, id)?.stop.title : null) ?? 'Overview'

  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus()
  }, [focusRequest])

  useEffect(() => {
    followsLatest.current = true
  }, [messages.length])

  useEffect(() => {
    if (followsLatest.current) logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages.length, pending?.eventCount, pending?.draft])

  const send = (text: string) => {
    if (!text.trim() || pending || previewing) return
    void ask(text.trim())
    setQuestion('')
  }

  return (
    <aside className={styles.panel} data-embedded={embedded} aria-label="Ask">
      <header className={styles.header}>
        {embedded ? null : <h2 className={styles.title}>Ask</h2>}
        <span className={styles.scope}>
          {showAll ? 'Whole conversation' : <InlineCode>{stopTitle(stopId)}</InlineCode>}
        </span>
        <Button size="sm" variant="ghost" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>
          All
        </Button>
        {embedded ? null : (
          <Button
            size="sm"
            variant="ghost"
            aria-label="Close Ask"
            title="Close (Esc)"
            onClick={() => setAskOpen(false)}
          >
            <CloseIcon />
          </Button>
        )}
      </header>

      <div
        ref={logRef}
        className={styles.log}
        onScroll={(event) => {
          const log = event.currentTarget
          followsLatest.current = log.scrollHeight - log.scrollTop - log.clientHeight < 40
        }}
      >
        {previewing ? (
          <p className={styles.muted}>
            Ask opens once the tour is finished, so answers can build on everything the agent explored for it.
          </p>
        ) : null}
        {messages.length === 0 && !pending && !previewing ? (
          <div className={styles.starters}>
            <p className={styles.muted}>
              Questions go to the same agent that wrote the tour, with this {stopId ? 'stop' : 'pull request'} in view.
            </p>
            {(stopId ? STOP_STARTERS : OVERVIEW_STARTERS).map((starter) => (
              <button key={starter} type="button" className={styles.starter} onClick={() => send(starter)}>
                {starter}
              </button>
            ))}
          </div>
        ) : null}
        {messages.map((message) => (
          <div key={message.id} className={styles.message} data-role={message.role}>
            {showAll && message.role === 'user' ? (
              <p className={styles.context}>
                <InlineCode>{stopTitle(message.stopId)}</InlineCode>
              </p>
            ) : null}
            {message.role === 'user' ? (
              <div className={styles.question}>
                {message.selection ? <SelectionChip selection={message.selection} /> : null}
                <p>{message.text}</p>
              </div>
            ) : (
              <Markdown>{message.text}</Markdown>
            )}
          </div>
        ))}
        {pending?.draft ? (
          <div className={styles.message} data-role="assistant">
            <Markdown>{pending.draft}</Markdown>
          </div>
        ) : null}
        {pending ? (
          <ActivityLog
            task={pending}
            label={pending.draft ? 'Writing' : 'Thinking'}
            limit={3}
            quiet={pending.draft !== null}
            onCancel={() => cancelTask('ask')}
          />
        ) : null}
        {error ? (
          <ErrorNote title="Couldn't get an answer" message={error}>
            <Button size="sm" onClick={() => dismissError('ask')}>
              Dismiss
            </Button>
          </ErrorNote>
        ) : null}
      </div>

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault()
          send(question)
        }}
      >
        {selection ? (
          <div className={styles.attached}>
            <SelectionChip selection={selection} />
            <button
              type="button"
              className={styles.remove}
              aria-label="Stop asking about these lines"
              title="Remove"
              onClick={() => askAbout(null)}
            >
              <CloseIcon />
            </button>
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          rows={3}
          value={question}
          disabled={previewing}
          aria-label="Ask a question"
          placeholder={
            previewing
              ? 'Available when the tour is finished'
              : selection
                ? 'Ask about these lines'
                : stopId
                  ? 'Ask about this stop'
                  : 'Ask about this pull request'
          }
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send(question)
            } else if (event.key === 'Escape') {
              event.currentTarget.blur()
            }
          }}
        />
        <p className={styles.hint}>
          <kbd>↵</kbd> send · <kbd>⇧</kbd> <kbd>↵</kbd> new line
        </p>
      </form>
    </aside>
  )
}

function SelectionChip({ selection }: { selection: CodeSelection }) {
  const { setOverlay } = useDojo.getState()
  const label = selectionLabel(selection)

  const peek = () => {
    const location = { startLine: selection.startLine, endLine: selection.endLine }
    if (selection.side === 'RIGHT') {
      setOverlay({ kind: 'peek', target: { path: selection.path, ...location } })
      return
    }
    setOverlay({
      kind: 'peek',
      target: {
        path: selection.path,
        ...location,
        why: `You asked about lines ${selection.startLine}–${selection.endLine} of the old version of \`${selection.path}\`. This shows the file at the pull request's head, where those lines may differ.`,
      },
    })
  }

  return (
    <button type="button" className={styles.chip} title={`Peek at ${label}`} onClick={peek}>
      <code>{label}</code>
    </button>
  )
}
