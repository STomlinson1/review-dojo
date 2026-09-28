import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { findStop } from '../shared/tour'
import type {
  ChatMessage,
  CodeSelection,
  Diff,
  DraftComment,
  PrRef,
  PreviousReview,
  PrSession,
  ProviderId,
  PullRequest,
  RecentReview,
  ReviewEvent,
  ReviewState,
  ReviewThread,
  Stack,
  Stop,
  TeamLessons,
  TourRecord,
} from '../shared/types'
import { run } from './exec'
import { treeEntries, Workspace } from './git'
import { changedPaths, fileDigests } from './digest'
import { fetchPullRequest, fetchStack, fetchThreads, parsePrRef, submitReview } from './github'
import { parseStructured } from './json'
import { LESSONS_MAX_AGE_MS, learnLessons } from './lessons'
import { resolveInside } from './paths'
import { askPrompt, gradePrompt, polishPrompt, sessionSeedPrompt, tourPrompt, tourRepairPrompt } from './prompts'
import type { Provider, TaskContext } from './providers/provider'
import { draftProblem, lineOnSide } from '../shared/review'
import { Store } from './store'
import { normalizeTour, previewTour, rawTourSchema, tourJsonSchema } from './tour'

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
  threads: ReviewThread[]
  lessons: TeamLessons | null
  previous: PreviousReview | null
  conversations: Partial<Record<ProviderId, Conversation>>
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
    const [tour, saved, threads, lessons] = await Promise.all([
      this.store.latestTour(ref, pr.headSha),
      this.store.loadReview(ref, pr.headSha),
      fetchThreads(ref).catch(() => []),
      this.store.loadLessons(ref),
    ])
    const review = saved ?? (await this.freshReview(pr, diff, worktree))
    this.store.recordOpened(pr)
    this.open.set(refKey(ref), {
      pr,
      stack,
      diff,
      worktree,
      tour,
      threads,
      lessons,
      previous: review.previous,
      conversations: {},
    })
    return { pr, stack, diff, tour, review, threads, lessons }
  }

  recentReviews(): Promise<RecentReview[]> {
    return this.store.recentReviews(20)
  }

  async refreshLessons(ref: PrRef, provider: Provider, task: TaskContext): Promise<TeamLessons> {
    const session = this.session(ref)
    const lessons = await learnLessons(ref, provider, session.worktree, task)
    this.store.saveLessons(ref, lessons)
    session.lessons = lessons
    return lessons
  }

  async generateTour(ref: PrRef, provider: Provider, task: TaskContext): Promise<TourRecord> {
    const session = this.session(ref)
    const lessons = await this.currentLessons(ref, provider, task)
    task.onEvent({ kind: 'step', text: `Exploring the repository with ${provider.id}` })
    const request = {
      cwd: session.worktree,
      schema: tourJsonSchema,
      tools: 'repo' as const,
      streamDrafts: true,
      signal: task.signal,
    }
    const context = { lessons, threads: session.threads, previous: session.previous }
    let result = await provider.run({
      ...request,
      onEvent: previewTour(session.diff, task.onEvent),
      prompt: tourPrompt(session.pr, session.stack, session.diff, context),
      resume: null,
    })
    let parsed = parseStructured(result.text, rawTourSchema)
    if (!parsed.success && result.sessionId) {
      task.onEvent({ kind: 'step', text: 'Correcting the tour format' })
      result = await provider.run({
        ...request,
        onEvent: previewTour(session.diff, task.onEvent),
        prompt: tourRepairPrompt(parsed.error),
        resume: result.sessionId,
      })
      parsed = parseStructured(result.text, rawTourSchema)
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
      lessons,
      tour: normalizeTour(parsed.data, session.diff),
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
    selection: CodeSelection | null,
    task: TaskContext,
  ): Promise<ChatMessage> {
    const stop = stopId ? this.stop(ref, stopId) : null
    const selected = selection ? { selection, code: await this.selectedCode(ref, selection) } : null
    const text = await this.converse(ref, provider, stop, askPrompt(stop, question, selected), task)
    return { id: randomUUID(), role: 'assistant', text, stopId, selection: null, createdAt: new Date().toISOString() }
  }

  private async selectedCode(ref: PrRef, selection: CodeSelection): Promise<string> {
    const file = this.session(ref).diff.files.find((candidate) => candidate.path === selection.path)
    const path = selection.side === 'LEFT' ? (file?.oldPath ?? selection.path) : selection.path
    const contents = await this.readFile(ref, path, selection.side === 'LEFT' ? 'base' : 'head')
    if (contents === null) throw new Error(`Couldn't read ${path}.`)
    const start = Math.max(1, selection.startLine)
    return contents
      .split('\n')
      .slice(start - 1, Math.max(start, selection.endLine))
      .join('\n')
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
      streamDrafts: false,
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

  /** Lessons are context, not a prerequisite: failing to learn them never blocks a tour. */
  private async currentLessons(ref: PrRef, provider: Provider, task: TaskContext): Promise<TeamLessons | null> {
    const cached = this.session(ref).lessons
    if (cached && Date.now() - Date.parse(cached.generatedAt) < LESSONS_MAX_AGE_MS) return cached
    try {
      return await this.refreshLessons(ref, provider, task)
    } catch (error) {
      task.signal.throwIfAborted()
      task.onEvent({
        kind: 'step',
        text: `Skipped team review lessons: ${error instanceof Error ? error.message : error}`,
      })
      return cached
    }
  }

  /**
   * A new push starts a fresh review. Unsent drafts from the reviewer's latest earlier review carry
   * over, and the files whose changes differ from what they saw are recorded.
   */
  private async freshReview(pr: PullRequest, diff: Diff, worktree: string): Promise<ReviewState> {
    const textless = diff.files.filter((file) => file.hunks.length === 0).map((file) => file.path)
    const digests = fileDigests(diff, await treeEntries(worktree, pr.headSha, textless))
    const prior = await this.store.latestOtherReview(pr.ref, pr.headSha)
    const drafts = prior?.drafts.map((draft) => ({ ...draft, stopId: null })) ?? []
    return {
      pr: pr.ref,
      headSha: pr.headSha,
      previous: prior
        ? {
            headSha: prior.headSha,
            changedPaths: changedPaths(prior.fileDigests ?? {}, digests),
            carriedDrafts: drafts.length,
          }
        : null,
      fileDigests: digests,
      visitedStopIds: [],
      stops: {},
      drafts,
      chat: [],
      body: prior?.body ?? '',
      submittedReviewUrl: null,
    }
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
            streamDrafts: true,
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
