import { useDocent, useSession } from '../store'
import { CheckIcon } from './icons'
import { RiskDot } from './Risk'
import { InlineCode } from './Markdown'
import styles from './Sidebar.module.css'

export function Sidebar() {
  const { tour, review } = useSession()
  const selectedStopId = useDocent((state) => state.selectedStopId)
  const { select } = useDocent.getState()
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
      {tour.tour.chapters.map((chapter) => (
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
              return (
                <li key={stop.id}>
                  <button
                    type="button"
                    className={styles.stop}
                    aria-current={selectedStopId === stop.id ? 'page' : undefined}
                    data-visited={review.visitedStopIds.includes(stop.id)}
                    title={stop.title}
                    onClick={() => select(stop.id)}
                  >
                    <RiskDot risk={stop.risk} />
                    <span className={styles.stopTitle}>
                      <InlineCode>{stop.title}</InlineCode>
                    </span>
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
      <p className={styles.keys}>
        <kbd>j</kbd> <kbd>k</kbd> move · <kbd>u</kbd> understood · <kbd>/</kbd> ask
      </p>
    </nav>
  )
}
