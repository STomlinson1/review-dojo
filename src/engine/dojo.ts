import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { findStop } from '../shared/tour'
import type {
  AgentEvent,
  ChatMessage,
  Diff,
  DraftComment,
  PrRef,
  PrSession,
  ProviderId,
  PullRequest,
  ReviewEvent,
  ReviewState,
  Stack,
  Stop,
  TourRecord,
} from '../shared/types'
import { run } from './exec'
import { Workspace } from './git'
import { fetchPullRequest, fetchStack, parsePrRef, submitReview } from './github'
import { parseModelJson } from './json'
import { resolveInside } from './paths'
import { askPrompt, gradePrompt, polishPrompt, sessionSeedPrompt, tourPrompt, tourRepairPrompt } from './prompts'
import type { Provider } from './providers/provider'
import { draftProblem, lineOnSide } from '../shared/review'
import { Store } from './store'
import { normalizeTour, rawTourSchema, tourJsonSchema, type RawTour } from './tour'

interface Conversation {
  sessionId: string | null
  /** A session takes one turn at a time, so follow-ups chain onto this. */
  queue: Promise<unknown>
}

interface OpenPr {
  pr: PullRequest
  stack: Stack
  diff: Diff
  worktree: string
  tour: TourRecord | null
  conversations: Partial<Record<ProviderId, Conversation>>
}

export interface TaskContext {
  signal: AbortSignal
  onEvent: (event: AgentEvent) => void
}

const refKey = (ref: PrRef) => `${ref.owner}/${ref.repo}#${ref.number}`

export class Dojo {
  private readonly store: Store
  private readonly workspace: Workspace
  private readonly open = new Map<string, OpenPr>()

  constructor(dataDir: string) {
    this.store = new Store(dataDir)
    this.workspace = new Workspace(dataDir)
  }

  async openPullRequest(input: string, task: TaskContext): Promise<PrSession> {
    const ref = parsePrRef(input)
    const onStep = (text: string) => task.onEvent({ kind: 'step', text })
    onStep('Loading pull request')
    const pr = await fetchPullRequest(ref)
    task.signal.throwIfAborted()
    const [stack, { worktree, diff }] = await Promise.all([
      fetchStack(pr),
      this.workspace.prepare(pr, task.signal, onStep),
    ])
    const [tour, review] = await Promise.all([
      this.store.latestTour(ref, pr.headSha),
      this.store.loadReview(ref, pr.headSha),
    ])
    this.open.set(refKey(ref), { pr, stack, diff, worktree, tour, conversations: {} })
    return { pr, stack, diff, tour, review }
  }

  async generateTour(ref: PrRef, provider: Provider, task: TaskContext): Promise<TourRecord> {
    const session = this.session(ref)
    task.onEvent({ kind: 'step', text: `Exploring the repository with ${provider.id}` })
    const request = { cwd: session.worktree, schema: tourJsonSchema, tools: 'repo' as const, ...task }
    let result = await provider.run({
      ...request,
      prompt: tourPrompt(session.pr, session.stack, session.diff),
      resume: null,
    })
    let parsed = parseTour(result.text)
    if (!parsed.success && result.sessionId) {
      task.onEvent({ kind: 'step', text: 'Correcting the tour format' })
      result = await provider.run({ ...request, prompt: tourRepairPrompt(parsed.error), resume: result.sessionId })
      parsed = parseTour(result.text)
    }
    if (!parsed.success) throw new Error(`The ${provider.id} agent returned an unusable tour: ${parsed.error}`)

    const record: TourRecord = {
      pr: ref,
      headSha: session.pr.headSha,
      provider: provider.id,
      model: provider.model,
      sessionId: result.sessionId,
      createdAt: new Date().toISOString(),
      usage: result.usage,
      tour: normalizeTour(parsed.tour, session.diff),
    }
    this.store.saveTour(record)
    session.tour = record
    session.conversations = {}
    return record
  }

  async ask(
    ref: PrRef,
    provider: Provider,
    stopId: string | null,
    question: string,
    task: TaskContext,
  ): Promise<ChatMessage> {
    const stop = stopId ? this.stop(ref, stopId) : null
    const text = await this.converse(ref, provider, stop, askPrompt(stop, question), task)
    return { id: randomUUID(), role: 'assistant', text, stopId, createdAt: new Date().toISOString() }
  }

  gradePrediction(
    ref: PrRef,
    provider: Provider,
    stopId: string,
    prediction: string,
    task: TaskContext,
  ): Promise<string> {
    const stop = this.stop(ref, stopId)
    return this.converse(ref, provider, stop, gradePrompt(stop, prediction), task)
  }

  async polishComment(ref: PrRef, provider: Provider, draft: DraftComment, task: TaskContext): Promise<string> {
    const session = this.session(ref)
    const result = await provider.run({
      cwd: session.worktree,
      prompt: polishPrompt(draft.body, draft.path, commentExcerpt(session.diff, draft)),
      schema: null,
      resume: null,
      tools: 'none',
      ...task,
    })
    return result.text.trim()
  }

  saveReview(review: ReviewState): void {
    this.store.saveReview(review)
  }

  async submitReview(review: ReviewState, event: ReviewEvent): Promise<string> {
    const session = this.session(review.pr)
    if (session.pr.headSha !== review.headSha) {
      throw new Error('The pull request changed since this review started. Reopen it to review the latest commits.')
    }
    const problems = review.drafts
      .map((draft) => draftProblem(draft, session.diff))
      .filter((problem) => problem !== null)
    if (problems.length > 0) throw new Error(`Some comments can't be posted:\n${problems.join('\n')}`)
    return submitReview(session.pr, review.body, review.drafts, event)
  }

  /** Paths come from agent output, so head reads are confined to the worktree. */
  async readFile(ref: PrRef, path: string, version: 'base' | 'head'): Promise<string | null> {
    const session = this.session(ref)
    if (version === 'base') {
      return run('git', ['show', `${session.diff.mergeBaseSha}:${path}`], { cwd: session.worktree }).catch(() => null)
    }
    const target = await resolveInside(session.worktree, path)
    return target ? readFile(target, 'utf8').catch(() => null) : null
  }

  /** Agents often cite files by name alone (`send.ts:92`); a unique suffix match recovers the full path. */
  async resolvePath(ref: PrRef, path: string): Promise<string | null> {
    const { worktree } = this.session(ref)
    const files = (await run('git', ['ls-files', '-z'], { cwd: worktree })).split('\0')
    const wanted = path.replace(/^\.?\//, '')
    if (files.includes(wanted)) return wanted
    const matches = files.filter((file) => file.endsWith(`/${wanted}`))
    return matches.length === 1 ? matches[0] : null
  }

  /** Follow-ups resume the tour's agent session so answers draw on everything it already explored. */
  private converse(
    ref: PrRef,
    provider: Provider,
    stop: Stop | null,
    prompt: string,
    task: TaskContext,
  ): Promise<string> {
    const session = this.session(ref)
    const conversation = (session.conversations[provider.id] ??= {
      sessionId: session.tour?.provider === provider.id ? session.tour.sessionId : null,
      queue: Promise.resolve(),
    })
    const turn = conversation.queue
      .catch(() => undefined)
      .then(async () => {
        task.signal.throwIfAborted()
        const attempt = (resume: string | null) =>
          provider.run({
            cwd: session.worktree,
            prompt: resume
              ? prompt
              : `${sessionSeedPrompt(session.pr, session.stack, session.diff, stop)}\n\n${prompt}`,
            schema: null,
            resume,
            tools: 'repo',
            ...task,
          })
        const resume = conversation.sessionId
        const result = await attempt(resume).catch((error: unknown) => {
          if (resume === null || task.signal.aborted) throw error
          task.onEvent({ kind: 'step', text: 'Previous session unavailable; starting a new one' })
          return attempt(null)
        })
        conversation.sessionId = result.sessionId ?? conversation.sessionId
        return result.text.trim()
      })
    conversation.queue = turn
    return turn
  }

  private session(ref: PrRef): OpenPr {
    const session = this.open.get(refKey(ref))
    if (!session) throw new Error(`Pull request ${refKey(ref)} is not open.`)
    return session
  }

  private stop(ref: PrRef, stopId: string): Stop {
    const tour = this.session(ref).tour?.tour
    const found = tour ? findStop(tour, stopId) : null
    if (!found) throw new Error(`Unknown stop ${stopId}.`)
    return found.stop
  }
}

function parseTour(text: string): { success: true; tour: RawTour } | { success: false; error: string } {
  try {
    const result = rawTourSchema.safeParse(parseModelJson(text))
    return result.success
      ? { success: true, tour: result.data }
      : { success: false, error: z.prettifyError(result.error) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function commentExcerpt(diff: Diff, draft: DraftComment): string {
  const first = draft.startLine ?? draft.line
  const lines = diff.files
    .find((file) => file.path === draft.path)
    ?.hunks.flatMap((hunk) => hunk.lines)
    .filter((line) => {
      const number = lineOnSide(line, draft.side)
      return number !== null && number >= first && number <= draft.line
    })
  return lines?.map((line) => line.text).join('\n') ?? ''
}
