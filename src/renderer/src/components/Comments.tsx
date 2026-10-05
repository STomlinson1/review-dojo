import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import type { DraftComment } from '../../../shared/types'
import { lineLabel } from '../lib/comments'
import { useDojo } from '../store'
import { Button } from './Button'
import styles from './Comments.module.css'
import { Markdown } from './Markdown'

interface CommentFormProps {
  focusKey: string
  label: string
  note?: string | null
  body: string
  submitLabel: string
  secondaryAction?: ReactNode
  onBodyChange(body: string): void
  onSubmit(body: string): void
  onCancel(): void
}

let focusOnMount: string | null = null

export function focusCommentFormOnMount(focusKey: string): void {
  focusOnMount = focusKey
}

export function CommentForm({
  focusKey,
  label,
  note,
  body,
  submitLabel,
  secondaryAction,
  onBodyChange,
  onSubmit,
  onCancel,
}: CommentFormProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const submit = () => {
    if (body.trim()) onSubmit(body.trim())
  }

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    return () => {
      // A diff can remount its annotations while the reviewer is typing; the form replacing this one takes over focus.
      if (textarea === document.activeElement) focusOnMount = focusKey
    }
  }, [focusKey])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || focusOnMount !== focusKey) return
    focusOnMount = null
    const takeFocus = () => {
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      return document.activeElement === textarea
    }
    if (takeFocus()) return
    // A re-rendered diff slots the form in only after it has laid out the new patch, and an element
    // that isn't rendered can't take focus. Waiting stops if the reviewer moves on meanwhile.
    const rendered = new ResizeObserver(() => {
      if (document.activeElement !== document.body || takeFocus()) rendered.disconnect()
    })
    rendered.observe(textarea)
    return () => rendered.disconnect()
  }, [focusKey])

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
        ref={textareaRef}
        rows={3}
        value={body}
        aria-label="Comment"
        placeholder="Leave a comment"
        onChange={(event) => onBodyChange(event.target.value)}
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
  const editedBody = useDojo((state) => state.draftEdits[draft.id])
  const { updateDraft, deleteDraft, setDraftEdit } = useDojo.getState()

  if (editedBody !== undefined) {
    return (
      <CommentForm
        focusKey={draft.id}
        label={lineLabel(draft)}
        body={editedBody}
        submitLabel="Save"
        onBodyChange={(body) => setDraftEdit(draft.id, body)}
        onSubmit={(body) => {
          updateDraft(draft.id, body)
          setDraftEdit(draft.id, null)
        }}
        onCancel={() => setDraftEdit(draft.id, null)}
      />
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.badge}>Draft</span>
        <span className={styles.meta}>{lineLabel(draft)}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            focusCommentFormOnMount(draft.id)
            setDraftEdit(draft.id, draft.body)
          }}
        >
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
