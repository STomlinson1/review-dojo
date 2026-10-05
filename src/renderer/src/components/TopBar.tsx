import { Fragment } from 'react'
import type { Stack } from '../../../shared/types'
import { tourStops } from '../../../shared/tour'
import { SIDE_BY_SIDE_MIN_WIDTH } from '../lib/layout'
import { useDojo, useSession, useSideBySide, useTour } from '../store'
import { Button } from './Button'
import { AskIcon, BackIcon, FocusLayoutIcon, SettingsIcon, SideBySideLayoutIcon } from './icons'
import styles from './TopBar.module.css'

export function TopBar() {
  const { pr, stack, review } = useSession()
  const tour = useTour()
  const dojoMode = useDojo((state) => state.dojoMode)
  const diffStyle = useDojo((state) => state.diffStyle)
  const askOpen = useDojo((state) => state.askOpen)
  const { closePullRequest, setDojoMode, setDiffStyle, setAskOpen, setOverlay } = useDojo.getState()
  const stops = tour ? tourStops(tour) : []

  return (
    <header className={styles.bar}>
      <Button
        variant="ghost"
        size="sm"
        className={styles.icon}
        aria-label="Back to home"
        title="Back to home"
        onClick={closePullRequest}
      >
        <BackIcon />
      </Button>
      <div className={styles.identity}>
        <span className={styles.repo}>
          {pr.ref.owner}/{pr.ref.repo} <span className={styles.number}>#{pr.ref.number}</span>
        </span>
        <span className={styles.title} title={pr.title}>
          {pr.title}
        </span>
      </div>
      {stack.entries.length > 1 ? <StackTrail stack={stack} current={pr.ref.number} /> : null}

      <div className={styles.controls}>
        {tour ? (
          <UnderstoodMeter
            understood={stops.filter((stop) => review.stops[stop.id]?.understood).length}
            total={stops.length}
          />
        ) : null}
        <button
          type="button"
          role="switch"
          aria-checked={dojoMode}
          className={styles.switch}
          title="Dojo mode: predict what a stop does before reading the explanation"
          onClick={() => setDojoMode(!dojoMode)}
        >
          <span className={styles.track} aria-hidden="true" />
          Dojo
        </button>
        <div className={styles.segmented} role="group" aria-label="Diff layout">
          {(['unified', 'split'] as const).map((style) => (
            <button key={style} type="button" aria-pressed={diffStyle === style} onClick={() => setDiffStyle(style)}>
              {style === 'unified' ? 'Unified' : 'Split'}
            </button>
          ))}
        </div>
        <LayoutSwitch />
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={tour !== null && askOpen}
          disabled={!tour}
          title="Ask about this stop (/)"
          onClick={() => setAskOpen(!askOpen)}
        >
          <AskIcon />
          Ask
        </Button>
        <Button variant="primary" size="sm" onClick={() => setOverlay({ kind: 'submit' })}>
          Review
          {review.drafts.length > 0 ? <span className={styles.count}>{review.drafts.length}</span> : null}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={styles.icon}
          aria-label="Settings"
          title="Settings"
          onClick={() => setOverlay({ kind: 'settings' })}
        >
          <SettingsIcon />
        </Button>
      </div>
    </header>
  )
}

function LayoutSwitch() {
  const { active, fits } = useSideBySide()
  const { setLayout } = useDojo.getState()

  return (
    <div className={styles.segmented} role="group" aria-label="Layout">
      <button
        type="button"
        className={styles.iconSegment}
        aria-pressed={!active}
        aria-label="Focus"
        title="Focus: one stop at a time, with its own changes (\)"
        onClick={() => setLayout('focus')}
      >
        <FocusLayoutIcon />
      </button>
      <button
        type="button"
        className={styles.iconSegment}
        aria-pressed={active}
        aria-disabled={!fits}
        aria-label="Side by side"
        title={
          fits
            ? 'Side by side: the tour next to the whole diff (\\)'
            : `Side by side needs a window at least ${SIDE_BY_SIDE_MIN_WIDTH}px wide`
        }
        onClick={() => fits && setLayout('side-by-side')}
      >
        <SideBySideLayoutIcon />
      </button>
    </div>
  )
}

function UnderstoodMeter({ understood, total }: { understood: number; total: number }) {
  return (
    <div
      className={styles.meter}
      role="progressbar"
      aria-label="Stops understood"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={understood}
      title={`${understood} of ${total} stops understood`}
    >
      <span className={styles.meterTrack}>
        <span className={styles.meterFill} style={{ width: total ? `${(understood / total) * 100}%` : 0 }} />
      </span>
      <span className={styles.meterLabel}>
        {understood}/{total}
      </span>
    </div>
  )
}

function StackTrail({ stack, current }: { stack: Stack; current: number }) {
  const opening = useDojo((state) => state.tasks.open !== undefined)
  const { openPullRequest } = useDojo.getState()

  return (
    <nav className={styles.stack} aria-label="Stacked pull requests">
      <span className={styles.trunk}>{stack.trunk}</span>
      {stack.entries.map((entry) => (
        <Fragment key={entry.number}>
          <span className={styles.separator} aria-hidden="true">
            ›
          </span>
          {entry.number === current ? (
            <span className={styles.current} aria-current="page" title={entry.title}>
              #{entry.number}
            </span>
          ) : (
            <button
              type="button"
              className={styles.entry}
              title={entry.title}
              disabled={opening}
              onClick={() => void openPullRequest(entry.url)}
            >
              #{entry.number}
            </button>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
