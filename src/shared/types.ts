export type ProviderId = 'claude' | 'codex'

export interface PrRef {
  owner: string
  repo: string
  number: number
}

export interface LinkedIssue {
  number: number
  title: string
  body: string
  url: string
}

export interface PullRequest {
  ref: PrRef
  url: string
  title: string
  body: string
  author: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  baseRefName: string
  headRefName: string
  baseSha: string
  headSha: string
  additions: number
  deletions: number
  changedFiles: number
  linkedIssues: LinkedIssue[]
}

export interface PrSummary {
  ref: PrRef
  url: string
  title: string
  author: string
  isDraft: boolean
  updatedAt: string
}

export interface StackEntry {
  number: number
  title: string
  url: string
  headRefName: string
  baseRefName: string
}

/** Ordered from the PR closest to the trunk up to the top of the stack; includes the current PR. */
export interface Stack {
  trunk: string
  entries: StackEntry[]
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface DiffLine {
  kind: 'context' | 'add' | 'del'
  oldLine: number | null
  newLine: number | null
  text: string
}

export interface Hunk {
  /** Sequential across the whole diff (`H1`, `H2`, …) so agents can reference hunks compactly. */
  id: string
  path: string
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  oldPath: string | null
  status: FileStatus
  isBinary: boolean
  isGenerated: boolean
  additions: number
  deletions: number
  hunks: Hunk[]
}

export interface Diff {
  mergeBaseSha: string
  headSha: string
  files: DiffFile[]
}

export type Risk = 'low' | 'medium' | 'high'

export interface CodeLocation {
  path: string
  startLine: number
  endLine: number
}

export interface ContextRef extends CodeLocation {
  why: string
}

export interface ConventionNote {
  observation: string
  precedents: CodeLocation[]
}

export interface ComprehensionQuestion {
  prompt: string
  answer: string
}

export interface Stop {
  id: string
  title: string
  hunkIds: string[]
  explanation: string
  risk: Risk
  riskReason: string
  checks: string[]
  context: ContextRef[]
  conventions: ConventionNote[]
  question: ComprehensionQuestion | null
}

export interface Chapter {
  id: string
  title: string
  goal: string
  stops: Stop[]
}

export type ClaimStatus = 'delivered' | 'partial' | 'missing'

export interface IntentClaim {
  claim: string
  status: ClaimStatus
  evidence: string
}

export interface UnexplainedChange {
  description: string
  hunkIds: string[]
}

export interface IntentCheck {
  stated: string[]
  claims: IntentClaim[]
  unexplained: UnexplainedChange[]
}

export interface Tour {
  summary: string
  intent: IntentCheck
  chapters: Chapter[]
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  costUsd: number | null
}

export interface TourRecord {
  pr: PrRef
  headSha: string
  provider: ProviderId
  model: string
  sessionId: string | null
  createdAt: string
  usage: Usage | null
  /** The team review lessons the tour was held to. */
  lessons: TeamLessons | null
  tour: Tour
}

export interface StopProgress {
  understood: boolean
  prediction: string
  revealed: boolean
  predictionFeedback: string | null
  checksDone: number[]
}

export type DiffSide = 'LEFT' | 'RIGHT'

export interface DraftComment {
  id: string
  path: string
  side: DiffSide
  startLine: number | null
  line: number
  body: string
  stopId: string | null
  createdAt: string
}

/** Lines the reviewer selected in a diff file (`path` is its path in the PR); LEFT lines are numbered before the change. */
export interface CodeSelection {
  path: string
  side: DiffSide
  startLine: number
  endLine: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  stopId: string | null
  selection: CodeSelection | null
  createdAt: string
}

export interface PreviousReview {
  headSha: string
  /** Files whose changes differ from what the reviewer saw, including files added to or dropped from the PR. */
  changedPaths: string[]
  carriedDrafts: number
}

export interface ReviewState {
  pr: PrRef
  headSha: string
  /** The reviewer's last review of an earlier head commit of this PR, if any. */
  previous: PreviousReview | null
  /** Content hash of each file's changes, so a later push can be compared with what was reviewed. */
  fileDigests: Record<string, string>
  visitedStopIds: string[]
  stops: Record<string, StopProgress>
  drafts: DraftComment[]
  chat: ChatMessage[]
  body: string
  submittedReviewUrl: string | null
}

export interface ThreadComment {
  author: string
  body: string
  createdAt: string
  url: string
}

/** A GitHub review thread. `line` is null for whole-file threads and once a thread no longer maps onto the diff. */
export interface ReviewThread {
  id: string
  path: string
  side: DiffSide
  line: number | null
  startLine: number | null
  isResolved: boolean
  isOutdated: boolean
  comments: ThreadComment[]
}

export interface TeamLesson {
  title: string
  detail: string
  examples: string[]
}

/** Recurring expectations distilled from a repository's past review comments. */
export interface TeamLessons {
  generatedAt: string
  sourceCount: number
  lessons: TeamLesson[]
}

export interface RecentReview {
  ref: PrRef
  url: string
  title: string
  openedAt: string
}

export interface PrSession {
  pr: PullRequest
  stack: Stack
  diff: Diff
  tour: TourRecord | null
  review: ReviewState
  threads: ReviewThread[]
  lessons: TeamLessons | null
}

export type AuthMode = 'apiKey' | 'subscription'

export interface ProviderSettings {
  auth: AuthMode
  model: string
  reasoningEffort: 'low' | 'medium' | 'high'
}

export interface Settings {
  provider: ProviderId
  claude: ProviderSettings
  codex: ProviderSettings
  dojoMode: boolean
}

export interface ProviderStatus {
  ready: boolean
  detail: string
}

export interface EnvironmentStatus {
  gh: { ready: boolean; user: string | null; detail: string }
  providers: Record<ProviderId, ProviderStatus & { hasApiKey: boolean }>
}

export type ReviewEvent = 'PENDING' | 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'

/** `draft` carries the whole answer written so far, replacing any earlier draft. */
export interface AgentEvent {
  kind: 'step' | 'text' | 'draft'
  text: string
}

/**
 * `tour` carries the readable part of a tour that is still being written; null means the agent is
 * rewriting the tour from scratch, so earlier previews and any progress keyed to their stops are void.
 */
export type TaskEvent = AgentEvent | { kind: 'tour'; tour: Tour | null }

export type ProgressEvent = TaskEvent & { taskId: string }

export interface DojoApi {
  environment(): Promise<EnvironmentStatus>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>
  setApiKey(provider: ProviderId, key: string | null): Promise<void>

  listReviewRequests(): Promise<PrSummary[]>
  recentReviews(): Promise<RecentReview[]>
  openPullRequest(url: string, taskId: string): Promise<PrSession>
  generateTour(pr: PrRef, taskId: string): Promise<TourRecord>
  ask(
    pr: PrRef,
    stopId: string | null,
    question: string,
    selection: CodeSelection | null,
    taskId: string,
  ): Promise<ChatMessage>
  gradePrediction(pr: PrRef, stopId: string, prediction: string, taskId: string): Promise<string>
  polishComment(pr: PrRef, draft: DraftComment, taskId: string): Promise<string>
  cancel(taskId: string): Promise<void>

  saveReview(review: ReviewState): Promise<void>
  submitReview(review: ReviewState, event: ReviewEvent): Promise<string>
  refreshLessons(pr: PrRef, taskId: string): Promise<TeamLessons>
  readFile(pr: PrRef, path: string, version: 'base' | 'head'): Promise<string | null>
  resolvePath(pr: PrRef, path: string): Promise<string | null>
  openExternal(url: string): Promise<void>

  onProgress(listener: (event: ProgressEvent) => void): () => void
}
