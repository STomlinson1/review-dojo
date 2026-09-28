import { useEffect, useRef } from 'react'
import { useDojo } from '../store'
import { AskPanel } from './AskPanel'
import { Button } from './Button'
import { Overview } from './Overview'
import styles from './Review.module.css'
import { Sidebar } from './Sidebar'
import { StopView } from './StopView'
import { TopBar } from './TopBar'
import { TourEmpty } from './TourEmpty'

export function Review() {
  const hasTour = useDojo((state) => state.session?.tour != null)
  const selectedStopId = useDojo((state) => state.selectedStopId)
  const askOpen = useDojo((state) => state.askOpen)
  const mainRef = useRef<HTMLElement>(null)

  useShortcuts()
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [selectedStopId])

  return (
    <div className={styles.review}>
      <TopBar />
      <StatusBanner />
      <div className={styles.body}>
        {hasTour ? <Sidebar /> : null}
        <main ref={mainRef} className={styles.main}>
          {!hasTour ? (
            <TourEmpty />
          ) : selectedStopId ? (
            <StopView key={selectedStopId} stopId={selectedStopId} />
          ) : (
            <Overview />
          )}
        </main>
        {hasTour && askOpen ? <AskPanel /> : null}
      </div>
    </div>
  )
}

function StatusBanner() {
  const opening = useDojo((state) => state.tasks.open)
  const openError = useDojo((state) => state.errors.open)
  const saveError = useDojo((state) => state.saveError)
  const { cancelTask, dismissError } = useDojo.getState()

  if (opening) {
    const latest = opening.events.at(-1)?.text
    return (
      <div className={styles.banner} role="status">
        <span className={styles.bannerText}>Opening pull request{latest ? ` · ${latest}` : '…'}</span>
        <Button size="sm" variant="ghost" onClick={() => cancelTask('open')}>
          Cancel
        </Button>
      </div>
    )
  }
  if (openError) {
    return (
      <div className={styles.banner} data-tone="error" role="alert">
        <span className={styles.bannerText}>Couldn't open that pull request. {openError}</span>
        <Button size="sm" variant="ghost" onClick={() => dismissError('open')}>
          Dismiss
        </Button>
      </div>
    )
  }
  if (saveError) {
    return (
      <div className={styles.banner} data-tone="error" role="alert">
        <span className={styles.bannerText}>
          Your review progress isn't being saved. It will retry on your next change. {saveError}
        </span>
      </div>
    )
  }
  return null
}

function useShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return
      const state = useDojo.getState()
      if (state.overlay) return
      const stopId = state.selectedStopId
      if (!state.session?.tour) return
      if (event.key === 'j') state.step(1)
      else if (event.key === 'k') state.step(-1)
      else if (event.key === 'u' && stopId) {
        state.updateStop(stopId, { understood: !state.session.review.stops[stopId]?.understood })
      } else if (event.key === '/') state.focusAsk()
      else if (event.key === 'Escape' && state.askOpen) state.setAskOpen(false)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  )
}
