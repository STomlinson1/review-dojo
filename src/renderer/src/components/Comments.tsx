import { type ReactNode, useState } from 'react'
import type { DraftComment } from '../../../shared/types'
import { lineLabel } from '../lib/comments'
import { useDojo } from '../store'
import { Button } from './Button'
import styles from './Comments.module.css'
import { Markdown } from './Markdown'

interface CommentFormProps {
  label: string
  note?: string | null
  initialBody?: string
  submitLabel: string
  secondaryAction?: ReactNode
  onSubmit(body: string): void
  onCancel(): void
}

export function CommentForm({
  label,
  note,
  initialBody = '',
  submitLabel,
  secondaryAction,
  onSubmit,
  onCancel,
}: CommentFormProps) {
  const [body, setBody] = useState(initialBody)
  const submit = () => {
    if (body.trim()) onSubmit(body.trim())
  }

  return (
    <form
      className={styles.card}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <p className={styles.meta}>{label}</p>
      {note ? <p className={styles.note}>{note}</p> : null}
      <textarea
        rows={3}
        value={body}
        aria-label="Comment"
        placeholder="Leave a comment"
        autoFocus
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      <div className={styles.actions}>
        <span className={styles.hint}>
          <kbd>⌘</kbd> <kbd>↵</kbd> to save
        </span>
        {secondaryAction}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!body.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export function DraftCard({ draft }: { draft: DraftComment }) {
  const [editing, setEditing] = useState(false)
  const { updateDraft, deleteDraft } = useDojo.getState()

  if (editing) {
    return (
      <CommentForm
        label={lineLabel(draft)}
        initialBody={draft.body}
        submitLabel="Save"
        onSubmit={(body) => {
          updateDraft(draft.id, body)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.badge}>Draft</span>
        <span className={styles.meta}>{lineLabel(draft)}</span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => deleteDraft(draft.id)}>
          Delete
        </Button>
      </div>
      <Markdown>{draft.body}</Markdown>
    </div>
  )
}

interface SelectionErrorProps {
  message: string
  children?: ReactNode
  onDismiss(): void
}

export function SelectionError({ message, children, onDismiss }: SelectionErrorProps) {
  return (
    <div className={styles.card} role="alert">
      <div className={styles.header}>
        <span className={styles.error}>{message}</span>
        {children}
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}
