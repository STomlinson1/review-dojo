import { PROVIDER_NAMES } from '../../../shared/providers'
import { useDocent, useSession } from '../store'
import { ActivityLog } from './ActivityLog'
import { Button } from './Button'
import { ErrorNote } from './ErrorNote'
import styles from './TourEmpty.module.css'

export function TourEmpty() {
  const { pr, diff } = useSession()
  const settings = useDocent((state) => state.settings)
  const status = useDocent((state) => (settings ? state.environment?.providers[settings.provider] : undefined))
  const task = useDocent((state) => state.tasks.tour)
  const error = useDocent((state) => state.errors.tour)
  const { generateTour, cancelTask, setOverlay } = useDocent.getState()
  if (!settings) return null

  const provider = PROVIDER_NAMES[settings.provider]
  const model = settings[settings.provider].model || 'CLI default model'

  if (task) {
    return (
      <div className={styles.empty}>
        <h1 className={styles.title}>Building your tour</h1>
        <p className={styles.lede}>
          {provider} is reading the change and the code around it. Large pull requests can take several minutes.
        </p>
        <ActivityLog task={task} label="Exploring the repository" onCancel={() => cancelTask('tour')} />
      </div>
    )
  }

  return (
    <div className={styles.empty}>
      <h1 className={styles.title}>Take the guided tour</h1>
      <p className={styles.lede}>
        Docent reads this pull request and the code around it, then walks you through it in the order it works, not file
        by file.
      </p>
      <ul className={styles.points}>
        <li>
          <strong>Every change, exactly once.</strong> Each hunk belongs to one stop, so nothing slips past.
        </li>
        <li>
          <strong>An intent check.</strong> What the description promises, what the code delivers, and what changed
          without being asked for.
        </li>
        <li>
          <strong>Your judgment stays yours.</strong> Questions test your reading, and every comment is written by you.
        </li>
      </ul>
      <div className={styles.run}>
        <Button variant="primary" onClick={() => void generateTour()}>
          Generate tour
        </Button>
        <span className={styles.meta}>
          {provider} · {model} · {diff.files.length} files, +{pr.additions} −{pr.deletions}
        </span>
      </div>
      {status && !status.ready ? (
        <p className={styles.warning}>
          {provider} may not be ready: {status.detail}{' '}
          <button type="button" className={styles.link} onClick={() => setOverlay({ kind: 'settings' })}>
            Open Settings
          </button>
        </p>
      ) : null}
      {error ? <ErrorNote title="The tour couldn't be generated" message={error} /> : null}
    </div>
  )
}
