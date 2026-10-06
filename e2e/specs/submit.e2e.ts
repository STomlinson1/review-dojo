import type { Locator, Page } from '@playwright/test'
import { failure } from '../harness/gh'
import { pullRequest, reviewAccepted, routes } from '../harness/world'
import { type LineKind, commentBox, selectLines, startComment } from '../support/diff'
import { fileCard, openPullRequest, reviewDrawer } from '../support/review'
import { type Dojo, expect, test } from '../support/test'

async function draft(card: Locator, kind: LineKind, line: number, body: string) {
  await startComment(card, kind, line)
  await commentBox(card).fill(body)
  await card.getByRole('button', { name: 'Add comment' }).click()
}

const openDrawer = (page: Page) =>
  page
    .getByRole('banner')
    .getByRole('button', { name: /^Review/ })
    .click()

const submitted = (dojo: Dojo) =>
  dojo.gh.calls(routes.submit(dojo.prs.widget)).map((call) => JSON.parse(call.stdin) as unknown)

test('a pending review sends the drafts without an event and links to the result', async ({ dojo }) => {
  const pr = dojo.prs.widget
  const reviewUrl = reviewAccepted(dojo.gh, pr)
  const page = await dojo.launch()
  await openPullRequest(page, pr)
  await draft(fileCard(page, 'src/greet.ts'), 'addition', 3, 'Why the exclamation mark?')
  await openDrawer(page)

  await reviewDrawer(page).getByRole('button', { name: 'Create pending review' }).click()

  await expect(reviewDrawer(page).getByRole('status')).toContainText('Your review was sent to GitHub.')
  expect(submitted(dojo)).toEqual([
    {
      commit_id: pr.headSha,
      body: '',
      comments: [{ path: 'src/greet.ts', line: 3, side: 'RIGHT', body: 'Why the exclamation mark?' }],
    },
  ])
  await expect(reviewDrawer(page)).toContainText('0 draft comments')

  await reviewDrawer(page).getByRole('button', { name: 'Open on GitHub' }).click()
  await expect.poll(() => dojo.openedLinks()).toEqual([reviewUrl])
})

test('a comment review is published only after confirming and carries ranges and the summary', async ({ dojo }) => {
  const pr = dojo.prs.widget
  reviewAccepted(dojo.gh, pr)
  const page = await dojo.launch()
  await openPullRequest(page, pr)
  await selectLines(fileCard(page, 'src/farewell.ts'), 'addition', 3, 4)
  await commentBox(fileCard(page, 'src/farewell.ts')).fill('Could this reuse shout?')
  await fileCard(page, 'src/farewell.ts').getByRole('button', { name: 'Add comment' }).click()
  await draft(fileCard(page, 'src/greet.ts'), 'deletion', 24, 'This line was fine.')
  await openDrawer(page)
  const drawer = reviewDrawer(page)
  await drawer.getByLabel('Overall comment').fill('Two small questions.')
  await drawer.getByLabel('Submit as').selectOption({ label: 'Comment' })

  await drawer.getByRole('button', { name: 'Submit review' }).click()
  await expect(drawer.getByRole('alert')).toContainText('This publishes your review on GitHub as Comment')
  expect(submitted(dojo)).toEqual([])
  await drawer.getByRole('button', { name: 'Publish as Comment' }).click()

  await expect(drawer.getByRole('status')).toContainText('Your review was sent to GitHub.')
  expect(submitted(dojo)).toEqual([
    {
      commit_id: pr.headSha,
      body: 'Two small questions.',
      event: 'COMMENT',
      comments: [
        {
          path: 'src/farewell.ts',
          line: 4,
          side: 'RIGHT',
          start_line: 3,
          start_side: 'RIGHT',
          body: 'Could this reuse shout?',
        },
        { path: 'src/greet.ts', line: 24, side: 'LEFT', body: 'This line was fine.' },
      ],
    },
  ])
  await expect(page.getByRole('banner').getByRole('button', { name: 'Review', exact: true })).toBeVisible()
})

for (const [label, event] of [
  ['Approve', 'APPROVE'],
  ['Request changes', 'REQUEST_CHANGES'],
] as const) {
  test(`"${label}" reaches GitHub as ${event}`, async ({ dojo }) => {
    const pr = dojo.prs.widget
    reviewAccepted(dojo.gh, pr)
    const page = await dojo.launch()
    await openPullRequest(page, pr)
    await openDrawer(page)
    const drawer = reviewDrawer(page)
    await drawer.getByLabel('Overall comment').fill('My verdict.')
    await drawer.getByLabel('Submit as').selectOption({ label })
    await drawer.getByRole('button', { name: 'Submit review' }).click()

    await drawer.getByRole('button', { name: `Publish as ${label}` }).click()

    await expect(drawer.getByRole('status')).toContainText('Your review was sent to GitHub.')
    expect(submitted(dojo)).toEqual([{ commit_id: pr.headSha, body: 'My verdict.', event, comments: [] }])
  })
}

test('a draft that no longer sits in the diff blocks submitting until it is removed', async ({ dojo }) => {
  const { widget, widgetPushed } = dojo.prs
  const page = await dojo.launch()
  await openPullRequest(page, widget)
  await draft(fileCard(page, 'src/util/math.ts'), 'addition', 6, 'Is double used?')
  await page.getByRole('button', { name: 'Back to home' }).click()
  pullRequest(dojo.gh, widgetPushed)
  await openPullRequest(page, widgetPushed)
  await openDrawer(page)
  const drawer = reviewDrawer(page)

  await expect(drawer).toContainText('src/util/math.ts is not part of this diff.')
  await expect(drawer).toContainText('Fix the comments marked above before submitting')
  await expect(drawer.getByRole('button', { name: 'Create pending review' })).toBeDisabled()

  await drawer.getByRole('button', { name: 'Delete' }).click()

  await expect(drawer.getByRole('button', { name: 'Create pending review' })).toBeEnabled()
})

test('a review GitHub refuses is reported and the drafts are kept', async ({ dojo }) => {
  dojo.gh.set(
    routes.submit(dojo.prs.widget),
    failure('gh: Unprocessable Entity: User can only have one pending review per pull request (HTTP 422)'),
  )
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  await draft(fileCard(page, 'src/greet.ts'), 'addition', 3, 'Why the exclamation mark?')
  await openDrawer(page)
  const drawer = reviewDrawer(page)

  await drawer.getByRole('button', { name: 'Create pending review' }).click()

  await expect(drawer.getByRole('alert')).toContainText("The review wasn't submitted")
  await expect(drawer.getByRole('alert')).toContainText('You already have a pending review on this pull request.')
  await expect(drawer.getByLabel('Comment on src/greet.ts Line 3')).toHaveValue('Why the exclamation mark?')
  await expect(drawer.getByRole('status')).toHaveCount(0)
})
