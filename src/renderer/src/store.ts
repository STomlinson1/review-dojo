import type { SelectedLineRange } from '@pierre/diffs'
import { useMemo, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import type {
  AgentEvent,
  ChatMessage,
  CodeLocation,
  CodeSelection,
  ContextRef,
  DraftComment,
  EnvironmentStatus,
  Hunk,
  ProviderId,
  PrSession,
  ReviewEvent,
  ReviewState,
  Settings,
  StopProgress,
  TaskEvent,
  Tour,
  TourRecord,
} from '../../shared/types'
import { dojo, errorMessage, startTask } from './api'
import { EMPTY_PROGRESS, changedPathsByStop, findStop, firstHunkInDiff, tourStops } from '../../shared/tour'
import type { CommentTarget } from './lib/comments'
import { type Layout, initialLayout, rememberLayout, sideBySideFits } from './lib/layout'
import { withTourProgressOf, withoutTourProgress } from './lib/progress'

export type TaskKey = 'open' | 'tour' | 'ask' | 'lessons' | `grade:${string}` | `polish:${string}`

export interface RunningTask {
  id: string
  startedAt: number
  eventCount: number
  events: AgentEvent[]
  draft: string | null
  preview: Tour | null
  progressBeforePreview: ReviewState | null
}

export type PeekTarget = CodeLocation | ContextRef

export type Overlay = { kind: 'settings' } | { kind: 'submit' } | { kind: 'peek'; target: PeekTarget } | null

export type DiffStyle = 'unified' | 'split'

export type DiffFilter = 'all' | 'changedSinceReview'

export interface Composer {
  range: SelectedLineRange
  target: CommentTarget | { error: string }
  body: string
}

interface DiffFocus {
  hunkId: string
  request: number
}

interface DojoState {
  bootError: string | null
  settings: Settings | null
  environment: EnvironmentStatus | null
  environmentError: string | null
  session: PrSession | null
  selectedStopId: string | null
  dojoMode: boolean
  diffStyle: DiffStyle
  layout: Layout
  diffFocus: DiffFocus | null
  diffFilter: DiffFilter
  spiedStopId: string | null
  askOpen: boolean
  askFocusRequest: number
  askSelection: CodeSelection | null
  composers: Partial<Record<string, Composer>>
  draftEdits: Partial<Record<string, string>>
  overlay: Overlay
  tasks: Partial<Record<TaskKey, RunningTask>>
  errors: Partial<Record<TaskKey, string>>
  saveError: string | null
  polishSuggestions: Partial<Record<string, string>>
}

interface DojoActions {
  boot(): Promise<void>
  refreshEnvironment(): Promise<void>
  saveSettings(settings: Settings): Promise<void>
  setApiKey(provider: ProviderId, key: string | null): Promise<void>
  openPullRequest(input: string): Promise<void>
  closePullRequest(): void
  generateTour(): Promise<void>
  cancelTask(key: TaskKey): void
  dismissError(key: TaskKey): void
  select(stopId: string | null): void
  step(delta: 1 | -1): void
  setDojoMode(on: boolean): void
  setDiffStyle(style: DiffStyle): void
  setLayout(layout: Layout): void
  setDiffFilter(filter: DiffFilter): void
  showInFullDiff(hunk: Hunk): void
  setSpiedStopId(stopId: string | null): void
  setAskOpen(open: boolean): void
  focusAsk(): void
  askAbout(selection: CodeSelection | null): void
  openComposer(path: string, placement: Omit<Composer, 'body'>): void
  closeComposer(path: string): void
  setComposerBody(path: string, body: string): void
  setDraftEdit(draftId: string, body: string | null): void
  setOverlay(overlay: Overlay): void
  updateStop(stopId: string, patch: Partial<StopProgress>): void
  addDraft(draft: Omit<DraftComment, 'id' | 'createdAt'>): void
  updateDraft(id: string, body: string): void
  deleteDraft(id: string): void
  setReviewBody(body: string): void
  ask(question: string): Promise<void>
  refreshLessons(): Promise<void>
  gradePrediction(stopId: string): Promise<void>
  polishDraft(draftId: string): Promise<void>
  resolvePolish(draftId: string, accept: boolean): void
  submitReview(event: ReviewEvent): Promise<void>
}

type Store = DojoState & DojoActions

const TOUR_VIEW_RESET = { selectedStopId: null, spiedStopId: null } satisfies Partial<DojoState>

const SESSION_VIEW_RESET = {
  ...TOUR_VIEW_RESET,
  diffFocus: null,
  diffFilter: 'all',
  askSelection: null,
  composers: {},
  draftEdits: {},
  overlay: null,
  errors: {},
  polishSuggestions: {},
} satisfies Partial<DojoState>

const SAVE_DELAY_MS = 400
const MAX_SAVE_DELAY_MS = 2000
const MAX_TASK_EVENTS = 50

let unsavedReview: ReviewState | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
let firstUnsavedAt: number | null = null
let saveChain: Promise<void> = Promise.resolve()
const cancelledTaskIds = new Set<string>()

export const useDojo = create<Store>()((set, get) => ({
  bootError: null,
  settings: null,
  environment: null,
  environmentError: null,
  session: null,
  dojoMode: false,
  diffStyle: 'unified',
  layout: initialLayout(),
  askOpen: false,
  askFocusRequest: 0,
  tasks: {},
  saveError: null,
  ...SESSION_VIEW_RESET,

  async boot() {
    const [settings] = await Promise.all([
      dojo.getSettings().catch((error: unknown) => {
        set({ bootError: errorMessage(error) })
        return null
      }),
      get().refreshEnvironment(),
    ])
    if (settings) set({ settings, dojoMode: settings.dojoMode })
  },

  async refreshEnvironment() {
    try {
      set({ environment: await dojo.environment(), environmentError: null })
    } catch (error) {
      set({ environmentError: errorMessage(error) })
    }
  },

  async saveSettings(settings) {
    await dojo.saveSettings(settings)
    set({ settings })
    await get().refreshEnvironment()
  },

  async setApiKey(provider, key) {
    await dojo.setApiKey(provider, key)
    await get().refreshEnvironment()
  },

  async openPullRequest(input) {
    if (get().tasks.open) return
    await flushReview()
    const left = get()
    await runTask(
      'open',
      (taskId) => dojo.openPullRequest(input.trim(), taskId),
      (session, state) => ({
        ...SESSION_VIEW_RESET,
        session,
        tasks: {},
        dojoMode: state.settings?.dojoMode ?? state.dojoMode,
        saveError: null,
      }),
    )
    if (get().session !== left.session) cancelSessionTasks(left.tasks)
  },

  closePullRequest() {
    cancelSessionTasks(get().tasks)
    set((state) => ({
      ...SESSION_VIEW_RESET,
      session: null,
      tasks: state.tasks.open ? { open: state.tasks.open } : {},
    }))
  },

  async generateTour() {
    const { session, tasks } = get()
    if (!session || tasks.tour) return
    cancelSessionTasks(tasks)
    await runTask(
      'tour',
      (taskId) => dojo.generateTour(session.pr.ref, taskId),
      (record, state) => withTour(state, record),
      (state) => (state.tasks.tour ? withPreview(state, state.tasks.tour, null) : {}),
    )
  },

  cancelTask(key) {
    const task = get().tasks[key]
    if (!task) return
    cancelledTaskIds.add(task.id)
    dojo.cancel(task.id).catch((error: unknown) => {
      cancelledTaskIds.delete(task.id)
      set((state) =>
        state.tasks[key]?.id === task.id ? { errors: { ...state.errors, [key]: errorMessage(error) } } : {},
      )
    })
  },

  dismissError(key) {
    set((state) => ({ errors: without(state.errors, key) }))
  },

  select(stopId) {
    const { session } = get()
    const tour = currentTour(get())
    const stop = stopId && tour ? findStop(tour, stopId)?.stop : undefined
    const hunk = stop && session ? firstHunkInDiff(session.diff, stop.hunkIds) : undefined
    set((state) => ({ selectedStopId: stopId, ...(hunk ? focusOn(state, hunk) : {}) }))
    if (stopId === null) return
    updateReview((review) =>
      review.visitedStopIds.includes(stopId)
        ? review
        : { ...review, visitedStopIds: [...review.visitedStopIds, stopId] },
    )
  },

  step(delta) {
    const { selectedStopId, select } = get()
    const tour = currentTour(get())
    if (!tour) return
    const order = [null, ...tourStops(tour).map((stop) => stop.id)]
    const next = order[order.indexOf(selectedStopId) + delta]
    if (next !== undefined) select(next)
  },

  setDojoMode(on) {
    set({ dojoMode: on })
  },

  setDiffStyle(style) {
    set({ diffStyle: style })
  },

  setLayout(layout) {
    rememberLayout(layout)
    set({ layout })
  },

  setDiffFilter(filter) {
    set({ diffFilter: filter })
  },

  showInFullDiff(hunk) {
    get().setLayout('side-by-side')
    set((state) => focusOn(state, hunk))
  },

  setSpiedStopId(stopId) {
    if (get().spiedStopId !== stopId) set({ spiedStopId: stopId })
  },

  setAskOpen(open) {
    set({ askOpen: open })
  },

  focusAsk() {
    set((state) => ({ askOpen: true, askFocusRequest: state.askFocusRequest + 1 }))
  },

  askAbout(selection) {
    set({ askSelection: selection })
    if (selection) get().focusAsk()
  },

  openComposer(path, placement) {
    set((state) => ({
      composers: { ...state.composers, [path]: { ...placement, body: state.composers[path]?.body ?? '' } },
    }))
  },

  closeComposer(path) {
    set((state) => ({ composers: without(state.composers, path) }))
  },

  setComposerBody(path, body) {
    set((state) => {
      const composer = state.composers[path]
      return composer ? { composers: { ...state.composers, [path]: { ...composer, body } } } : {}
    })
  },

  setDraftEdit(draftId, body) {
    set((state) => ({
      draftEdits: body === null ? without(state.draftEdits, draftId) : { ...state.draftEdits, [draftId]: body },
    }))
  },

  setOverlay(overlay) {
    set({ overlay })
  },

  updateStop(stopId, patch) {
    updateReview((review) => withStopProgress(review, stopId, patch))
  },

  addDraft(draft) {
    const created: DraftComment = { ...draft, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    updateReview((review) => ({ ...review, drafts: [...review.drafts, created] }))
  },

  updateDraft(id, body) {
    updateReview((review) => ({
      ...review,
      drafts: review.drafts.map((draft) => (draft.id === id ? { ...draft, body } : draft)),
    }))
  },

  deleteDraft(id) {
    updateReview((review) => ({ ...review, drafts: review.drafts.filter((draft) => draft.id !== id) }))
    set((state) => ({
      polishSuggestions: without(state.polishSuggestions, id),
      draftEdits: without(state.draftEdits, id),
    }))
  },

  setReviewBody(body) {
    updateReview((review) => ({ ...review, body }))
  },

  async ask(question) {
    const { session, selectedStopId, tasks, askSelection: selection } = get()
    if (!session || tasks.ask || tourPreview(get())) return
    const asked: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: question,
      stopId: selectedStopId,
      selection,
      createdAt: new Date().toISOString(),
    }
    set({ askSelection: null })
    updateReview((review) => ({ ...review, chat: [...review.chat, asked] }))
    await runTask(
      'ask',
      (taskId) => dojo.ask(session.pr.ref, selectedStopId, question, selection, taskId),
      (answer, state) => withReview(state, (review) => ({ ...review, chat: [...review.chat, answer] })),
    )
  },

  async refreshLessons() {
    const { session, tasks } = get()
    if (!session || tasks.lessons) return
    await runTask(
      'lessons',
      (taskId) => dojo.refreshLessons(session.pr.ref, taskId),
      (lessons, state) => (state.session ? { session: { ...state.session, lessons } } : {}),
    )
  },

  async gradePrediction(stopId) {
    const { session } = get()
    const prediction = session?.review.stops[stopId]?.prediction.trim()
    if (!session || !prediction || tourPreview(get())) return
    await runTask(
      `grade:${stopId}`,
      (taskId) => dojo.gradePrediction(session.pr.ref, stopId, prediction, taskId),
      (feedback, state) =>
        withReview(state, (review) => withStopProgress(review, stopId, { predictionFeedback: feedback })),
    )
  },

  async polishDraft(draftId) {
    const { session } = get()
    const draft = session?.review.drafts.find((candidate) => candidate.id === draftId)
    if (!session || !draft) return
    await runTask(
      `polish:${draftId}`,
      (taskId) => dojo.polishComment(session.pr.ref, draft, taskId),
      (suggestion, state) => ({ polishSuggestions: { ...state.polishSuggestions, [draftId]: suggestion } }),
    )
  },

  resolvePolish(draftId, accept) {
    const suggestion = get().polishSuggestions[draftId]
    if (accept && suggestion !== undefined) get().updateDraft(draftId, suggestion)
    set((state) => ({ polishSuggestions: without(state.polishSuggestions, draftId) }))
  },

  async submitReview(event) {
    await flushReview()
    const session = get().session
    if (!session) return
    const url = await dojo.submitReview(session.review, event)
    updateReview((review) => ({ ...review, drafts: [], body: '', submittedReviewUrl: url }), session.pr.url)
    await flushReview()
  },
}))

useDojo.subscribe((state, previous) => {
  const left = previous.session
  if (!left) return
  if (state.session?.pr.url === left.pr.url) {
    if (state.session.review !== left.review) scheduleSave(state.session.review)
    return
  }
  for (const [key, task] of Object.entries(previous.tasks)) {
    // The dropped task's result is ignored either way; a failed cancel only lets it run to completion.
    if (key !== 'open' && task) dojo.cancel(task.id).catch(() => undefined)
  }
  const progress = previous.tasks.tour?.progressBeforePreview
  if (progress) unsavedReview = withTourProgressOf(left.review, progress)
  void flushReview()
})

export function useSession(): PrSession {
  const session = useDojo((state) => state.session)
  if (!session) throw new Error('No pull request is open.')
  return session
}

/** The part of a tour still being written, once it has a stop to read. */
export function tourPreview(state: DojoState): Tour | null {
  const preview = state.tasks.tour?.preview
  return preview && tourStops(preview).length > 0 ? preview : null
}

export function currentTour(state: DojoState): Tour | null {
  return tourPreview(state) ?? state.session?.tour?.tour ?? null
}

export function useTour(): Tour | null {
  return useDojo(currentTour)
}

export function usePreviewing(): boolean {
  return useDojo((state) => tourPreview(state) !== null)
}

export function useChangedPathsByStop(): Map<string, string[]> | null {
  const tour = useTour()
  const diff = useDojo((state) => state.session?.diff)
  const changedPaths = useDojo((state) => state.session?.review.previous?.changedPaths)
  return useMemo(
    () => (tour && diff && changedPaths ? changedPathsByStop(tour, diff, changedPaths) : null),
    [tour, diff, changedPaths],
  )
}

export function isSideBySide(layout: Layout): boolean {
  return layout === 'side-by-side' && sideBySideFits.matches
}

export function useSideBySide(): { active: boolean; fits: boolean } {
  const layout = useDojo((state) => state.layout)
  const fits = useSyncExternalStore(subscribeToWidth, () => sideBySideFits.matches)
  return { active: layout === 'side-by-side' && fits, fits }
}

function subscribeToWidth(onChange: () => void): () => void {
  sideBySideFits.addEventListener('change', onChange)
  return () => sideBySideFits.removeEventListener('change', onChange)
}

export function flushReview(): Promise<void> {
  clearTimeout(saveTimer)
  const review = unsavedReview
  unsavedReview = null
  firstUnsavedAt = null
  if (review) {
    saveChain = saveChain
      .then(() => dojo.saveReview(review))
      .then(
        () => useDojo.setState({ saveError: null }),
        (error: unknown) => useDojo.setState({ saveError: errorMessage(error) }),
      )
  }
  return saveChain
}

function scheduleSave(review: ReviewState): void {
  // Continuous typing keeps resetting the debounce, so a change never waits longer than the cap.
  firstUnsavedAt ??= Date.now()
  unsavedReview = review
  clearTimeout(saveTimer)
  const delay = Math.min(SAVE_DELAY_MS, firstUnsavedAt + MAX_SAVE_DELAY_MS - Date.now())
  saveTimer = setTimeout(() => void flushReview(), Math.max(0, delay))
}

function updateReview(recipe: (review: ReviewState) => ReviewState, expectedPrUrl?: string): void {
  useDojo.setState((state) =>
    expectedPrUrl === undefined || state.session?.pr.url === expectedPrUrl ? withReview(state, recipe) : {},
  )
}

function withReview(state: DojoState, recipe: (review: ReviewState) => ReviewState): Partial<DojoState> {
  const { session } = state
  if (!session) return {}
  const review = recipe(session.review)
  return review === session.review ? {} : { session: { ...session, review } }
}

function withStopProgress(review: ReviewState, stopId: string, patch: Partial<StopProgress>): ReviewState {
  return { ...review, stops: { ...review.stops, [stopId]: { ...EMPTY_PROGRESS, ...review.stops[stopId], ...patch } } }
}

function focusOn(state: DojoState, hunk: Hunk): Partial<DojoState> {
  const hidden =
    state.diffFilter === 'changedSinceReview' && !state.session?.review.previous?.changedPaths.includes(hunk.path)
  return {
    diffFocus: { hunkId: hunk.id, request: (state.diffFocus?.request ?? 0) + 1 },
    diffFilter: hidden ? 'all' : state.diffFilter,
  }
}

/**
 * Stop ids restart with every tour, so progress on the tour being replaced is set aside while a
 * preview is shown and comes back if the preview is discarded.
 */
function withPreview(state: DojoState, task: RunningTask, preview: Tour | null): Partial<DojoState> {
  const { session } = state
  const shown = preview !== null && tourStops(preview).length > 0
  const setAside = task.progressBeforePreview
  if (!session || shown === (setAside !== null)) return { tasks: { ...state.tasks, tour: { ...task, preview } } }
  return {
    ...TOUR_VIEW_RESET,
    tasks: { ...state.tasks, tour: { ...task, preview, progressBeforePreview: shown ? session.review : null } },
    session: {
      ...session,
      review: setAside ? withTourProgressOf(session.review, setAside) : withoutTourProgress(session.review),
    },
  }
}

/** Progress made on a preview carries over, since the finished tour keeps its stop ids. */
function withTour(state: DojoState, record: TourRecord): Partial<DojoState> {
  const { session } = state
  if (!session) return {}
  const previewed = tourPreview(state) !== null
  return {
    ...(previewed ? {} : TOUR_VIEW_RESET),
    session: {
      ...session,
      tour: record,
      lessons: record.lessons ?? session.lessons,
      review: previewed ? session.review : withoutTourProgress(session.review),
    },
  }
}

function withTaskEvent(state: DojoState, key: TaskKey, taskId: string, event: TaskEvent): Partial<DojoState> {
  const current = state.tasks[key]
  if (current?.id !== taskId) return {}
  if (event.kind === 'tour') return withPreview(state, current, event.tour)
  const next: RunningTask =
    event.kind === 'draft'
      ? { ...current, draft: event.text }
      : {
          ...current,
          events: [...current.events.slice(1 - MAX_TASK_EVENTS), { kind: event.kind, text: event.text }],
          eventCount: current.eventCount + 1,
        }
  return { tasks: { ...state.tasks, [key]: next } }
}

/**
 * Tracks a bridge task under `key`. Its outcome is applied in the same update that stops tracking
 * it, so nothing renders in between, and is dropped once the task is no longer tracked.
 */
async function runTask<T>(
  key: TaskKey,
  run: (taskId: string) => Promise<T>,
  applyResult: (result: T, state: DojoState) => Partial<DojoState>,
  applyFailure: (state: DojoState) => Partial<DojoState> = () => ({}),
): Promise<void> {
  const { setState } = useDojo
  const task = startTask(run, (event) => setState((state) => withTaskEvent(state, key, task.id, event)))
  setState((state) => ({
    tasks: {
      ...state.tasks,
      [key]: {
        id: task.id,
        startedAt: Date.now(),
        eventCount: 0,
        events: [],
        draft: null,
        preview: null,
        progressBeforePreview: null,
      },
    },
    errors: without(state.errors, key),
  }))
  let settle: (state: DojoState) => Partial<DojoState>
  try {
    const result = await task.result
    settle = cancelledTaskIds.has(task.id) ? applyFailure : (state) => applyResult(result, state)
  } catch (error) {
    const message = cancelledTaskIds.has(task.id) ? null : errorMessage(error)
    settle = (state) => ({
      ...applyFailure(state),
      ...(message === null ? {} : { errors: { ...state.errors, [key]: message } }),
    })
  }
  cancelledTaskIds.delete(task.id)
  setState((state) => {
    if (state.tasks[key]?.id !== task.id) return {}
    const next = settle(state)
    return { ...next, tasks: without(next.tasks ?? state.tasks, key) }
  })
}

/** Stops the engine work behind a session's tasks, even once they are no longer in the store. */
function cancelSessionTasks(tasks: DojoState['tasks']): void {
  for (const [key, task] of Object.entries(tasks)) {
    if (key === 'open' || !task) continue
    cancelledTaskIds.add(task.id)
    void dojo.cancel(task.id)
  }
}

function without<K extends string, V>(record: Partial<Record<K, V>>, key: K): Partial<Record<K, V>> {
  const next = { ...record }
  delete next[key]
  return next
}
