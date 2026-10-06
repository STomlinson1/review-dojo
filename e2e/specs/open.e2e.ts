import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { json } from '../harness/gh'
import { gitEnv } from '../harness/launcher'
import { MANIFEST } from '../harness/paths'
import { readManifest } from '../harness/remotes'
import { prView, pullRequest, routes, stackEntry, threads } from '../harness/world'
import { commentBox, diffCode, startComment } from '../support/diff'
import { fileCard, fullDiff, openPullRequest } from '../support/review'
import { expect, test } from '../support/test'

test('an opened pull request shows the diff of its head against its base', async ({ dojo }) => {
  const page = await dojo.launch()
  const pr = dojo.prs.widget
  await openPullRequest(page, pr)

  await expect(fullDiff(page).getByRole('article')).toHaveCount(3)
  await expect(fileCard(page, 'src/farewell.ts')).toContainText('added')
  await expect(diffCode(fileCard(page, 'src/farewell.ts'))).toContainText(
    "return greet(name).replace('Hello', 'Goodbye')",
  )
  await expect(diffCode(fileCard(page, 'src/greet.ts'))).toContainText("return 'Hello, ' + cleaned")
  await expect(diffCode(fileCard(page, 'src/greet.ts'))).toContainText('return `Hello, ${cleaned}!`')
  await expect(diffCode(fileCard(page, 'src/util/math.ts'))).toContainText('return add(n, n)')
  await expect(page.getByText('Claude · claude-opus-5-5 · 3 files, +11 −2')).toBeVisible()

  expect(existsSync(join(dojo.run.userData, 'worktrees/acme/widget', pr.headSha, 'src/farewell.ts'))).toBe(true)
  const clone = join(dojo.run.userData, 'repos/acme/widget')
  const env = { ...process.env, ...gitEnv(readManifest(MANIFEST).remotes), GIT_NO_LAZY_FETCH: '1' }
  const git = (...args: string[]) => execFileSync('git', ['-C', clone, ...args], { encoding: 'utf8', env }).trim()
  const rewordedReadme = git('rev-parse', `${pr.baseSha}:README.md`)
  expect(git('rev-list', '--objects', '--missing=print', '--all')).toContain(`?${rewordedReadme}`)
})

test('a stacked pull request shows its stack and opens its neighbour', async ({ dojo }) => {
  const { widget, widgetStacked } = dojo.prs
  pullRequest(dojo.gh, widgetStacked)
  dojo.gh.set(routes.openPrs(widget), json([stackEntry(widgetStacked), stackEntry(widget)]))
  const page = await dojo.launch()
  await openPullRequest(page, widget)

  const stack = page.getByRole('navigation', { name: 'Stacked pull requests' })
  await expect(stack).toHaveText(/main.+#7.+#8/)
  await expect(stack.locator('[aria-current="page"]')).toHaveText('#7')
  await expect(stack.getByRole('button')).toHaveText(['#8'])
  await stack.getByRole('button', { name: '#8' }).click()

  await expect(page.getByRole('banner')).toContainText('Export the helpers')
  await expect(fullDiff(page).getByRole('article')).toHaveCount(1)
  await expect(fileCard(page, 'src/index.ts')).toContainText('added')
})

test('cancelling an open returns to home with nothing opened', async ({ dojo }) => {
  dojo.gh.set(routes.pr(dojo.prs.widget), { ...json(prView(dojo.prs.widget)), delayMs: 1500 })
  const page = await dojo.launch()
  await page.getByLabel('Open a pull request').fill(dojo.prs.widget.url)
  await page.getByRole('button', { name: 'Open', exact: true }).click()

  await page.getByRole('group', { name: 'Opening pull request' }).getByRole('button', { name: 'Cancel' }).click()

  await expect(page.getByLabel('Open a pull request')).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Back to home' })).toHaveCount(0)
  expect(existsSync(join(dojo.run.userData, 'repos/acme/widget'))).toBe(false)
})

test('existing review threads sit on their lines and link back to GitHub', async ({ dojo }) => {
  const threadUrl = 'https://github.com/acme/widget/pull/7#discussion_r101'
  threads(dojo.gh, dojo.prs.widget, [
    {
      id: 'T1',
      path: 'src/greet.ts',
      line: 3,
      comments: [
        { author: 'bob', body: 'Do we want the exclamation mark everywhere?', url: threadUrl },
        { author: 'alice', body: 'Yes, product asked for it.', url: `${threadUrl}-reply` },
      ],
    },
    {
      id: 'T2',
      path: 'src/util/math.ts',
      line: 6,
      isResolved: true,
      comments: [
        {
          author: 'bob',
          body: 'Is double used anywhere?',
          url: 'https://github.com/acme/widget/pull/7#discussion_r102',
        },
      ],
    },
  ])
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)

  await expect(page.getByRole('region', { name: 'Open discussion' })).toContainText('1 unresolved')
  const greet = fileCard(page, 'src/greet.ts')
  await expect(greet).toContainText('Do we want the exclamation mark everywhere?')
  await expect(greet).not.toContainText('Yes, product asked for it.')
  await greet.getByRole('button', { name: '1 reply' }).click()
  await expect(greet).toContainText('Yes, product asked for it.')

  const math = fileCard(page, 'src/util/math.ts')
  await expect(math.getByRole('button', { name: /Resolved.*Is double used anywhere\?.*Show/ })).toBeVisible()

  await greet.getByRole('button', { name: 'Open this thread on GitHub' }).click()
  await expect.poll(() => dojo.openedLinks()).toEqual([threadUrl])
})

test('after a new push the changed files are flagged and unsent drafts carry over', async ({ dojo }) => {
  const { widget, widgetPushed } = dojo.prs
  const page = await dojo.launch()
  await openPullRequest(page, widget)
  await startComment(fileCard(page, 'src/greet.ts'), 'addition', 3)
  await commentBox(fileCard(page, 'src/greet.ts')).fill('Carried across the push')
  await fileCard(page, 'src/greet.ts').getByRole('button', { name: 'Add comment' }).click()
  await page.getByRole('button', { name: 'Back to home' }).click()

  pullRequest(dojo.gh, widgetPushed)
  await openPullRequest(page, widgetPushed)

  const earlier = widget.headSha.slice(0, 7)
  await expect(fileCard(page, 'src/farewell.ts')).toContainText('Changed since your review')
  await expect(fileCard(page, 'src/greet.ts')).not.toContainText('Changed since your review')
  await expect(
    fileCard(page, 'src/greet.ts').getByRole('group', { name: 'Draft comment on src/greet.ts Line 3' }),
  ).toContainText('Carried across the push')
  await fullDiff(page).getByLabel('Only changes since my review').check()
  await expect(fullDiff(page).getByRole('article')).toHaveCount(1)
  await expect(fullDiff(page)).toContainText(`1 file since ${earlier}`)

  await page.getByRole('button', { name: 'Review 1', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Review' })).toContainText(
    `These drafts were written against an earlier commit (${earlier})`,
  )
})
