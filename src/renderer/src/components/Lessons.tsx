import type { TeamLessons } from '../../../shared/types'
import { dojo } from '../api'
import { relativeTime } from '../lib/format'
import { useDojo } from '../store'
import { ActivityLog } from './ActivityLog'
import { Button } from './Button'
import { ErrorNote } from './ErrorNote'
import { ExternalIcon } from './icons'
import styles from './Lessons.module.css'
import { Markdown } from './Markdown'

export function LessonsSection({ lessons }: { lessons: TeamLessons | null }) {
  const task = useDojo((state) => state.tasks.lessons)
  const error = useDojo((state) => state.errors.lessons)
  const { refreshLessons, cancelTask, dismissError } = useDojo.getState()
  const count = lessons?.lessons.length ?? 0

  const status = (
    <>
      {task ? (
        <ActivityLog task={task} label="Learning from past reviews" limit={3} onCancel={() => cancelTask('lessons')} />
      ) : null}
      {error ? (
        <ErrorNote title="Couldn't refresh the team's review lessons" message={error}>
          <Button size="sm" onClick={() => dismissError('lessons')}>
            Dismiss
          </Button>
        </ErrorNote>
      ) : null}
    </>
  )
  const refresh = (
    <Button size="sm" variant="ghost" disabled={task !== undefined} onClick={() => void refreshLessons()}>
      {lessons ? 'Refresh' : 'Learn now'}
    </Button>
  )

  if (!lessons || count === 0) {
    return (
      <section className={styles.section} aria-labelledby="lessons-heading">
        <h2 id="lessons-heading" className={styles.sectionTitle}>
          Team review lessons
        </h2>
        <p className={styles.lessonsEmpty}>
          <span className={styles.muted}>
            {lessons
              ? `No recurring expectations stood out in ${lessons.sourceCount} past review comments.`
              : "Lessons come from this repository's past review comments and are learned when a tour is generated."}
          </span>
          {refresh}
        </p>
        {status}
      </section>
    )
  }

  return (
    <details className={styles.lessons}>
      <summary className={styles.sectionTitle}>
        Team review lessons <span className={styles.lessonCount}>{count}</span>
      </summary>
      <div className={styles.lessonsBody}>
        <p className={styles.lessonsMeta}>
          <span>
            Learned from {lessons.sourceCount} review comments · {relativeTime(lessons.generatedAt)}
          </span>
          {refresh}
        </p>
        {status}
        <ol className={styles.lessonList}>
          {lessons.lessons.map((lesson, index) => (
            <li key={index} className={styles.lesson}>
              <p className={styles.lessonTitle}>{lesson.title}</p>
              <Markdown>{lesson.detail}</Markdown>
              {lesson.examples.length > 0 ? (
                <p className={styles.examples}>
                  Seen in{' '}
                  {exampleLabels(lesson.examples).map(({ url, label }) => (
                    <button
                      key={url}
                      type="button"
                      className={styles.example}
                      title={url}
                      onClick={() => void dojo.openExternal(url)}
                    >
                      {label}
                      <ExternalIcon />
                    </button>
                  ))}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </details>
  )
}

/** Several examples often come from one pull request, so repeats are numbered to tell the links apart. */
function exampleLabels(urls: string[]): { url: string; label: string }[] {
  const seen = new Map<string, number>()
  return urls.map((url) => {
    const pull = /\/pull\/(\d+)/.exec(url)?.[1]
    const base = pull ? `#${pull}` : 'comment'
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return { url, label: count === 1 ? base : `${base} (${count})` }
  })
}
