import { type ReactNode, useState } from 'react'
import type { ReviewThread, ThreadComment } from '../../../shared/types'
import { dojo } from '../api'
import { formatLocation } from '../lib/codeRefs'
import { firstProseLine, relativeTime } from '../lib/format'
import { stopAtLine } from '../lib/locate'
import { useDojo, useSession, useTour } from '../store'
import { Button } from './Button'
import styles from './Discussion.module.css'
import { ExternalIcon } from './icons'
import { InlineCode, Markdown } from './Markdown'

export function ThreadCard({ thread }: { thread: ReviewThread }) {
  const [open, setOpen] = useState(!thread.isResolved)
  const [repliesShown, setRepliesShown] = useState(false)
  const [first, ...replies] = thread.comments
  if (!first) return null

  if (!open) {
    return (
      <div className={styles.thread} data-resolved={thread.isResolved}>
        <button type="button" className={styles.collapsed} aria-expanded={false} onClick={() => setOpen(true)}>
          <ThreadTags thread={thread} />
          <span className={styles.author}>{first.author}</span>
          <span className={styles.excerpt}>
            <InlineCode>{firstProseLine(first.body)}</InlineCode>
          </span>
          <span className={styles.more}>Show</span>
        </button>
      </div>
    )
  }

  return (
    <div className={styles.thread} data-resolved={thread.isResolved}>
      <CommentView comment={first}>
        <ThreadTags thread={thread} />
        {thread.isResolved ? (
          <Button size="sm" variant="ghost" aria-expanded onClick={() => setOpen(false)}>
            Hide
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          aria-label="Open this thread on GitHub"
          title="Open on GitHub"
          onClick={() => void dojo.openExternal(first.url)}
        >
          <ExternalIcon />
        </Button>
      </CommentView>
      {replies.length > 0 ? (
        <button
          type="button"
          className={styles.replies}
          aria-expanded={repliesShown}
          onClick={() => setRepliesShown(!repliesShown)}
        >
          {repliesShown ? 'Hide replies' : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
        </button>
      ) : null}
      {repliesShown ? (
        <ol className={styles.replyList}>
          {replies.map((reply) => (
            <li key={reply.url}>
              <CommentView comment={reply} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

function CommentView({ comment, children }: { comment: ThreadComment; children?: ReactNode }) {
  return (
    <div className={styles.comment}>
      <div className={styles.header}>
        <span className={styles.author}>{comment.author}</span>
        <time className={styles.time} dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
          {relativeTime(comment.createdAt)}
        </time>
        {children ? <span className={styles.actions}>{children}</span> : null}
      </div>
      <div className={styles.body}>
        <Markdown>{comment.body}</Markdown>
      </div>
    </div>
  )
}

function ThreadTags({ thread }: { thread: ReviewThread }) {
  return (
    <>
      {thread.isResolved ? <span className={styles.tag}>Resolved</span> : null}
      {thread.isOutdated ? <span className={styles.tag}>Outdated</span> : null}
    </>
  )
}

export function OpenDiscussion() {
  const { threads } = useSession()
  if (threads.length === 0) return null
  const unresolved = threads.filter((thread) => !thread.isResolved)
  const resolved = threads.length - unresolved.length

  return (
    <section className={styles.section} aria-labelledby="discussion-heading">
      <h2 id="discussion-heading" className={styles.sectionTitle}>
        Open discussion
        {unresolved.length > 0 ? <span className={styles.count}>{unresolved.length} unresolved</span> : null}
      </h2>
      {unresolved.length === 0 ? (
        <p className={styles.muted}>
          {resolved === 1 ? 'The one review thread is resolved.' : `All ${resolved} review threads are resolved.`}
        </p>
      ) : (
        <ul className={styles.list}>
          {unresolved.map((thread) => (
            <DiscussionItem key={thread.id} thread={thread} />
          ))}
        </ul>
      )}
      {resolved > 0 && unresolved.length > 0 ? (
        <p className={styles.muted}>
          {resolved} resolved {resolved === 1 ? 'thread is' : 'threads are'} collapsed in the diff.
        </p>
      ) : null}
    </section>
  )
}

function DiscussionItem({ thread }: { thread: ReviewThread }) {
  const { diff } = useSession()
  const tour = useTour()
  const { select } = useDojo.getState()
  const first = thread.comments[0]
  const stop = tour && thread.line !== null ? stopAtLine(tour, diff, thread.path, thread.side, thread.line) : undefined
  const open = () => {
    if (stop) select(stop.id)
    else if (first) void dojo.openExternal(first.url)
  }
  const name = thread.path.slice(thread.path.lastIndexOf('/') + 1)
  const where =
    thread.line === null
      ? name
      : formatLocation({ path: name, startLine: thread.startLine ?? thread.line, endLine: thread.line })

  return (
    <li>
      <button
        type="button"
        className={styles.item}
        title={stop ? `Go to stop: ${stop.title}` : 'Open on GitHub'}
        onClick={open}
      >
        <span className={styles.itemHeader}>
          <code className={styles.where} title={thread.path}>
            {where}
          </code>
          {thread.isOutdated ? <span className={styles.tag}>Outdated</span> : null}
          <span className={styles.author}>{first?.author}</span>
          {stop ? (
            <span className={styles.stop}>
              <InlineCode>{stop.title}</InlineCode>
            </span>
          ) : (
            <span className={styles.external}>
              <ExternalIcon />
            </span>
          )}
        </span>
        {first ? (
          <span className={styles.excerpt}>
            <InlineCode>{firstProseLine(first.body)}</InlineCode>
          </span>
        ) : null}
      </button>
    </li>
  )
}
