import type { DiffLineAnnotation, FileDiffOptions, SelectedLineRange } from '@pierre/diffs/react'
import { PatchDiff } from '@pierre/diffs/react'
import { memo, useCallback, useMemo, useState } from 'react'
import type { DiffFile, Hunk } from '../../../shared/types'
import { dojo } from '../api'
import {
  type CommentTarget,
  type DiffAnnotation,
  askSelection,
  commentTarget,
  diffAnnotations,
  lineLabel,
  toAnnotationSide,
} from '../lib/comments'
import { synthesizePatch } from '../lib/patch'
import { useDojo, usePreviewing } from '../store'
import { Button } from './Button'
import { CommentForm, DraftCard, SelectionError } from './Comments'
import { ThreadCard } from './Discussion'
import styles from './FileDiffView.module.css'

interface Composer {
  range: SelectedLineRange
  target: CommentTarget | { error: string }
}

interface FileDiffViewProps {
  file: DiffFile
  hunks: Hunk[]
  stopId: string | null
  /** Rendered inside a surrounding file card that supplies the header and border. */
  embedded?: boolean
  linkToFullDiff?: boolean
}

export const FileDiffView = memo(function FileDiffView({
  file,
  hunks,
  stopId,
  embedded = false,
  linkToFullDiff = false,
}: FileDiffViewProps) {
  const prRef = useDojo((state) => state.session?.pr.ref)
  const allDrafts = useDojo((state) => state.session?.review.drafts)
  const allThreads = useDojo((state) => state.session?.threads)
  const changedSinceReview = useDojo((state) => state.session?.review.previous?.changedPaths.includes(file.path))
  const diffStyle = useDojo((state) => state.diffStyle)
  const previewing = usePreviewing()
  const { addDraft, askAbout, showInFullDiff } = useDojo.getState()
  const [dragRange, setDragRange] = useState<SelectedLineRange | null>(null)
  const [composer, setComposer] = useState<Composer | null>(null)

  const patch = useMemo(() => synthesizePatch(file, hunks), [file, hunks])
  const showsWholeFile = hunks.length === file.hunks.length

  const openComposer = useCallback(
    (range: SelectedLineRange | null) => {
      setDragRange(null)
      if (range) setComposer({ range, target: commentTarget(range, hunks) })
    },
    [hunks],
  )

  // Context between hunks can only be expanded when the stop shows every hunk of the file;
  // otherwise another stop's changes would render as unchanged lines.
  const loadDiffFiles = useMemo(() => {
    if (!prRef || !showsWholeFile) return undefined
    const oldPath = file.oldPath ?? file.path
    return async () => {
      const [before, after] = await Promise.all([
        dojo.readFile(prRef, oldPath, 'base'),
        dojo.readFile(prRef, file.path, 'head'),
      ])
      if (before === null || after === null) throw new Error(`Couldn't read ${file.path} to expand context.`)
      return { oldFile: { name: oldPath, contents: before }, newFile: { name: file.path, contents: after } }
    }
  }, [prRef, file, showsWholeFile])

  const options = useMemo<FileDiffOptions<DiffAnnotation, undefined>>(
    () => ({
      diffStyle,
      themeType: 'system',
      lineDiffType: 'word-alt',
      // Gap sizes are measured from the previous hunk in the patch, so they overstate the
      // unchanged lines whenever hunks from other stops were left out.
      hunkSeparators: showsWholeFile ? 'line-info' : 'simple',
      disableFileHeader: embedded,
      overflow: 'scroll',
      enableLineSelection: true,
      enableGutterUtility: true,
      onLineSelectionChange: setDragRange,
      onLineSelectionEnd: openComposer,
      onGutterUtilityClick: openComposer,
      loadDiffFiles,
    }),
    [diffStyle, openComposer, loadDiffFiles, showsWholeFile, embedded],
  )

  const annotations = useMemo(() => {
    const items = diffAnnotations(file.path, hunks, allThreads ?? [], allDrafts ?? [])
    if (composer) {
      const { range, target } = composer
      items.push(
        'error' in target
          ? { side: range.endSide ?? range.side ?? 'additions', lineNumber: range.end, metadata: { kind: 'composer' } }
          : { side: toAnnotationSide(target.side), lineNumber: target.line, metadata: { kind: 'composer' } },
      )
    }
    return items
  }, [allDrafts, allThreads, file.path, hunks, composer])

  const renderAnnotation = ({ metadata }: DiffLineAnnotation<DiffAnnotation>) => {
    if (metadata.kind === 'thread') return <ThreadCard thread={metadata.thread} />
    if (metadata.kind === 'draft') return <DraftCard draft={metadata.draft} />
    if (!composer) return null
    const { range, target } = composer
    const ask = (
      <Button
        size="sm"
        variant="ghost"
        disabled={previewing}
        title={previewing ? 'Ask opens once the tour is finished.' : undefined}
        onClick={() => {
          askAbout(askSelection(range, file))
          setComposer(null)
        }}
      >
        Ask about these lines
      </Button>
    )
    if ('error' in target) {
      return (
        <SelectionError message={target.error} onDismiss={() => setComposer(null)}>
          {ask}
        </SelectionError>
      )
    }
    return (
      <CommentForm
        key={`${target.side}:${target.startLine}:${target.line}`}
        label={lineLabel(target)}
        note={target.note}
        submitLabel="Add comment"
        secondaryAction={ask}
        onCancel={() => setComposer(null)}
        onSubmit={(body) => {
          addDraft({ path: file.path, side: target.side, startLine: target.startLine, line: target.line, body, stopId })
          setComposer(null)
        }}
      />
    )
  }

  return (
    <PatchDiff
      className={embedded ? undefined : styles.diff}
      patch={patch}
      options={options}
      lineAnnotations={annotations}
      selectedLines={dragRange ?? (composer ? composerSelection(composer) : null)}
      renderAnnotation={renderAnnotation}
      renderHeaderFilenameSuffix={() => (
        <>
          <FileNote file={file} shown={hunks.length} changedSinceReview={changedSinceReview ?? false} />
          {linkToFullDiff ? (
            <button type="button" className={styles.fullDiffLink} onClick={() => showInFullDiff(hunks[0].id)}>
              Show in full diff
            </button>
          ) : null}
        </>
      )}
    />
  )
})

function composerSelection({ range, target }: Composer): SelectedLineRange {
  if ('error' in target) return range
  const side = toAnnotationSide(target.side)
  return { start: target.startLine ?? target.line, end: target.line, side, endSide: side }
}

function FileNote({ file, shown, changedSinceReview }: { file: DiffFile; shown: number; changedSinceReview: boolean }) {
  const parts = [
    file.status === 'modified' ? null : file.status,
    shown < file.hunks.length ? `${shown} of ${file.hunks.length} hunks here` : null,
    changedSinceReview ? 'changed since your review' : null,
  ].filter((part) => part !== null)
  if (parts.length === 0) return null
  return <span className={styles.fileNote}>{parts.join(' · ')}</span>
}
