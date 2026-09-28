import type { DiffLineAnnotation, FileDiffOptions, SelectedLineRange } from '@pierre/diffs/react'
import { PatchDiff } from '@pierre/diffs/react'
import { memo, useCallback, useMemo, useState } from 'react'
import { hunkContaining } from '../../../shared/review'
import type { DiffFile, DraftComment, Hunk } from '../../../shared/types'
import { dojo } from '../api'
import { type CommentTarget, commentTarget, lineLabel, toAnnotationSide } from '../lib/comments'
import { synthesizePatch } from '../lib/patch'
import { useDojo } from '../store'
import { CommentForm, DraftCard, SelectionError } from './Comments'
import styles from './FileDiffView.module.css'

type Annotation = { kind: 'draft'; draft: DraftComment } | { kind: 'composer' }

interface Composer {
  range: SelectedLineRange
  target: CommentTarget | { error: string }
}

interface FileDiffViewProps {
  file: DiffFile
  hunks: Hunk[]
  stopId: string
}

export const FileDiffView = memo(function FileDiffView({ file, hunks, stopId }: FileDiffViewProps) {
  const prRef = useDojo((state) => state.session?.pr.ref)
  const allDrafts = useDojo((state) => state.session?.review.drafts)
  const diffStyle = useDojo((state) => state.diffStyle)
  const { addDraft } = useDojo.getState()
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

  const options = useMemo<FileDiffOptions<Annotation, undefined>>(
    () => ({
      diffStyle,
      themeType: 'system',
      lineDiffType: 'word-alt',
      hunkSeparators: 'line-info',
      overflow: 'scroll',
      enableLineSelection: true,
      enableGutterUtility: true,
      onLineSelectionChange: setDragRange,
      onLineSelectionEnd: openComposer,
      onGutterUtilityClick: openComposer,
      loadDiffFiles,
    }),
    [diffStyle, openComposer, loadDiffFiles],
  )

  const annotations = useMemo(() => {
    const drafts = (allDrafts ?? []).filter(
      (draft) => draft.path === file.path && hunkContaining(hunks, draft.side, draft.line) !== undefined,
    )
    const items: DiffLineAnnotation<Annotation>[] = drafts.map((draft) => ({
      side: toAnnotationSide(draft.side),
      lineNumber: draft.line,
      metadata: { kind: 'draft', draft },
    }))
    if (composer) {
      const { range, target } = composer
      items.push(
        'error' in target
          ? { side: range.endSide ?? range.side ?? 'additions', lineNumber: range.end, metadata: { kind: 'composer' } }
          : { side: toAnnotationSide(target.side), lineNumber: target.line, metadata: { kind: 'composer' } },
      )
    }
    return items
  }, [allDrafts, file.path, hunks, composer])

  const renderAnnotation = (annotation: DiffLineAnnotation<Annotation>) => {
    if (annotation.metadata.kind === 'draft') return <DraftCard draft={annotation.metadata.draft} />
    if (!composer) return null
    const { target } = composer
    if ('error' in target) return <SelectionError message={target.error} onDismiss={() => setComposer(null)} />
    return (
      <CommentForm
        key={`${target.side}:${target.startLine}:${target.line}`}
        label={lineLabel(target)}
        note={target.note}
        submitLabel="Add comment"
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
      className={styles.diff}
      patch={patch}
      options={options}
      lineAnnotations={annotations}
      selectedLines={dragRange ?? (composer ? composerSelection(composer) : null)}
      renderAnnotation={renderAnnotation}
      renderHeaderFilenameSuffix={() => <FileNote file={file} shown={hunks.length} />}
    />
  )
})

function composerSelection({ range, target }: Composer): SelectedLineRange {
  if ('error' in target) return range
  const side = toAnnotationSide(target.side)
  return { start: target.startLine ?? target.line, end: target.line, side, endSide: side }
}

function FileNote({ file, shown }: { file: DiffFile; shown: number }) {
  const parts = [
    file.status === 'modified' ? null : file.status,
    shown < file.hunks.length ? `${shown} of ${file.hunks.length} hunks here` : null,
  ].filter((part) => part !== null)
  if (parts.length === 0) return null
  return <span className={styles.fileNote}>{parts.join(' · ')}</span>
}
