import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Diff, PullRequest } from '../shared/types'
import { parseDiff } from './diff'
import { run } from './exec'

/**
 * The reviewer's global git config must not change the diff: comments are validated against it
 * locally, and GitHub rejects the whole review if a line isn't in GitHub's own (default) diff.
 */
const PINNED_CONFIG = [
  'core.quotePath=false',
  'diff.algorithm=myers',
  'diff.context=3',
  'diff.interHunkContext=0',
  'diff.noprefix=false',
  'diff.mnemonicPrefix=false',
  'diff.suppressBlankEmpty=false',
  'diff.relative=false',
].flatMap((setting) => ['-c', setting])

function git(cwd: string, args: string[], signal: AbortSignal): Promise<string> {
  return run('git', [...PINNED_CONFIG, ...args], { cwd, signal })
}

/**
 * Maintains one blobless clone per repository under `dataDir` and a detached worktree per PR head
 * commit, so the reviewer's own checkouts are never touched.
 */
export class Workspace {
  constructor(private readonly dataDir: string) {}

  async prepare(
    pr: PullRequest,
    signal: AbortSignal,
    onStep: (text: string) => void,
  ): Promise<{ worktree: string; diff: Diff }> {
    const clone = join(this.dataDir, 'repos', pr.ref.owner, pr.ref.repo)
    if (!existsSync(clone)) {
      onStep(`Cloning ${pr.ref.owner}/${pr.ref.repo}`)
      await this.createClone(pr, clone, signal)
    }

    onStep('Fetching pull request commits')
    const refs = `refs/dojo/${pr.ref.number}`
    await git(
      clone,
      ['fetch', '--no-tags', 'origin', `+${pr.baseSha}:${refs}/base`, `+${pr.headSha}:${refs}/head`],
      signal,
    )

    const worktree = join(this.dataDir, 'worktrees', pr.ref.owner, pr.ref.repo, pr.headSha)
    if (!(await isCleanCheckout(worktree, pr.headSha, signal))) {
      onStep('Checking out the PR head')
      await rm(worktree, { recursive: true, force: true })
      await mkdir(dirname(worktree), { recursive: true })
      await git(clone, ['worktree', 'prune'], signal)
      await git(clone, ['worktree', 'add', '--force', '--detach', worktree, pr.headSha], signal)
    }

    onStep('Computing the diff')
    const mergeBaseSha = (await git(clone, ['merge-base', pr.baseSha, pr.headSha], signal)).trim()
    const text = await git(
      clone,
      ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames', mergeBaseSha, pr.headSha],
      signal,
    )
    return { worktree, diff: { mergeBaseSha, headSha: pr.headSha, files: parseDiff(text) } }
  }

  /** Clones beside the final path and renames on success, so an interrupted clone is never reused. */
  private async createClone(pr: PullRequest, clone: string, signal: AbortSignal): Promise<void> {
    const partial = `${clone}.partial`
    await rm(partial, { recursive: true, force: true })
    await mkdir(dirname(clone), { recursive: true })
    // Partial clones fetch missing blobs lazily in git subprocesses, so gh's credential helper is
    // written into the clone's own config rather than passed per command.
    await run(
      'git',
      [
        'clone',
        '--filter=blob:none',
        '--no-checkout',
        '--origin',
        'origin',
        '--config',
        'credential.helper=',
        '--config',
        'credential.helper=!gh auth git-credential',
        `https://github.com/${pr.ref.owner}/${pr.ref.repo}.git`,
        partial,
      ],
      { signal },
    )
    await rename(partial, clone)
  }
}

/** An interrupted checkout leaves a directory with missing files, which `status` reports. */
async function isCleanCheckout(worktree: string, headSha: string, signal: AbortSignal): Promise<boolean> {
  if (!existsSync(worktree)) return false
  try {
    const head = (await git(worktree, ['rev-parse', 'HEAD'], signal)).trim()
    const status = await git(worktree, ['status', '--porcelain', '--untracked-files=no'], signal)
    return head === headSha && status.trim() === ''
  } catch {
    return false
  }
}
