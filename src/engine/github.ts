import type {
  DiffSide,
  DraftComment,
  PrRef,
  PrSummary,
  PullRequest,
  ReviewEvent,
  ReviewThread,
  Stack,
  StackEntry,
} from '../shared/types'
import { CommandError, run } from './exec'
import { detectStack } from './stack'

const PR_URL = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
const PR_SHORTHAND = /^([\w.-]+)\/([\w.-]+)#(\d+)$/

export function parsePrRef(input: string): PrRef {
  const trimmed = input.trim()
  const match = PR_URL.exec(trimmed) ?? PR_SHORTHAND.exec(trimmed)
  if (!match) throw new Error(`Not a GitHub pull request URL: ${trimmed}`)
  return { owner: match[1], repo: match[2], number: Number(match[3]) }
}

async function gh<T>(args: string[], input?: string): Promise<T> {
  return JSON.parse(await run('gh', args, { input })) as T
}

export async function currentUser(): Promise<string> {
  return (await run('gh', ['api', 'user', '--jq', '.login'])).trim()
}

interface GhPullRequest {
  number: number
  url: string
  title: string
  body: string
  author: { login: string } | null
  state: PullRequest['state']
  isDraft: boolean
  baseRefName: string
  headRefName: string
  baseRefOid: string
  headRefOid: string
  additions: number
  deletions: number
  changedFiles: number
  closingIssuesReferences: { number: number; url: string }[]
}

export async function fetchPullRequest(ref: PrRef): Promise<PullRequest> {
  const raw = await gh<GhPullRequest>([
    'pr',
    'view',
    String(ref.number),
    '--repo',
    `${ref.owner}/${ref.repo}`,
    '--json',
    'number,url,title,body,author,state,isDraft,baseRefName,headRefName,baseRefOid,headRefOid,additions,deletions,changedFiles,closingIssuesReferences',
  ])
  const linkedIssues = await Promise.all(
    raw.closingIssuesReferences.map(async (issue) => {
      const detail = await gh<{ title: string; body: string }>([
        'api',
        `repos/${ref.owner}/${ref.repo}/issues/${issue.number}`,
      ]).catch(() => ({ title: '', body: '' }))
      return { number: issue.number, url: issue.url, title: detail.title, body: detail.body ?? '' }
    }),
  )
  return {
    ref,
    url: raw.url,
    title: raw.title,
    body: raw.body,
    author: raw.author?.login ?? 'ghost',
    state: raw.state,
    isDraft: raw.isDraft,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    baseSha: raw.baseRefOid,
    headSha: raw.headRefOid,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    linkedIssues,
  }
}

export async function listReviewRequests(): Promise<PrSummary[]> {
  const raw = await gh<
    {
      number: number
      title: string
      url: string
      isDraft: boolean
      updatedAt: string
      author: { login: string } | null
      repository: { nameWithOwner: string }
    }[]
  >([
    'search',
    'prs',
    '--review-requested=@me',
    '--state=open',
    '--limit',
    '50',
    '--json',
    'number,title,url,isDraft,updatedAt,author,repository',
  ])
  return raw.map((pr) => {
    const [owner, repo] = pr.repository.nameWithOwner.split('/')
    return {
      ref: { owner, repo, number: pr.number },
      url: pr.url,
      title: pr.title,
      author: pr.author?.login ?? 'ghost',
      isDraft: pr.isDraft,
      updatedAt: pr.updatedAt,
    }
  })
}

const NATIVE_STACK_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      stack {
        baseRefName
        entries(first: 100) {
          nodes { position pullRequest { number title url headRefName baseRefName } }
        }
      }
    }
  }
}`

interface NativeStackResponse {
  data: {
    repository: {
      pullRequest: {
        stack: {
          baseRefName: string
          entries: { nodes: { position: number; pullRequest: StackEntry }[] }
        } | null
      }
    }
  }
}

/**
 * Prefers GitHub's native stack (public preview); repositories without it, or stacks built by
 * other tools, are reconstructed from base/head branch links between open PRs.
 */
export async function fetchStack(pr: PullRequest): Promise<Stack> {
  const current: StackEntry = {
    number: pr.ref.number,
    title: pr.title,
    url: pr.url,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
  }
  const native = await gh<NativeStackResponse>([
    'api',
    'graphql',
    '-f',
    `query=${NATIVE_STACK_QUERY}`,
    '-F',
    `owner=${pr.ref.owner}`,
    '-F',
    `repo=${pr.ref.repo}`,
    '-F',
    `number=${pr.ref.number}`,
  ]).catch(() => null)
  const stack = native?.data.repository.pullRequest.stack
  if (stack) {
    const entries = [...stack.entries.nodes].sort((a, b) => a.position - b.position).map((node) => node.pullRequest)
    return { trunk: stack.baseRefName, entries }
  }

  // The stack is context, not a prerequisite: a failed listing leaves the PR reviewable on its own.
  try {
    const open = await gh<(StackEntry & { isCrossRepository: boolean })[]>([
      'pr',
      'list',
      '--repo',
      `${pr.ref.owner}/${pr.ref.repo}`,
      '--state',
      'open',
      '--limit',
      '500',
      '--json',
      'number,title,url,headRefName,baseRefName,isCrossRepository',
    ])
    const sameRepo = open
      .filter((entry) => !entry.isCrossRepository)
      .map(({ number, title, url, headRefName, baseRefName }) => ({ number, title, url, headRefName, baseRefName }))
    return detectStack(current, sameRepo)
  } catch {
    return { trunk: pr.baseRefName, entries: [current] }
  }
}

/** `PENDING` omits the event, leaving the review for the reviewer to finalize on GitHub. */
export async function submitReview(
  pr: PullRequest,
  body: string,
  drafts: DraftComment[],
  event: ReviewEvent,
): Promise<string> {
  const payload = {
    commit_id: pr.headSha,
    body,
    ...(event === 'PENDING' ? {} : { event }),
    comments: drafts.map((draft) => ({
      path: draft.path,
      line: draft.line,
      side: draft.side,
      ...(draft.startLine === null ? {} : { start_line: draft.startLine, start_side: draft.side }),
      body: draft.body,
    })),
  }
  try {
    const review = await gh<{ html_url: string }>(
      [
        'api',
        '--method',
        'POST',
        `repos/${pr.ref.owner}/${pr.ref.repo}/pulls/${pr.ref.number}/reviews`,
        '--input',
        '-',
      ],
      JSON.stringify(payload),
    )
    return review.html_url
  } catch (error) {
    if (error instanceof CommandError && error.stderr.includes('one pending review')) {
      throw new Error('You already have a pending review on this pull request. Submit or discard it on GitHub first.')
    }
    throw error
  }
}

const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id path line startLine diffSide subjectType isResolved isOutdated
          comments(first: 50) { nodes { author { login } body createdAt url } }
        }
      }
    }
  }
}`

interface ThreadsPage {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: {
            id: string
            path: string
            line: number | null
            startLine: number | null
            diffSide: DiffSide
            subjectType: 'LINE' | 'FILE'
            isResolved: boolean
            isOutdated: boolean
            comments: { nodes: { author: { login: string } | null; body: string; createdAt: string; url: string }[] }
          }[]
        }
      }
    }
  }
}

export async function fetchThreads(ref: PrRef): Promise<ReviewThread[]> {
  const pages = await gh<ThreadsPage[]>([
    'api',
    'graphql',
    '--paginate',
    '--slurp',
    '-f',
    `query=${THREADS_QUERY}`,
    '-F',
    `owner=${ref.owner}`,
    '-F',
    `repo=${ref.repo}`,
    '-F',
    `number=${ref.number}`,
  ])
  return pages.flatMap((page) =>
    page.data.repository.pullRequest.reviewThreads.nodes.map((thread) => ({
      id: thread.id,
      path: thread.path,
      side: thread.diffSide,
      line: thread.subjectType === 'FILE' ? null : thread.line,
      startLine: thread.subjectType === 'FILE' ? null : thread.startLine,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      comments: thread.comments.nodes.map((comment) => ({
        author: comment.author?.login ?? 'ghost',
        body: comment.body,
        createdAt: comment.createdAt,
        url: comment.url,
      })),
    })),
  )
}

export interface PastReviewComment {
  path: string
  body: string
  diffHunk: string
  url: string
}

/** The repository's most recent human review comments, newest first. */
export async function fetchPastReviewComments(ref: PrRef, pages: number): Promise<PastReviewComment[]> {
  const batches = await Promise.all(
    Array.from({ length: pages }, (_, index) =>
      gh<
        {
          path: string
          body: string
          diff_hunk: string
          html_url: string
          user: { login: string; type: string } | null
        }[]
      >([
        'api',
        `repos/${ref.owner}/${ref.repo}/pulls/comments?sort=created&direction=desc&per_page=100&page=${index + 1}`,
      ]),
    ),
  )
  return batches
    .flat()
    .filter((comment) => comment.user?.type === 'User' && comment.body.trim().length >= 40)
    .map((comment) => ({ path: comment.path, body: comment.body, diffHunk: comment.diff_hunk, url: comment.html_url }))
}
