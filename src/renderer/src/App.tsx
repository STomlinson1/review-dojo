import { useEffect } from 'react'
import styles from './App.module.css'
import { CodePeek } from './components/CodePeek'
import { ErrorNote } from './components/ErrorNote'
import { Home } from './components/Home'
import { Review } from './components/Review'
import { SettingsModal } from './components/SettingsModal'
import { SubmitPanel } from './components/SubmitPanel'
import { flushReview, useDocent } from './store'

export function App() {
  const ready = useDocent((state) => state.settings !== null)
  const bootError = useDocent((state) => state.bootError)
  const hasSession = useDocent((state) => state.session !== null)
  const overlay = useDocent((state) => state.overlay)

  useEffect(() => {
    void useDocent.getState().boot()
    const flush = () => void flushReview()
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  if (bootError) {
    return (
      <div className={styles.shell}>
        <div className={styles.dragRegion} />
        <div className={styles.center}>
          <ErrorNote title="Docent couldn't start" message={bootError} />
        </div>
      </div>
    )
  }
  if (!ready) return <div className={styles.dragRegion} />

  const close = () => useDocent.getState().setOverlay(null)
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
