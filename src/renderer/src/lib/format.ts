import type { Usage } from '../../../shared/types'

export function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatElapsed(milliseconds: number): string {
  const total = Math.floor(milliseconds / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

export function formatUsage(usage: Usage): string {
  if (usage.costUsd !== null) return `$${usage.costUsd.toFixed(2)}`
  return `${compact.format(usage.inputTokens)} in · ${compact.format(usage.outputTokens)} out tokens`
}

/** A one-line preview of a Markdown comment, skipping code such as a suggested change. */
export function firstProseLine(markdown: string): string {
  const prose = markdown
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  return prose ?? (markdown.includes('```suggestion') ? 'Suggested a change.' : 'Shared a code snippet.')
}
