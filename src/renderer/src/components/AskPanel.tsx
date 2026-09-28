import { useEffect, useRef, useState } from 'react'
import { findStop } from '../../../shared/tour'
import { useDojo, useSession } from '../store'
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

export function AskPanel() {
  const { tour, review } = useSession()
  const stopId = useDojo((state) => state.selectedStopId)
  const pending = useDojo((state) => state.tasks.ask)
  const error = useDojo((state) => state.errors.ask)
  const focusRequest = useDojo((state) => state.askFocusRequest)
  const { ask, cancelTask, dismissError, setAskOpen } = useDojo.getState()
  const [showAll, setShowAll] = useState(false)
  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const messages = showAll ? review.chat : review.chat.filter((message) => message.stopId === stopId)
  const stopTitle = (id: string | null) => (id && tour ? findStop(tour.tour, id)?.stop.title : null) ?? 'Overview'

  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus()
  }, [focusRequest])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages.length, pending?.eventCount])

  const send = (text: string) => {
    if (!text.trim() || pending) return
    void ask(text.trim())
    setQuestion('')
  }

  return (
    <aside className={styles.panel} aria-label="Ask">
      <header className={styles.header}>
        <h2 className={styles.title}>Ask</h2>
        <span className={styles.scope}>
          {showAll ? 'Whole conversation' : <InlineCode>{stopTitle(stopId)}</InlineCode>}
        </span>
        <Button size="sm" variant="ghost" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>
          All
        </Button>
        <Button size="sm" variant="ghost" aria-label="Close Ask" title="Close (Esc)" onClick={() => setAskOpen(false)}>
          <CloseIcon />
        </Button>
      </header>

      <div ref={logRef} className={styles.log}>
        {messages.length === 0 && !pending ? (
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
              <p className={styles.question}>{message.text}</p>
            ) : (
              <Markdown>{message.text}</Markdown>
            )}
          </div>
        ))}
        {pending ? <ActivityLog task={pending} label="Thinking" limit={3} onCancel={() => cancelTask('ask')} /> : null}
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
        <textarea
          ref={inputRef}
          rows={3}
          value={question}
          aria-label="Ask a question"
          placeholder={stopId ? 'Ask about this stop' : 'Ask about this pull request'}
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
