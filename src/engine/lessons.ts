import { z } from 'zod'
import type { AgentEvent, PrRef, TeamLessons } from '../shared/types'
import { fetchPastReviewComments, type PastReviewComment } from './github'
import { parseStructured } from './json'
import type { Provider } from './providers/provider'

const MIN_COMMENTS = 10
const COMMENT_PAGES = 3
const PROMPT_BUDGET_CHARS = 120_000
export const LESSONS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

const lessonsSchema = z.strictObject({
  lessons: z.array(z.strictObject({ title: z.string(), detail: z.string(), examples: z.array(z.string()) })),
})

const { $schema: _dialect, ...lessonsJsonSchema } = z.toJSONSchema(lessonsSchema, { target: 'draft-7' })

export async function learnLessons(
  ref: PrRef,
  provider: Provider,
  cwd: string,
  task: { signal: AbortSignal; onEvent: (event: AgentEvent) => void },
): Promise<TeamLessons> {
  task.onEvent({ kind: 'step', text: "Reading this team's past review comments" })
  const comments = await fetchPastReviewComments(ref, COMMENT_PAGES)
  const generatedAt = new Date().toISOString()
  if (comments.length < MIN_COMMENTS) return { generatedAt, sourceCount: comments.length, lessons: [] }

  task.onEvent({ kind: 'step', text: `Distilling review lessons from ${comments.length} comments` })
  const result = await provider.run({
    cwd,
    prompt: lessonsPrompt(ref, comments),
    schema: lessonsJsonSchema,
    resume: null,
    tools: 'none',
    streamDrafts: false,
    ...task,
  })
  const parsed = parseStructured(result.text, lessonsSchema)
  if (!parsed.success) throw new Error(`Couldn't read the distilled review lessons: ${parsed.error}`)
  const urls = new Set(comments.map((comment) => comment.url))
  return {
    generatedAt,
    sourceCount: comments.length,
    lessons: parsed.data.lessons.map((lesson) => ({
      ...lesson,
      examples: lesson.examples.filter((url) => urls.has(url)),
    })),
  }
}

function lessonsPrompt(ref: PrRef, comments: PastReviewComment[]): string {
  const blocks: string[] = []
  let used = 0
  for (const comment of comments) {
    const code = comment.diffHunk.split('\n').slice(-6).join('\n')
    const block = `### ${comment.url}\nFile: ${comment.path}\n\`\`\`\n${code}\n\`\`\`\n${comment.body.slice(0, 800)}`
    if (used + block.length > PROMPT_BUDGET_CHARS) break
    used += block.length
    blocks.push(block)
  }

  return `Below are recent code review comments that human reviewers left on pull requests in ${ref.owner}/${ref.repo}.
Distill the recurring expectations this team enforces in review: conventions they insist on, patterns they
prefer, pitfalls they keep catching, and things they push back on.

Rules:
- Each lesson must be supported by at least two of the comments. List up to three supporting comment URLs,
  copied exactly, in examples.
- Be specific to this codebase ("Wrap data fetching in the hooks under src/api instead of calling fetch in
  components"), never generic ("write tests", "keep functions small").
- Skip one-off nits and anything that only mattered to a single pull request.
- At most 12 lessons, most important first. Fewer is fine; return none if nothing recurs.
- title: at most eight words. detail: one or two sentences saying what to do and why.

${blocks.join('\n\n')}`
}
