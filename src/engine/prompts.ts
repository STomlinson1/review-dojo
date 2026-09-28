import { selectHunks } from '../shared/tour'
import type {
  Diff,
  DiffFile,
  Hunk,
  PreviousReview,
  PullRequest,
  ReviewThread,
  Stack,
  Stop,
  TeamLessons,
} from '../shared/types'

const DIFF_BUDGET_CHARS = 240_000

const AGENT_ROLE = `You are a senior engineer guiding a colleague through a pull request review.
The reviewer is accountable for deeply understanding this change and the codebase patterns it touches.
Your job is to build that understanding, not to replace it: explain, point at evidence, and ask the
questions a careful reviewer would ask. You are in a read-only checkout of the repository at the PR head.
Never modify files. Dependencies are not installed. Ground every claim in code you have actually
read, citing \`path:line\`.`

export interface TourContext {
  lessons: TeamLessons | null
  threads: ReviewThread[]
  previous: PreviousReview | null
}

export function tourPrompt(pr: PullRequest, stack: Stack, diff: Diff, context: TourContext): string {
  return `${AGENT_ROLE}

# Task
Prepare a guided tour of the pull request below, returned as JSON matching the provided schema.

## How to work
1. Read the repository's contributor guidance if present (CONTRIBUTING.md, AGENTS.md, CLAUDE.md,
   .github/copilot-instructions.md, and docs they point to). Treat it as this team's conventions.
2. Read the PR description and linked issues. Extract what the author says the change should do.
3. Explore the repository around every changed area before writing anything: read the full changed
   files, find callers and usages (search), read the relevant types and existing tests, and look for
   existing helpers or patterns that solve the same problem.
4. Design the tour.
   - Order chapters by how the change works (entry points, then core logic, then edges such as errors,
     configuration and migrations, then tests), never by file name.
   - A stop groups the hunks that must be understood together; a stop may span files. Keep a stop to
     what one person can hold in their head (roughly 80 changed lines or fewer).
   - Reference hunks only by the [H#] ids shown in the diff. Put every non-generated hunk in exactly
     one stop.

## Writing each stop
- explanation: Markdown. What changed, why (tie it to the stated intent), and how it fits the existing
  design. Name the runtime behavior that changes. Do not narrate the diff line by line.
- risk / riskReason: high for security, auth, data loss or migration, concurrency, public API or
  contract changes, money, or anything hard to roll back. Say concretely what could go wrong.
- checks: specific things the reviewer should verify, each naming code (for example "Confirm
  \`useSession\` is never read before \`AuthProvider\` mounts, see src/app.tsx:40"). Never generic
  advice like "check for bugs" or "ensure tests pass". Empty when there is nothing specific.
- context: code outside the diff the reviewer should read to understand this stop (callers, types,
  tests, the pattern being extended), each with why it matters. Line numbers refer to the PR head.
- conventions: places where the change departs from how this repository already does the same thing,
  duplicates an existing helper, or goes against the contributor guidance or the team review lessons
  below. Only include notes backed by precedents you found by searching or by a lesson you can cite.
- question: one question that tests real understanding of behavior (what happens under a specific
  condition, input, or ordering), with an answer grounded in the code. null for trivial stops.

## Intent check
- stated: what the PR description and linked issues promise.
- claims: each promise with status (delivered, partial, missing) and evidence.
- unexplained: changes the stated intent does not justify (drive-by refactors, scope creep, leftover
  debugging, unrelated formatting), with their hunk ids. Be thorough: much of this code may be
  agent-written, and unrequested changes are a primary review risk.

## summary
Two to four sentences: what the PR does, the approach, and where the reviewer's attention matters most.${
    context.previous ? ' The reviewer has reviewed an earlier version, so begin with what changed since then.' : ''
  }

${prContext(pr, stack)}
${reviewContext(context)}

# Diff
Hunks are labeled [H#]. Generated files and lockfiles list their hunk ids but omit bodies.

${renderDiff(diff)}`
}

export function askPrompt(stop: Stop | null, question: string): string {
  const focus = stop
    ? `The reviewer is on the stop "${stop.title}" (hunks ${stop.hunkIds.join(', ') || 'none'}).`
    : 'The reviewer is looking at the PR overview.'
  return `${focus}

Reviewer's question:
${question}

Answer in concise Markdown. Read code as needed and cite \`path:line\`. If the answer is uncertain,
say what you checked and what remains unknown. Do not modify files.`
}

export function gradePrompt(stop: Stop, prediction: string): string {
  return `The reviewer is practicing "predict, then reveal" on the stop "${stop.title}"
(hunks ${stop.hunkIds.join(', ')}). Before reading your analysis they wrote:

"""
${prediction}
"""

Compare their reading with the actual behavior of the code. Reply in short Markdown with three parts:
**Got right**, **Missed or misread** (the blind spots, most important first, citing \`path:line\`),
and **Worth checking next**. Be direct and specific; do not flatter or pad.`
}

export function polishPrompt(body: string, path: string, codeExcerpt: string): string {
  return `Rewrite this pull request review comment so it is clear, specific, kind, and actionable.
Keep the reviewer's intent, stance, and voice. Do not add claims, suggestions, or facts they did not
make. If it asks for a change, make the requested change unambiguous. Keep it short. Reply with only
the rewritten comment in Markdown.

File: ${path}
Code under the comment:
\`\`\`
${codeExcerpt}
\`\`\`

Comment:
"""
${body}
"""`
}

export function tourRepairPrompt(problem: string): string {
  return `Your tour could not be used: ${problem}
Reply with only the corrected JSON object, complete, matching the same schema.`
}

export function sessionSeedPrompt(pr: PullRequest, stack: Stack, diff: Diff, stop: Stop | null): string {
  const hunkIds = new Set(stop?.hunkIds ?? [])
  const focused: Diff = stop
    ? {
        ...diff,
        files: selectHunks(diff, (hunk) => hunkIds.has(hunk.id)).map(({ file, hunks }) => ({ ...file, hunks })),
      }
    : diff
  return `${AGENT_ROLE}

${prContext(pr, stack)}

# Relevant diff
${renderDiff(focused)}`
}

function reviewContext({ lessons, threads, previous }: TourContext): string {
  const sections: string[] = []
  if (lessons && lessons.lessons.length > 0) {
    sections.push(`## Team review lessons
Distilled from this repository's past review comments. Hold the change to them.
${lessons.lessons.map((lesson) => `- **${lesson.title}**: ${lesson.detail}`).join('\n')}`)
  }
  const open = threads.filter((thread) => !thread.isResolved && thread.comments.length > 0)
  if (open.length > 0) {
    sections.push(`## Open review discussion
Unresolved threads already on this PR. Don't repeat them as new findings; mention one in a stop when it is
relevant to understanding that stop.
${open
  .map((thread) => {
    const [first] = thread.comments
    const where = thread.line === null ? `${thread.path} (outdated)` : `${thread.path}:${thread.line}`
    return `- ${where}, ${first.author}: ${first.body.replace(/\s+/g, ' ').slice(0, 240)}`
  })
  .join('\n')}`)
  }
  if (previous) {
    sections.push(`## Since the reviewer's last review
They reviewed an earlier head (${previous.headSha.slice(0, 7)}). Files whose changes differ since then:
${previous.changedPaths.length > 0 ? previous.changedPaths.map((path) => `- ${path}`).join('\n') : '- none'}`)
  }
  return sections.join('\n\n')
}

function prContext(pr: PullRequest, stack: Stack): string {
  const position = stack.entries.findIndex((entry) => entry.number === pr.ref.number)
  const stackNote =
    stack.entries.length > 1
      ? `This PR is ${position + 1} of ${stack.entries.length} in a stack on \`${stack.trunk}\` (${stack.entries
          .map((entry) => `#${entry.number}`)
          .join(' → ')}). Review only this PR's own diff; earlier PRs in the stack are its base.`
      : `Base branch: \`${pr.baseRefName}\`.`
  const issues = pr.linkedIssues
    .map((issue) => `### Linked issue #${issue.number}: ${issue.title}\n${issue.body.trim() || '(no description)'}`)
    .join('\n\n')

  return `# Pull request #${pr.ref.number}: ${pr.title}
Repository: ${pr.ref.owner}/${pr.ref.repo}. Author: ${pr.author}. ${stackNote}

## Description
${pr.body.trim() || '(no description)'}
${issues ? `\n${issues}\n` : ''}`
}

function renderDiff(diff: Diff): string {
  const parts: string[] = []
  let used = 0
  for (const file of diff.files) {
    if (file.hunks.length === 0 && !file.isBinary && file.status !== 'renamed') continue
    const header = `## ${fileLabel(file)}`
    if (file.isGenerated || file.isBinary) {
      parts.push(
        `${header}\n${file.isBinary ? 'Binary file.' : 'Generated file, body omitted.'} Hunks: ${hunkIdList(file.hunks)}`,
      )
      continue
    }
    const body = file.hunks.map(renderHunk).join('\n')
    if (used + body.length > DIFF_BUDGET_CHARS) {
      parts.push(
        `${header}\nBody omitted for size. Hunks: ${file.hunks
          .map((hunk) => `[${hunk.id}] ${hunk.header}`)
          .join('; ')}. Read the file directly.`,
      )
      continue
    }
    used += body.length
    parts.push(`${header}\n${body}`)
  }
  return parts.join('\n\n')
}

function fileLabel(file: DiffFile): string {
  const rename = file.oldPath ? ` (renamed from ${file.oldPath})` : ''
  return `${file.path}${rename} [${file.status}, +${file.additions} -${file.deletions}]`
}

function hunkIdList(hunks: Hunk[]): string {
  return hunks.length > 0 ? hunks.map((hunk) => hunk.id).join(', ') : 'none'
}

function renderHunk(hunk: Hunk): string {
  const lines = hunk.lines.map((line) => `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`)
  return `[${hunk.id}] ${hunk.header}\n${lines.join('\n')}`
}
