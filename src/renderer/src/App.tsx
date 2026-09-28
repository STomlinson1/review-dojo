import { useEffect } from 'react'
import styles from './App.module.css'
import { CodePeek } from './components/CodePeek'
import { ErrorNote } from './components/ErrorNote'
import { Home } from './components/Home'
import { Review } from './components/Review'
import { SettingsModal } from './components/SettingsModal'
import { SubmitPanel } from './components/SubmitPanel'
import { flushReview, useDojo } from './store'

export function App() {
  const ready = useDojo((state) => state.settings !== null)
  const bootError = useDojo((state) => state.bootError)
  const hasSession = useDojo((state) => state.session !== null)
  const overlay = useDojo((state) => state.overlay)

  useEffect(() => {
    void useDojo.getState().boot()
    const flush = () => void flushReview()
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  if (bootError) {
    return (
      <div className={styles.shell}>
        <div className={styles.dragRegion} />
        <div className={styles.center}>
          <ErrorNote title="Review Dojo couldn't start" message={bootError} />
        </div>
      </div>
    )
  }
  if (!ready) return <div className={styles.dragRegion} />

  const close = () => useDojo.getState().setOverlay(null)
  return (
    <>
      {hasSession ? <Review /> : <Home />}
      {overlay?.kind === 'settings' ? <SettingsModal onClose={close} /> : null}
      {overlay?.kind === 'submit' && hasSession ? <SubmitPanel onClose={close} /> : null}
      {overlay?.kind === 'peek' && hasSession ? (
        <CodePeek
          key={`${overlay.target.path}:${overlay.target.startLine}-${overlay.target.endLine}`}
          target={overlay.target}
          onClose={close}
        />
      ) : null}
    </>
  )
}
