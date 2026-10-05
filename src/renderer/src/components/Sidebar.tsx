import { useChangedPathsByStop, useDojo, usePreviewing, useSession, useTour } from '../store'
import { Pulse } from './ActivityLog'
import { CheckIcon } from './icons'
import { RiskDot } from './Risk'
import { InlineCode } from './Markdown'
import styles from './Sidebar.module.css'

export function Sidebar() {
  const { review } = useSession()
  const tour = useTour()
  const previewing = usePreviewing()
  const selectedStopId = useDojo((state) => state.selectedStopId)
  const spiedStopId = useDojo((state) => state.spiedStopId)
  const { select } = useDojo.getState()
  const updated = useChangedPathsByStop()
  if (!tour) return null

  return (
    <nav className={styles.sidebar} aria-label="Tour">
      <button
        type="button"
        className={styles.overview}
        aria-current={selectedStopId === null ? 'page' : undefined}
        onClick={() => select(null)}
      >
        Overview
      </button>
      {tour.chapters.map((chapter) => (
        <section key={chapter.id} className={styles.chapter} aria-label={chapter.title}>
          <h3 className={styles.chapterTitle} title={chapter.goal}>
            <InlineCode>{chapter.title}</InlineCode>
          </h3>
          <p className={styles.goal}>
            <InlineCode>{chapter.goal}</InlineCode>
          </p>
          <ol className={styles.stops}>
            {chapter.stops.map((stop) => {
              const understood = review.stops[stop.id]?.understood ?? false
              const updatedPaths = updated?.get(stop.id)
              return (
                <li key={stop.id}>
                  <button
                    type="button"
                    className={styles.stop}
                    aria-current={selectedStopId === stop.id ? 'page' : undefined}
                    data-visited={review.visitedStopIds.includes(stop.id)}
                    data-in-view={spiedStopId === stop.id}
                    title={stop.title}
                    onClick={() => select(stop.id)}
                  >
                    <RiskDot risk={stop.risk} />
                    <span className={styles.stopTitle}>
                      <InlineCode>{stop.title}</InlineCode>
                    </span>
                    {updatedPaths ? (
                      <span className={styles.updated} title={`Changed since your review: ${updatedPaths.join(', ')}`}>
                        updated
                      </span>
                    ) : null}
                    {understood ? (
                      <span className={styles.understood} role="img" aria-label="Understood">
                        <CheckIcon />
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      {previewing ? (
        <p className={styles.writing}>
          <Pulse />
          Writing…
        </p>
      ) : null}
      <p className={styles.keys}>
        <span>
          <kbd>j</kbd> <kbd>k</kbd> move
        </span>
        <span>
          <kbd>u</kbd> understood
        </span>
        <span>
          <kbd>/</kbd> ask
        </span>
        <span>
          <kbd>\</kbd> layout
        </span>
      </p>
    </nav>
  )
}
