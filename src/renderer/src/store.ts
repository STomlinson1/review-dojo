import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import type {
  AgentEvent,
  ChatMessage,
  CodeLocation,
  CodeSelection,
  ContextRef,
  DraftComment,
  EnvironmentStatus,
  ProviderId,
  PrSession,
  ReviewEvent,
  ReviewState,
  Settings,
  StopProgress,
  Tour,
} from '../../shared/types'
import { dojo, errorMessage, startTask } from './api'
import { EMPTY_PROGRESS, findStop, tourStops } from '../../shared/tour'
import { firstHunkInDiff } from './lib/fullDiff'
import { type Layout, initialLayout, rememberLayout, sideBySideFits } from './lib/layout'

export type TaskKey = 'open' | 'tour' | 'ask' | 'lessons' | `grade:${string}` | `polish:${string}`

export interface RunningTask {
  id: string
  startedAt: number
  eventCount: number
  /** Steps and narration, newest last. */
  events: AgentEvent[]
  /** The answer as written so far. */
  draft: string | null
  /** The readable part of a tour that is still being written. */
  preview: Tour | null
}

export type PeekTarget = CodeLocation | ContextRef

export type Overlay = { kind: 'settings' } | { kind: 'submit' } | { kind: 'peek'; target: PeekTarget } | null

export type DiffStyle = 'unified' | 'split'

type NarrationTab = 'stop' | 'ask'

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
  narrationTab: NarrationTab
  diffFocus: DiffFocus | null
  spiedStopId: string | null
  askOpen: boolean
  askFocusRequest: number
  askSelection: CodeSelection | null
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
  setNarrationTab(tab: NarrationTab): void
  showInFullDiff(hunkId: string): void
  setSpiedStopId(stopId: string | null): void
  setAskOpen(open: boolean): void
  focusAsk(): void
  askAbout(selection: CodeSelection | null): void
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

const SAVE_DELAY_MS = 400
const MAX_SAVE_DELAY_MS = 2000
const MAX_TASK_EVENTS = 50

let unsavedReview: ReviewState | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
let firstUnsavedAt: number | null = null
let saveChain: Promise<void> = Promise.resolve()
const cancelledTaskIds = new Set<string>()

export const useDojo = create<DojoState & DojoActions>()((set, get) => ({
  bootError: null,
  settings: null,
  environment: null,
  environmentError: null,
  session: null,
  selectedStopId: null,
  dojoMode: false,
  diffStyle: 'unified',
  layout: initialLayout(),
  narrationTab: 'stop',
  diffFocus: null,
  spiedStopId: null,
  askOpen: true,
  askFocusRequest: 0,
  askSelection: null,
  overlay: null,
  tasks: {},
  errors: {},
  saveError: null,
  polishSuggestions: {},

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
    const session = await runTask('open', (taskId) => dojo.openPullRequest(input.trim(), taskId))
    if (!session) return
    cancelSessionTasks()
    set((state) => ({
      session,
      selectedStopId: null,
      diffFocus: null,
      spiedStopId: null,
      dojoMode: state.settings?.dojoMode ?? state.dojoMode,
      askSelection: null,
      overlay: null,
      errors: {},
      saveError: null,
      polishSuggestions: {},
    }))
  },

  closePullRequest() {
    void flushReview()
    cancelSessionTasks()
    set({
      session: null,
      selectedStopId: null,
      diffFocus: null,
      spiedStopId: null,
      askSelection: null,
      overlay: null,
      errors: {},
      polishSuggestions: {},
    })
  },

  async generateTour() {
    const { session, tasks } = get()
    if (!session || tasks.tour) return
    cancelSessionTasks()
    set({ selectedStopId: null, spiedStopId: null })
    // Stop ids restart with every tour, so progress keyed by them would attach to the wrong stops.
    // Previews already use the new tour's ids, so the reset happens before the first one arrives.
    updateReview((review) => ({
      ...review,
      visitedStopIds: [],
      stops: {},
      chat: review.chat.map((message) => ({ ...message, stopId: null })),
      drafts: review.drafts.map((draft) => ({ ...draft, stopId: null })),
    }))
    const record = await runTask('tour', (taskId) => dojo.generateTour(session.pr.ref, taskId))
    if (!record) return
    set((state) => (state.session?.pr.url === session.pr.url ? { session: { ...state.session, tour: record } } : {}))
  },

  cancelTask(key) {
    const task = get().tasks[key]
    if (!task) return
    cancelledTaskIds.add(task.id)
    dojo.cancel(task.id).catch((error: unknown) => {
      cancelledTaskIds.delete(task.id)
      set((state) => ({ errors: { ...state.errors, [key]: errorMessage(error) } }))
    })
  },

  dismissError(key) {
    set((state) => ({ errors: without(state.errors, key) }))
  },

  select(stopId) {
    const session = get().session
    const tour = currentTour(get())
    const stop = stopId && tour ? findStop(tour, stopId)?.stop : undefined
    const hunkId = stop && session ? firstHunkInDiff(session.diff, stop.hunkIds) : null
    set((state) => ({
      selectedStopId: stopId,
      diffFocus: hunkId ? nextFocus(state.diffFocus, hunkId) : state.diffFocus,
    }))
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

  setNarrationTab(tab) {
    set({ narrationTab: tab })
  },

  showInFullDiff(hunkId) {
    get().setLayout('side-by-side')
    set((state) => ({ diffFocus: nextFocus(state.diffFocus, hunkId) }))
  },

  setSpiedStopId(stopId) {
    if (get().spiedStopId !== stopId) set({ spiedStopId: stopId })
  },

  setAskOpen(open) {
    set({ askOpen: open })
  },

  focusAsk() {
    set((state) => ({ askOpen: true, narrationTab: 'ask', askFocusRequest: state.askFocusRequest + 1 }))
  },

  askAbout(selection) {
    set({ askSelection: selection })
    if (selection) get().focusAsk()
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
    set((state) => ({ polishSuggestions: without(state.polishSuggestions, id) }))
  },

  setReviewBody(body) {
    updateReview((review) => ({ ...review, body }))
  },

  async ask(question) {
    const { session, selectedStopId, tasks, askSelection } = get()
    if (!session || tasks.ask || tourPreview(get())) return
    const selection = askSelection ?? undefined
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
    const answer = await runTask('ask', (taskId) =>
      dojo.ask(session.pr.ref, selectedStopId, question, taskId, selection),
    )
    if (answer) updateReview((review) => ({ ...review, chat: [...review.chat, answer] }), session.pr.url)
  },

  async refreshLessons() {
    const { session, tasks } = get()
    if (!session || tasks.lessons) return
    const lessons = await runTask('lessons', (taskId) => dojo.refreshLessons(session.pr.ref, taskId))
    if (!lessons) return
    set((state) => (state.session?.pr.url === session.pr.url ? { session: { ...state.session, lessons } } : {}))
  },

  async gradePrediction(stopId) {
    const { session } = get()
    const prediction = session?.review.stops[stopId]?.prediction.trim()
    if (!session || !prediction || tourPreview(get())) return
    const feedback = await runTask(`grade:${stopId}`, (taskId) =>
      dojo.gradePrediction(session.pr.ref, stopId, prediction, taskId),
    )
    if (feedback !== null) {
      updateReview((review) => withStopProgress(review, stopId, { predictionFeedback: feedback }), session.pr.url)
    }
  },

  async polishDraft(draftId) {
    const { session } = get()
    const draft = session?.review.drafts.find((candidate) => candidate.id === draftId)
    if (!session || !draft) return
    const suggestion = await runTask(`polish:${draftId}`, (taskId) => dojo.polishComment(session.pr.ref, draft, taskId))
    if (suggestion === null || get().session?.pr.url !== session.pr.url) return
    set((state) => ({ polishSuggestions: { ...state.polishSuggestions, [draftId]: suggestion } }))
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

function updateReview(recipe: (review: ReviewState) => ReviewState, expectedPrUrl?: string): void {
  const { session } = useDojo.getState()
  if (!session || (expectedPrUrl !== undefined && session.pr.url !== expectedPrUrl)) return
  const review = recipe(session.review)
  if (review === session.review) return
  useDojo.setState({ session: { ...session, review } })
  // Continuous typing keeps resetting the debounce, so a change never waits longer than the cap.
  firstUnsavedAt ??= Date.now()
  unsavedReview = review
  clearTimeout(saveTimer)
  const delay = Math.min(SAVE_DELAY_MS, firstUnsavedAt + MAX_SAVE_DELAY_MS - Date.now())
  saveTimer = setTimeout(() => void flushReview(), Math.max(0, delay))
}

function nextFocus(current: DiffFocus | null, hunkId: string): DiffFocus {
  return { hunkId, request: (current?.request ?? 0) + 1 }
}

function withStopProgress(review: ReviewState, stopId: string, patch: Partial<StopProgress>): ReviewState {
  return { ...review, stops: { ...review.stops, [stopId]: { ...EMPTY_PROGRESS, ...review.stops[stopId], ...patch } } }
}

/** Tracks a bridge task under `key`; resolves to null when it fails or is cancelled. */
async function runTask<T>(key: TaskKey, run: (taskId: string) => Promise<T>): Promise<T | null> {
  const { setState } = useDojo
  const task = startTask(run, (event) =>
    setState((state) => {
      const current = state.tasks[key]
      if (current?.id !== task.id) return {}
      const next: RunningTask =
        event.kind === 'tour'
          ? { ...current, preview: event.tour }
          : event.kind === 'draft'
            ? { ...current, draft: event.text }
            : {
                ...current,
                events: [...current.events.slice(1 - MAX_TASK_EVENTS), { kind: event.kind, text: event.text }],
                eventCount: current.eventCount + 1,
              }
      return { tasks: { ...state.tasks, [key]: next } }
    }),
  )
  setState((state) => ({
    tasks: {
      ...state.tasks,
      [key]: { id: task.id, startedAt: Date.now(), eventCount: 0, events: [], draft: null, preview: null },
    },
    errors: without(state.errors, key),
  }))
  try {
    const result = await task.result
    return cancelledTaskIds.has(task.id) ? null : result
  } catch (error) {
    if (!cancelledTaskIds.has(task.id))
      setState((state) => ({ errors: { ...state.errors, [key]: errorMessage(error) } }))
    return null
  } finally {
    cancelledTaskIds.delete(task.id)
    setState((state) => (state.tasks[key]?.id === task.id ? { tasks: without(state.tasks, key) } : {}))
  }
}

function cancelSessionTasks(): void {
  const { tasks, cancelTask } = useDojo.getState()
  for (const key of Object.keys(tasks) as TaskKey[]) {
    if (key !== 'open') cancelTask(key)
  }
}

function without<K extends string, V>(record: Partial<Record<K, V>>, key: K): Partial<Record<K, V>> {
  const next = { ...record }
  delete next[key]
  return next
}
