import { findHunk, tourStops } from './tour'
import type { CodeLocation, Diff, PullRequest, Stop, Tour } from './types'

const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const

/** A Markdown reviewer's guide for sharing a tour outside the app, such as in the pull request itself. */
export function tourToMarkdown(pr: PullRequest, tour: Tour, diff: Diff): string {
  const sections = [
    `# Reviewer's guide: ${pr.title} (#${pr.ref.number})`,
    tour.summary,
    intentSection(tour),
    ...tour.chapters.map(
      (chapter) =>
        `## ${chapter.title}\n\n${chapter.goal}\n\n${chapter.stops.map((stop) => stopSection(stop, diff)).join('\n\n')}`,
    ),
    `<sub>${tourStops(tour).length} stops, generated with Review Dojo.</sub>`,
  ]
  return `${sections.filter(Boolean).join('\n\n')}\n`
}

function intentSection(tour: Tour): string {
  const { claims, unexplained } = tour.intent
  const lines = claims.map((claim) => `- **${claim.status}**: ${claim.claim}`)
  const extra = unexplained.map((item) => `- ${item.description}`)
  if (lines.length === 0 && extra.length === 0) return ''
  return [
    '## Intent check',
    ...lines,
    ...(extra.length > 0 ? ['', '**Changes the description does not explain**', ...extra] : []),
  ].join('\n')
}

function stopSection(stop: Stop, diff: Diff): string {
  const where = stop.hunkIds
    .map((id) => findHunk(diff, id))
    .filter((hunk) => hunk !== undefined)
    .map((hunk) =>
      location({ path: hunk.path, startLine: hunk.newStart, endLine: hunk.newStart + Math.max(hunk.newLines - 1, 0) }),
    )
  const parts = [
    `### ${stop.title}`,
    `_${RISK_LABEL[stop.risk]}: ${stop.riskReason}_`,
    where.length > 0 ? `Changes: ${where.join(', ')}` : '',
    stop.explanation,
    stop.checks.length > 0 ? `**Verify**\n${stop.checks.map((check) => `- [ ] ${check}`).join('\n')}` : '',
    stop.context.length > 0
      ? `**Read also**\n${stop.context.map((ref) => `- ${location(ref)}: ${ref.why}`).join('\n')}`
      : '',
  ]
  return parts.filter(Boolean).join('\n\n')
}

function location({ path, startLine, endLine }: CodeLocation): string {
  return `\`${path}:${startLine === endLine ? startLine : `${startLine}-${endLine}`}\``
}
