import { type ReactNode, useEffect, useId, useRef } from 'react'
import styles from './Dialog.module.css'
import { CloseIcon } from './icons'

interface DialogProps {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  variant?: 'modal' | 'drawer'
  onClose(): void
  children: ReactNode
}

export function Dialog({ title, subtitle, actions, footer, variant = 'modal', onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedBackdrop = useRef(false)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-variant={variant}
      aria-labelledby={titleId}
      onClose={onClose}
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) onClose()
      }}
    >
      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          {actions}
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </dialog>
  )
}
