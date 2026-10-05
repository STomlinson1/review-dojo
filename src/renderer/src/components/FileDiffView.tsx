import type { DiffLineAnnotation, FileDiffOptions, SelectedLineRange } from '@pierre/diffs/react'
import { PatchDiff } from '@pierre/diffs/react'
import { type ReactNode, memo, useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { hunkContaining } from '../../../shared/review'
import type { DiffFile, Hunk } from '../../../shared/types'
import { dojo } from '../api'
import {
  type CommentTarget,
  type DiffAnnotation,
  commentTarget,
  diffAnnotations,
  lineLabel,
  selectionForAsk,
  toAnnotationSide,
} from '../lib/comments'
import { synthesizePatch } from '../lib/patch'
import { type Composer, useDojo, usePreviewing, useSideBySide } from '../store'
import { Button } from './Button'
import { CommentForm, DraftCard, SelectionError, focusCommentFormOnMount } from './Comments'
import { ThreadCard } from './Discussion'
import styles from './FileDiffView.module.css'

type Placement = Omit<Composer, 'body'>

interface FileDiffViewProps {
  file: DiffFile
  hunks: Hunk[]
  stopId: string | null
  withoutFileHeader?: boolean
}

export const FileDiffView = memo(function FileDiffView({
  file,
  hunks,
  stopId,
  withoutFileHeader = false,
}: FileDiffViewProps) {
  const prRef = useDojo((state) => state.session?.pr.ref)
  const drafts = useDojo(
    useShallow((state) => state.session?.review.drafts.filter((draft) => draft.path === file.path) ?? []),
  )
  const threads = useDojo((state) => state.session?.threads)
  const changedSinceReview = useDojo((state) => state.session?.review.previous?.changedPaths.includes(file.path))
  const composer = useDojo(
    useShallow((state): Placement | undefined => {
      const open = state.composers[file.path]
      return open && { range: open.range, target: open.target }
    }),
  )
  const diffStyle = useDojo((state) => state.diffStyle)
  const previewing = usePreviewing()
  const canShowFullDiff = useSideBySide().fits
  const { addDraft, askAbout, closeComposer, openComposer, showInFullDiff } = useDojo.getState()
  const [dragRange, setDragRange] = useState<SelectedLineRange | null>(null)

  const patch = useMemo(() => synthesizePatch(file, hunks), [file, hunks])
  const showsWholeFile = hunks.length === file.hunks.length

  const selectionEnded = useCallback(
    (range: SelectedLineRange | null) => {
      setDragRange(null)
      if (!range) return
      focusCommentFormOnMount(composerFocusKey(file.path))
      openComposer(file.path, { range, target: commentTarget(range, hunks) })
    },
    [file.path, hunks, openComposer],
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
      disableFileHeader: withoutFileHeader,
      overflow: 'scroll',
      enableLineSelection: true,
      enableGutterUtility: true,
      onLineSelectionChange: setDragRange,
      onLineSelectionEnd: selectionEnded,
      onGutterUtilityClick: selectionEnded,
      loadDiffFiles,
    }),
    [diffStyle, selectionEnded, loadDiffFiles, showsWholeFile, withoutFileHeader],
  )

  const composerItem = useMemo(
    () => composer && composerAnnotation(composer, hunks, showsWholeFile),
    [composer, hunks, showsWholeFile],
  )
  const shownComposer = composerItem ? composer : undefined

  const annotations = useMemo(() => {
    const items = diffAnnotations(file.path, hunks, threads ?? [], drafts)
    return composerItem ? [...items, composerItem] : items
  }, [drafts, threads, file.path, hunks, composerItem])

  const renderAnnotation = ({ metadata }: DiffLineAnnotation<DiffAnnotation>) => {
    if (metadata.kind === 'thread') return <ThreadCard thread={metadata.thread} />
    if (metadata.kind === 'draft') return <DraftCard draft={metadata.draft} />
    if (!shownComposer) return null
    const { range, target } = shownComposer
    const ask = (
      <Button
        size="sm"
        variant="ghost"
        disabled={previewing}
        title={previewing ? 'Ask opens once the tour is finished.' : undefined}
        onClick={() => {
          askAbout(selectionForAsk(range, file))
          closeComposer(file.path)
        }}
      >
        Ask about these lines
      </Button>
    )
    if ('error' in target) {
      return (
        <SelectionError message={target.error} onDismiss={() => closeComposer(file.path)}>
          {ask}
        </SelectionError>
      )
    }
    return (
      <ComposerForm
        key={`${target.side}:${target.startLine}:${target.line}`}
        path={file.path}
        target={target}
        secondaryAction={ask}
        onSubmit={(body) => {
          addDraft({ path: file.path, side: target.side, startLine: target.startLine, line: target.line, body, stopId })
          closeComposer(file.path)
        }}
      />
    )
  }

  return (
    <PatchDiff
      className={withoutFileHeader ? undefined : styles.diff}
      patch={patch}
      options={options}
      lineAnnotations={annotations}
      selectedLines={dragRange ?? (shownComposer ? composerSelection(shownComposer) : null)}
      renderAnnotation={renderAnnotation}
      renderHeaderFilenameSuffix={() => (
        <>
          <FileNote file={file} shown={hunks.length} changedSinceReview={changedSinceReview ?? false} />
          {canShowFullDiff ? (
            <button type="button" className={styles.fullDiffLink} onClick={() => showInFullDiff(hunks[0])}>
              Show in full diff
            </button>
          ) : null}
        </>
      )}
    />
  )
})

interface ComposerFormProps {
  path: string
  target: CommentTarget
  secondaryAction: ReactNode
  onSubmit(body: string): void
}

function ComposerForm({ path, target, secondaryAction, onSubmit }: ComposerFormProps) {
  const body = useDojo((state) => state.composers[path]?.body ?? '')
  const { closeComposer, setComposerBody } = useDojo.getState()
  return (
    <CommentForm
      focusKey={composerFocusKey(path)}
      name={`New comment on ${path} ${lineLabel(target)}`}
      label={lineLabel(target)}
      note={target.note}
      body={body}
      submitLabel="Add comment"
      secondaryAction={secondaryAction}
      onBodyChange={(next) => setComposerBody(path, next)}
      onSubmit={onSubmit}
      onCancel={() => closeComposer(path)}
    />
  )
}

function composerFocusKey(path: string): string {
  return `composer:${path}`
}

/**
 * A file's composer is shown by whichever view renders its line. A selection outside the diff can
 * only have been made where context was expanded, which needs the whole file.
 */
function composerAnnotation(
  { range, target }: Placement,
  hunks: Hunk[],
  showsWholeFile: boolean,
): DiffLineAnnotation<DiffAnnotation> | null {
  if ('error' in target) {
    const side = range.endSide ?? range.side ?? 'additions'
    return showsWholeFile ? { side, lineNumber: range.end, metadata: { kind: 'composer' } } : null
  }
  if (!hunkContaining(hunks, target.side, target.line)) return null
  return { side: toAnnotationSide(target.side), lineNumber: target.line, metadata: { kind: 'composer' } }
}

function composerSelection({ range, target }: Placement): SelectedLineRange {
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
