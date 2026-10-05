import { findHunk, stopForHunk } from '../../../shared/tour'
import type { IntentCheck } from '../../../shared/types'
import { useDojo, useSession, useTour } from '../store'
import { CheckIcon } from './icons'
import styles from './Intent.module.css'
import { Markdown } from './Markdown'

export function IntentSection({ intent }: { intent: IntentCheck }) {
  const unexplained = intent.unexplained.length
  return (
    <section className={styles.section} aria-labelledby="intent-heading">
      <h2 id="intent-heading" className={styles.sectionTitle}>
        Intent check
        {unexplained > 0 ? (
          <span className={styles.flag}>
            {unexplained} unexplained {unexplained === 1 ? 'change' : 'changes'}
          </span>
        ) : null}
      </h2>

      {intent.stated.length > 0 ? (
        <div>
          <h3 className={styles.subTitle}>The description promises</h3>
          <ul className={styles.stated}>
            {intent.stated.map((item, index) => (
              <li key={index}>
                <Markdown inline>{item}</Markdown>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.muted}>The description doesn't state an intent to check the code against.</p>
      )}

      {intent.claims.length > 0 ? (
        <div>
          <h3 className={styles.subTitle}>What the code delivers</h3>
          <ul className={styles.claims}>
            {intent.claims.map((claim, index) => (
              <li key={index} className={styles.claim}>
                <span className={styles.status} data-status={claim.status}>
                  {claim.status}
                </span>
                <div className={styles.claimBody}>
                  <p className={styles.claimText}>{claim.claim}</p>
                  <div className={styles.evidence}>
                    <Markdown>{claim.evidence}</Markdown>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {unexplained > 0 ? (
        <div className={styles.unexplained}>
          <h3 className={styles.subTitle}>Changes the intent doesn't explain</h3>
          <ul className={styles.unexplainedList}>
            {intent.unexplained.map((item, index) => (
              <li key={index}>
                <Markdown inline>{item.description}</Markdown>
                {item.hunkIds.length > 0 ? (
                  <span className={styles.chips}>
                    {item.hunkIds.map((hunkId) => (
                      <HunkChip key={hunkId} hunkId={hunkId} />
                    ))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.clean}>
          <CheckIcon /> Every change traces back to the stated intent.
        </p>
      )}
    </section>
  )
}

function HunkChip({ hunkId }: { hunkId: string }) {
  const { diff } = useSession()
  const tour = useTour()
  const { select } = useDojo.getState()
  const hunk = findHunk(diff, hunkId)
  const stop = tour ? stopForHunk(tour, hunkId) : undefined
  const label = hunk ? `${hunk.path.slice(hunk.path.lastIndexOf('/') + 1)}:${hunk.newStart}` : hunkId

  return (
    <button
      type="button"
      className={styles.chip}
      disabled={!stop}
      title={hunk ? `${hunk.path} ${hunk.header}${stop ? ` · in “${stop.title}”` : ''}` : undefined}
      onClick={() => stop && select(stop.id)}
    >
      {label}
    </button>
  )
}
