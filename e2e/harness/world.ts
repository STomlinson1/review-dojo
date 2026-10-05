import type { Gh } from './gh'
import { failure, json } from './gh'
import type { FixturePr } from './remotes'

export const REVIEWER = 'octo-reviewer'

export const slug = (pr: FixturePr) => `${pr.owner}/${pr.repo}`
export const key = (pr: FixturePr) => `${slug(pr)}#${pr.number}`

export interface ThreadFixture {
  id: string
  path: string
  line: number | null
  startLine?: number | null
  diffSide?: 'LEFT' | 'RIGHT'
  isResolved?: boolean
  isOutdated?: boolean
  comments: { author: string; body: string; url: string }[]
}

export interface PastComment {
  path: string
  body: string
  diff_hunk: string
  html_url: string
  user: { login: string; type: string }
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

export function signedIn(gh: Gh): void {
  gh.set('user', { stdout: `${REVIEWER}\n` })
  gh.set('review-requests', json([]))
}

export function signedOut(gh: Gh): void {
  gh.set('user', failure('To get started with GitHub CLI, please run:  gh auth login'))
}

export function reviewRequests(gh: Gh, prs: FixturePr[]): void {
  gh.set(
    'review-requests',
    json(
      prs.map((pr) => ({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        isDraft: false,
        updatedAt: minutesAgo(5),
        author: { login: 'alice' },
        repository: { nameWithOwner: slug(pr) },
      })),
    ),
  )
}

export function stackEntry(pr: FixturePr) {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    isCrossRepository: false,
  }
}

export function prView(pr: FixturePr) {
  return {
    number: pr.number,
    url: pr.url,
    title: pr.title,
    body: pr.body,
    author: { login: 'alice' },
    state: 'OPEN',
    isDraft: false,
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    baseRefOid: pr.baseSha,
    headRefOid: pr.headSha,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    closingIssuesReferences: [],
  }
}

/** Scripts everything opening `pr` asks GitHub for: no stack, no threads, no past review comments. */
export function pullRequest(gh: Gh, pr: FixturePr): void {
  gh.set(`pr ${key(pr)}`, json(prView(pr)))
  gh.set(`stack ${key(pr)}`, json({ data: { repository: { pullRequest: { stack: null } } } }))
  gh.set(`open-prs ${slug(pr)}`, json([stackEntry(pr)]))
  threads(gh, pr, [])
  pastReviewComments(gh, pr, [])
}

export function threads(gh: Gh, pr: FixturePr, fixtures: ThreadFixture[]): void {
  const nodes = fixtures.map((thread, threadIndex) => ({
    id: thread.id,
    path: thread.path,
    line: thread.line,
    startLine: thread.startLine ?? null,
    diffSide: thread.diffSide ?? 'RIGHT',
    subjectType: 'LINE',
    isResolved: thread.isResolved ?? false,
    isOutdated: thread.isOutdated ?? false,
    comments: {
      nodes: thread.comments.map((comment, index) => ({
        author: { login: comment.author },
        body: comment.body,
        createdAt: minutesAgo(60 * (threadIndex + 1) - index),
        url: comment.url,
      })),
    },
  }))
  gh.set(`threads ${key(pr)}`, json([{ data: { repository: { pullRequest: { reviewThreads: { nodes } } } } }]))
}

/** The app reads three pages; `comments` fills the first and the rest stay empty. */
export function pastReviewComments(gh: Gh, pr: FixturePr, comments: PastComment[]): void {
  gh.set(`review-comments ${slug(pr)} page 1`, json(comments))
  gh.set(`review-comments ${slug(pr)} page 2`, json([]))
  gh.set(`review-comments ${slug(pr)} page 3`, json([]))
}

export function reviewAccepted(gh: Gh, pr: FixturePr, reviewId = 1): string {
  const url = `${pr.url}#pullrequestreview-${reviewId}`
  gh.set(`submit ${key(pr)}`, json({ html_url: url }))
  return url
}
