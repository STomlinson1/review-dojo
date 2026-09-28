import { useMemo } from 'react'
import MarkdownRenderer, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { dojo } from '../api'
import { parseCodeRef } from '../lib/codeRefs'
import { useDojo } from '../store'
import styles from './Markdown.module.css'

/** Titles render inside buttons, where the Markdown renderer's block elements would be invalid HTML. */
export function InlineCode({ children }: { children: string }) {
  return children
    .split(/(`[^`]+`)/)
    .map((part, index) =>
      part.length > 2 && part.startsWith('`') && part.endsWith('`') ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    )
}

const REMARK_PLUGINS = [remarkGfm]

interface MarkdownProps {
  children: string
  inline?: boolean
}

export function Markdown({ children, inline = false }: MarkdownProps) {
  const { setOverlay } = useDojo.getState()

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children: label }) => (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault()
            if (href && /^https?:\/\//.test(href)) void dojo.openExternal(href)
          }}
        >
          {label}
        </a>
      ),
      code: ({ className, children: code }) => {
        const target = !className && typeof code === 'string' ? parseCodeRef(code) : null
        if (!target) return <code className={className}>{code}</code>
        return (
          <button
            type="button"
            className={styles.codeRef}
            title="Peek at this code"
            onClick={() => setOverlay({ kind: 'peek', target })}
          >
            <code>{code}</code>
          </button>
        )
      },
      ...(inline ? { p: ({ children: text }) => <>{text}</> } : {}),
    }),
    [inline, setOverlay],
  )

  const Wrapper = inline ? 'span' : 'div'
  return (
    <Wrapper className={inline ? styles.inline : styles.prose}>
      <MarkdownRenderer remarkPlugins={REMARK_PLUGINS} components={components}>
        {children}
      </MarkdownRenderer>
    </Wrapper>
  )
}
