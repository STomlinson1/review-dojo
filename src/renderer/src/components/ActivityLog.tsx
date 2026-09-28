import { useEffect, useState } from 'react'
import type { ProgressEvent } from '../../../shared/types'
import { formatElapsed } from '../lib/format'
import type { RunningTask } from '../store'
import styles from './ActivityLog.module.css'
import { Button } from './Button'

interface ActivityLogProps {
  task: RunningTask
  label: string
  limit?: number
  onCancel?(): void
}

export function ActivityLog({ task, label, limit = 8, onCancel }: ActivityLogProps) {
  const elapsed = useElapsed(task.startedAt)
  const recent = task.events.slice(-limit)
  const firstIndex = task.eventCount - recent.length

  return (
    <div className={styles.log}>
      <div className={styles.header}>
        <span className={styles.pulse} aria-hidden="true" />
        <span className={styles.label} role="status">
          {label}
        </span>
        <span className={styles.meta}>
          {formatElapsed(elapsed)}
          {task.eventCount > 0 ? ` · ${task.eventCount} ${task.eventCount === 1 ? 'step' : 'steps'}` : ''}
        </span>
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      {recent.length > 0 ? (
        <ol className={styles.events}>
          {recent.map((event, index) => (
            <li
              key={firstIndex + index}
              className={styles.event}
              data-kind={event.kind}
              style={{ opacity: 0.35 + (0.65 * (index + 1)) / recent.length }}
              title={event.text}
            >
              {firstLine(event)}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

function firstLine(event: ProgressEvent): string {
  return event.text.trim().split('\n', 1)[0]
}

function useElapsed(since: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, now - since)
}
