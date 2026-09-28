import type { ReactNode } from 'react'
import styles from './ErrorNote.module.css'

interface ErrorNoteProps {
  title: string
  message: string
  children?: ReactNode
}

export function ErrorNote({ title, message, children }: ErrorNoteProps) {
  return (
    <div className={styles.note} role="alert">
      <p className={styles.title}>{title}</p>
      <p className={styles.message}>{message}</p>
      {children ? <div className={styles.actions}>{children}</div> : null}
    </div>
  )
}
