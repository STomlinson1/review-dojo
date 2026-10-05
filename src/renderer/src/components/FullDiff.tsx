import { type CSSProperties, createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { findStop, stopIdsByHunk } from '../../../shared/tour'
import type { DiffFile, Hunk } from '../../../shared/types'
import { fileSegments, lastStartingAtOrAbove, unchangedLinesBefore } from '../lib/fullDiff'
import { currentTour, useDojo, useSession, useTour } from '../store'
import { Button } from './Button'
import { FileDiffView } from './FileDiffView'
import styles from './FullDiff.module.css'
import { InlineCode } from './Markdown'
import { RiskDot } from './Risk'

type Observe = (element: Element, onNear: () => void) => () => void

const NearViewport = createContext<Observe | null>(null)

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const LINE_HEIGHT = 20
const SEPARATOR_HEIGHT = 32
const FILE_HEADER_HEIGHT = 36
const READING_OFFSET = FILE_HEADER_HEIGHT + 12

export function FullDiff() {
  const { diff, review } = useSession()
  const tour = useTour()
  const selectedStopId = useDojo((state) => state.selectedStopId)
  const diffFocus = useDojo((state) => state.diffFocus)
  const onlyChanged = useDojo((state) => state.diffFilter === 'changedSinceReview')
  const { setDiffFilter } = useDojo.getState()
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const observe = useNearViewport(scroller)
  const changedPaths = useMemo(() => new Set(review.previous?.changedPaths), [review.previous])
  const changedFiles = diff.files.filter((file) => changedPaths.has(file.path)).length
  const owners = useMemo(() => (tour ? stopIdsByHunk(tour) : new Map<string, string>()), [tour])
  const files = onlyChanged ? diff.files.filter((file) => changedPaths.has(file.path)) : diff.files

  useScrollSpy(scroller)
  useEffect(() => {
    const content = contentRef.current
    return scroller && content && diffFocus ? holdHunkInView(scroller, content, diffFocus.hunkId) : undefined
  }, [scroller, diffFocus])

  return (
    <section
      ref={setScroller}
      className={styles.scroller}
      style={
        {
          '--file-header-height': `${FILE_HEADER_HEIGHT}px`,
          '--reading-offset': `${READING_OFFSET}px`,
        } as CSSProperties
      }
      aria-label="Full diff"
    >
      {changedFiles > 0 && review.previous ? (
        <label className={styles.filter}>
          <input
            type="checkbox"
            checked={onlyChanged}
            onChange={() => setDiffFilter(onlyChanged ? 'all' : 'changedSinceReview')}
          />
          Only changes since my review
          <span className={styles.filterCount}>
            {changedFiles} {changedFiles === 1 ? 'file' : 'files'} since {review.previous.headSha.slice(0, 7)}
          </span>
        </label>
      ) : null}
      {diff.files.length === 0 ? <p className={styles.muted}>This pull request changes no files.</p> : null}
      <div ref={contentRef}>
        <NearViewport.Provider value={observe}>
          {files.map((file) => (
            <FileCard
              key={file.path}
              file={file}
              owners={owners}
              selectedStopId={selectedStopId}
              changedSinceReview={changedPaths.has(file.path)}
            />
          ))}
        </NearViewport.Provider>
      </div>
    </section>
  )
}

interface FileCardProps {
  file: DiffFile
  owners: ReadonlyMap<string, string>
  selectedStopId: string | null
  changedSinceReview: boolean
}

const FileCard = memo(function FileCard({ file, owners, selectedStopId, changedSinceReview }: FileCardProps) {
  const [generatedShown, setGeneratedShown] = useState(false)
  const [rendered] = useState(() => new Set<string>())
  const segments = useMemo(() => fileSegments(file, owners), [file, owners])
  const collapsed = file.isGenerated && !generatedShown

  return (
    <article className={styles.file} aria-label={file.path} data-file data-hunks={hunkIds(file.hunks)}>
      <header className={styles.fileHeader}>
        <span className={styles.path} title={file.path}>
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        {fileTags(file).map((tag) => (
          <span key={tag} className={styles.tag}>
            {tag}
          </span>
        ))}
        {changedSinceReview ? <span className={styles.changed}>Changed since your review</span> : null}
        <span className={styles.stats}>
          {file.deletions > 0 ? <span className={styles.deletions}>−{file.deletions}</span> : null}
          {file.additions > 0 ? <span className={styles.additions}>+{file.additions}</span> : null}
        </span>
        {file.isGenerated && file.hunks.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setGeneratedShown(!generatedShown)}>
            {generatedShown ? 'Hide generated changes' : 'Show generated changes'}
          </Button>
        ) : null}
      </header>
      {collapsed
        ? null
        : segments.map(({ stopId, start, end }) => (
            <SegmentView
              key={file.hunks[start].id}
              file={file}
              start={start}
              end={end}
              stopId={stopId}
              selected={stopId !== null && stopId === selectedStopId}
              dimmed={stopId !== null && selectedStopId !== null && stopId !== selectedStopId}
              rendered={rendered}
            />
          ))}
    </article>
  )
})

interface SegmentViewProps {
  file: DiffFile
  start: number
  end: number
  stopId: string | null
  selected: boolean
  dimmed: boolean
  /** Hunks of the file that have rendered once, so segments split off from them render right away. */
  rendered: Set<string>
}

const SegmentView = memo(function SegmentView({
  file,
  start,
  end,
  stopId,
  selected,
  dimmed,
  rendered,
}: SegmentViewProps) {
  const observe = useContext(NearViewport)
  const ref = useRef<HTMLDivElement>(null)
  const hunks = useMemo(() => file.hunks.slice(start, end), [file, start, end])
  const [near, setNear] = useState(() => hunks.some((hunk) => rendered.has(hunk.id)))
  const skipped = hunks.length < file.hunks.length ? unchangedLinesBefore(file, hunks[0]) : 0

  useEffect(() => {
    const element = ref.current
    if (near || !observe || !element) return
    return observe(element, () => setNear(true))
  }, [near, observe])

  useEffect(() => {
    if (near) for (const hunk of hunks) rendered.add(hunk.id)
  }, [near, hunks, rendered])

  return (
    <div
      ref={ref}
      className={styles.segment}
      data-segment
      data-stop-id={stopId ?? undefined}
      data-hunks={hunkIds(hunks)}
      data-selected={selected}
      data-dimmed={dimmed}
    >
      {stopId ? (
        <div className={styles.owner}>
          <StopChip stopId={stopId} selected={selected} />
          {skipped > 0 ? (
            <span className={styles.skipped}>
              {skipped} unchanged {skipped === 1 ? 'line' : 'lines'} above
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={styles.hunks}>
        {near ? (
          <FileDiffView file={file} hunks={hunks} stopId={stopId} withoutFileHeader />
        ) : (
          <div style={{ height: estimatedHeight(hunks) }} />
        )}
      </div>
    </div>
  )
})

function StopChip({ stopId, selected }: { stopId: string; selected: boolean }) {
  const stop = useDojo(
    useShallow((state) => {
      const tour = currentTour(state)
      const found = tour ? findStop(tour, stopId)?.stop : undefined
      return found && { title: found.title, risk: found.risk }
    }),
  )
  const { select } = useDojo.getState()
  if (!stop) return null

  return (
    <button
      type="button"
      className={styles.chip}
      aria-current={selected ? 'step' : undefined}
      title={`Go to stop: ${stop.title}`}
      onClick={() => select(stopId)}
    >
      <RiskDot risk={stop.risk} />
      <span className={styles.chipTitle}>
        <InlineCode>{stop.title}</InlineCode>
      </span>
    </button>
  )
}

function useNearViewport(root: HTMLElement | null): Observe | null {
  const [observe, setObserve] = useState<Observe | null>(null)

  useEffect(() => {
    if (!root) return
    const callbacks = new Map<Element, () => void>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) callbacks.get(entry.target)?.()
      },
      { root, rootMargin: '1500px 0px' },
    )
    setObserve(() => (element: Element, onNear: () => void) => {
      callbacks.set(element, onNear)
      observer.observe(element)
      return () => {
        callbacks.delete(element)
        observer.unobserve(element)
      }
    })
    return () => {
      observer.disconnect()
      setObserve(null)
    }
  }, [root])

  return observe
}

function useScrollSpy(scroller: HTMLElement | null) {
  useEffect(() => {
    if (!scroller) return
    const { setSpiedStopId } = useDojo.getState()
    let frame = 0
    const update = () => {
      frame = 0
      const segments = scroller.querySelectorAll<HTMLElement>('[data-segment]')
      const readingLine = scroller.getBoundingClientRect().top + READING_OFFSET
      const index = lastStartingAtOrAbove(
        segments.length,
        (candidate) => segments[candidate].getBoundingClientRect().top,
        readingLine,
      )
      setSpiedStopId(segments.item(Math.max(index, 0))?.dataset.stopId ?? null)
    }
    const onScroll = () => {
      frame ||= requestAnimationFrame(update)
    }
    update()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
      setSpiedStopId(null)
    }
  }, [scroller])
}

/**
 * Segments around the target render once it is in view and rarely match their estimated height,
 * which would push the target away, so it is held in place until the reader scrolls or clicks.
 */
function holdHunkInView(scroller: HTMLElement, content: HTMLElement, hunkId: string): (() => void) | undefined {
  const selector = `[data-hunks~="${CSS.escape(hunkId)}"]`
  const target =
    scroller.querySelector<HTMLElement>(`[data-segment]${selector}`) ??
    scroller.querySelector<HTMLElement>(`[data-file]${selector}`)
  if (!target) return undefined

  const distance = Math.abs(target.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
  // Gliding across many screens of code only blurs past; far targets are clearer as a jump.
  const smooth = !reducedMotion.matches && distance < scroller.clientHeight * 2
  target.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'instant' })

  let height = content.offsetHeight
  const resizes = new ResizeObserver(() => {
    if (content.offsetHeight === height) return
    height = content.offsetHeight
    target.scrollIntoView({ block: 'start', behavior: 'instant' })
  })
  resizes.observe(content)
  const release = () => {
    resizes.disconnect()
    scroller.removeEventListener('wheel', release)
    scroller.removeEventListener('pointerdown', release)
    window.removeEventListener('keydown', release)
  }
  scroller.addEventListener('wheel', release, { passive: true })
  scroller.addEventListener('pointerdown', release)
  window.addEventListener('keydown', release)
  return release
}

function estimatedHeight(hunks: Hunk[]): number {
  return hunks.reduce((total, hunk) => total + SEPARATOR_HEIGHT + hunk.lines.length * LINE_HEIGHT, SEPARATOR_HEIGHT)
}

function hunkIds(hunks: Hunk[]): string {
  return hunks.map((hunk) => hunk.id).join(' ')
}

function fileTags(file: DiffFile): string[] {
  return [
    file.status === 'modified' ? null : file.status,
    file.isBinary ? 'binary' : null,
    file.isGenerated ? 'generated' : null,
  ].filter((tag) => tag !== null)
}
