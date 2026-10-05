import type { PreviousReview } from '../../../shared/types'
import { useChangedPathsByStop, useDojo, useSession } from '../store'
import styles from './ChangesSinceReview.module.css'

export function ChangesSinceReview({ previous }: { previous: PreviousReview }) {
  const { diff } = useSession()
  const { select } = useDojo.getState()
  const byStop = useChangedPathsByStop()
  const count = previous.changedPaths.length
  const firstStop = (path: string) => [...(byStop ?? [])].find(([, paths]) => paths.includes(path))?.[0]
  const inDiff = new Set(diff.files.map((file) => file.path))

  return (
    <section className={styles.changes} aria-labelledby="changes-heading">
      <h2 id="changes-heading" className={styles.changesTitle}>
        You reviewed an earlier version ({previous.headSha.slice(0, 7)}).{' '}
        {count === 0 ? 'No file changed since.' : `${count} ${count === 1 ? 'file' : 'files'} changed since.`}
      </h2>
      {count > 0 ? (
        <ul className={styles.changedList}>
          {previous.changedPaths.map((path) => {
            const stopId = firstStop(path)
            return (
              <li key={path}>
                {stopId ? (
                  <button type="button" className={styles.changedPath} onClick={() => select(stopId)}>
                    {path}
                  </button>
                ) : (
                  <span className={styles.changedPlain}>
                    <code>{path}</code>
                    {inDiff.has(path) ? null : ' (no longer in the pull request)'}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
