import { PROVIDER_NAMES } from '../../../shared/providers'
import { useDojo, useSession } from '../store'
import { ActivityLog } from './ActivityLog'
import { Button } from './Button'
import { ErrorNote } from './ErrorNote'
import { Markdown } from './Markdown'
import { OpenDiscussion } from './Discussion'
import styles from './TourEmpty.module.css'

export function TourEmpty() {
  const { pr, diff } = useSession()
  const settings = useDojo((state) => state.settings)
  const status = useDojo((state) => (settings ? state.environment?.providers[settings.provider] : undefined))
  const task = useDojo((state) => state.tasks.tour)
  const error = useDojo((state) => state.errors.tour)
  const { generateTour, cancelTask, setOverlay } = useDojo.getState()
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
        {task.preview?.summary ? (
          <section className={styles.summary} aria-label="Summary so far">
            <p className={styles.summaryLabel}>Summary</p>
            <Markdown>{task.preview.summary}</Markdown>
            <p className={styles.meta}>The first stop appears here as soon as it's written.</p>
          </section>
        ) : null}
      </div>
    )
  }

  return (
    <div className={styles.empty}>
      <h1 className={styles.title}>Take the guided tour</h1>
      <p className={styles.lede}>
        Review Dojo reads this pull request and the code around it, then walks you through it in the order it works, not
        file by file.
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
      <OpenDiscussion />
    </div>
  )
}
