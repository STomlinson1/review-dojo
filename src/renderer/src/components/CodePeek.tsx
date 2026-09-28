import { File, type FileOptions } from '@pierre/diffs/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { dojo, errorMessage } from '../api'
import { formatLocation } from '../lib/codeRefs'
import { type PeekTarget, useSession } from '../store'
import { Button } from './Button'
import styles from './CodePeek.module.css'
import { Dialog } from './Dialog'
import { ErrorNote } from './ErrorNote'
import { ExternalIcon } from './icons'
import { Markdown } from './Markdown'

type Contents =
  | { status: 'loading' }
  | { status: 'ready'; path: string; text: string }
  | { status: 'missing' }
  | { status: 'failed'; message: string }

export function CodePeek({ target, onClose }: { target: PeekTarget; onClose(): void }) {
  const { pr } = useSession()
  const [contents, setContents] = useState<Contents>({ status: 'loading' })
  const scrolled = useRef(false)

  useEffect(() => {
    let current = true
    dojo
      .resolvePath(pr.ref, target.path)
      .then(async (path) => {
        const text = path === null ? null : await dojo.readFile(pr.ref, path, 'head')
        if (!current) return
        setContents(path === null || text === null ? { status: 'missing' } : { status: 'ready', path, text })
      })
      .catch((error: unknown) => current && setContents({ status: 'failed', message: errorMessage(error) }))
    return () => {
      current = false
    }
  }, [pr.ref, target.path])

  const file = useMemo(
    () => (contents.status === 'ready' ? { name: contents.path, contents: contents.text } : null),
    [contents],
  )

  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({
      themeType: 'system',
      overflow: 'scroll',
      disableFileHeader: true,
      onPostRender: (node) => {
        if (scrolled.current) return
        const line = node.shadowRoot?.querySelector(`[data-line="${target.startLine}"]`)
        if (!line) return
        line.scrollIntoView({ block: 'center' })
        // A line wider than the view also scrolls sideways, which would hide the line numbers.
        for (let parent = line.parentElement; parent; parent = parent.parentElement) parent.scrollLeft = 0
        scrolled.current = true
      },
    }),
    [target.startLine],
  )

  const path = contents.status === 'ready' ? contents.path : target.path
  const githubUrl = `https://github.com/${pr.ref.owner}/${pr.ref.repo}/blob/${pr.headSha}/${encodeURI(path)}#L${target.startLine}-L${target.endLine}`

  return (
    <Dialog
      variant="drawer"
      title={formatLocation({ ...target, path })}
      subtitle="At the pull request's head"
      onClose={onClose}
      actions={
        <Button size="sm" variant="ghost" onClick={() => void dojo.openExternal(githubUrl)}>
          <ExternalIcon />
          GitHub
        </Button>
      }
    >
      <div className={styles.content}>
        {'why' in target ? (
          <div className={styles.why}>
            <Markdown>{target.why}</Markdown>
          </div>
        ) : null}
        {contents.status === 'loading' ? <p className={styles.muted}>Loading {target.path}…</p> : null}
        {contents.status === 'missing' ? (
          <p className={styles.muted}>
            <code>{target.path}</code> doesn't exist at this pull request's head. The reference may point at a file that
            was moved or deleted.
          </p>
        ) : null}
        {contents.status === 'failed' ? (
          <ErrorNote title={`Couldn't read ${target.path}`} message={contents.message} />
        ) : null}
        {file ? (
          <File
            className={styles.file}
            file={file}
            options={options}
            selectedLines={{ start: target.startLine, end: target.endLine }}
          />
        ) : null}
      </div>
    </Dialog>
  )
}
