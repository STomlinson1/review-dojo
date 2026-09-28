import { useEffect, useRef } from 'react'
import { tourStops } from '../../../shared/tour'
import { formatElapsed } from '../lib/format'
import { sideBySideFits } from '../lib/layout'
import { currentTour, isSideBySide, tourPreview, useDojo, useSideBySide } from '../store'
import { Pulse, useElapsed } from './ActivityLog'
import { AskPanel } from './AskPanel'
import { Button } from './Button'
import { FullDiff } from './FullDiff'
import { Overview } from './Overview'
import styles from './Review.module.css'
import { Sidebar } from './Sidebar'
import { StopView } from './StopView'
import { TopBar } from './TopBar'
import { TourEmpty } from './TourEmpty'

export function Review() {
  const hasTour = useDojo((state) => currentTour(state) !== null)
  const askOpen = useDojo((state) => state.askOpen)
  const sideBySide = useSideBySide().active

  useShortcuts()

  return (
    <div className={styles.review}>
      <TopBar />
      <StatusBanner />
      <PreviewStatus />
      <div className={styles.body} data-layout={sideBySide ? 'side-by-side' : 'focus'}>
        {hasTour ? <Sidebar /> : null}
        {sideBySide ? (
          <>
            <Narration />
            <FullDiff />
          </>
        ) : (
          <>
            <Guide showDiffs />
            {hasTour && askOpen ? <AskPanel /> : null}
          </>
        )}
      </div>
    </div>
  )
}

function Narration() {
  const hasTour = useDojo((state) => currentTour(state) !== null)
  const tab = useDojo((state) => state.narrationTab)
  const selectedStopId = useDojo((state) => state.selectedStopId)
  const { setNarrationTab } = useDojo.getState()
  const asking = hasTour && tab === 'ask'

  return (
    <div className={styles.narration}>
      {hasTour ? (
        <div className={styles.tabs} role="group" aria-label="Narration">
          <button type="button" aria-pressed={!asking} onClick={() => setNarrationTab('stop')}>
            {selectedStopId ? 'Stop' : 'Overview'}
          </button>
          <button type="button" aria-pressed={asking} onClick={() => setNarrationTab('ask')}>
            Ask
          </button>
        </div>
      ) : null}
      {asking ? <AskPanel embedded /> : <Guide showDiffs={false} />}
    </div>
  )
}

function Guide({ showDiffs }: { showDiffs: boolean }) {
  const hasTour = useDojo((state) => currentTour(state) !== null)
  const selectedStopId = useDojo((state) => state.selectedStopId)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
  }, [selectedStopId])

  return (
    <main ref={ref} className={styles.main}>
      {!hasTour ? (
        <TourEmpty />
      ) : selectedStopId ? (
        <StopView key={selectedStopId} stopId={selectedStopId} showDiffs={showDiffs} />
      ) : (
        <Overview />
      )}
    </main>
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

function PreviewStatus() {
  const stops = useDojo((state) => {
    const preview = tourPreview(state)
    return preview ? tourStops(preview).length : 0
  })
  const startedAt = useDojo((state) => state.tasks.tour?.startedAt)
  const { cancelTask } = useDojo.getState()
  if (stops === 0 || startedAt === undefined) return null

  return (
    <div className={styles.banner} role="status">
      <Pulse />
      <span className={styles.bannerText}>
        Still writing the tour: {stops} {stops === 1 ? 'stop' : 'stops'} so far
      </span>
      <Elapsed since={startedAt} />
      <Button size="sm" variant="ghost" onClick={() => cancelTask('tour')}>
        Cancel
      </Button>
    </div>
  )
}

function Elapsed({ since }: { since: number }) {
  return <span className={styles.bannerMeta}>{formatElapsed(useElapsed(since))}</span>
}

function useShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return
      const state = useDojo.getState()
      if (state.overlay) return
      const stopId = state.selectedStopId
      const sideBySide = isSideBySide(state.layout)
      if (event.key === '\\') {
        if (sideBySideFits.matches) state.setLayout(sideBySide ? 'focus' : 'side-by-side')
        event.preventDefault()
        return
      }
      if (!state.session || !currentTour(state)) return
      if (event.key === 'j') state.step(1)
      else if (event.key === 'k') state.step(-1)
      else if (event.key === 'u' && stopId) {
        state.updateStop(stopId, { understood: !state.session.review.stops[stopId]?.understood })
      } else if (event.key === '/') state.focusAsk()
      else if (event.key === 'Escape' && sideBySide && state.narrationTab === 'ask') state.setNarrationTab('stop')
      else if (event.key === 'Escape' && !sideBySide && state.askOpen) state.setAskOpen(false)
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
