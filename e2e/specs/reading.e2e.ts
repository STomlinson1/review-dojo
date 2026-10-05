import type { Page } from '@playwright/test'
import { commentBox, startComment } from '../support/diff'
import { fileCard, openPullRequest, reviewDrawer, savedReview, tourStop } from '../support/review'
import { type Dojo, expect, test } from '../support/test'
import { generateTour } from '../support/tour'

async function openTour(dojo: Dojo) {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  await generateTour(dojo, page)
  return page
}

const meter = (page: Page) => page.getByRole('progressbar', { name: 'Stops understood' })

test('stops are visited in tour order with the footer and the keyboard', async ({ dojo }) => {
  const page = await openTour(dojo)
  await tourStop(page, 'Friendlier greeting').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Friendlier greeting' })).toBeVisible()

  await page.getByRole('button', { name: 'Next →' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Farewell helper' })).toBeVisible()
  await expect(tourStop(page, 'Farewell helper')).toHaveAttribute('aria-current', 'page')

  await page.keyboard.press('j')
  await expect(page.getByRole('heading', { level: 1, name: 'Double helper' })).toBeVisible()
  await page.keyboard.press('k')
  await page.keyboard.press('k')
  await expect(page.getByRole('heading', { level: 1, name: 'Friendlier greeting' })).toBeVisible()
  await page.getByRole('button', { name: '← Overview' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Friendlier greetings' })).toBeVisible()
})

test('marking every stop understood fills the meter and leads to the review', async ({ dojo }) => {
  const page = await openTour(dojo)
  await tourStop(page, 'Friendlier greeting').click()

  await page.getByRole('button', { name: 'Mark understood & next' }).click()
  await expect(meter(page)).toHaveAttribute('aria-valuenow', '1')
  await expect(tourStop(page, 'Friendlier greeting').getByRole('img', { name: 'Understood' })).toBeVisible()
  await page.getByRole('button', { name: 'Mark understood & next' }).click()
  await page.getByRole('button', { name: 'Mark understood & review' }).click()

  await expect(reviewDrawer(page)).toBeVisible()
  await expect(reviewDrawer(page)).not.toContainText('marked understood yet')
  await expect(meter(page)).toHaveAttribute('aria-valuenow', '3')
})

test('ticking a check counts it for that stop', async ({ dojo }) => {
  const page = await openTour(dojo)
  await tourStop(page, 'Friendlier greeting').click()
  const checks = page.getByRole('region', { name: /^Verify/ })
  await expect(checks.getByRole('heading')).toHaveText('Verify 0/2')

  await checks.getByLabel('Confirm no caller appends its own punctuation').check()

  await expect(checks.getByRole('heading')).toHaveText('Verify 1/2')
  await expect(checks.getByLabel('Confirm shout still upper-cases the name')).not.toBeChecked()
})

test('Dojo mode hides the explanation until a prediction is revealed, then grades it', async ({ dojo }) => {
  const page = await openTour(dojo)
  await page.getByRole('switch', { name: 'Dojo' }).click()
  await tourStop(page, 'Friendlier greeting').click()
  const predict = page.getByRole('region', { name: 'Predict before you read' })
  await expect(predict).toBeVisible()
  const explanation = page.getByText('The greeting now ends with an exclamation mark.')
  await expect(explanation).toHaveCount(0)
  await expect(predict.getByRole('button', { name: 'Reveal' })).toBeDisabled()

  await predict.getByLabel('Your prediction').fill('It returns Hello, Ada with a bang')
  await predict.getByRole('button', { name: 'Reveal' }).click()

  const answer = page.getByRole('region', { name: 'Your prediction and the answer' })
  await expect(explanation).toBeVisible()
  await expect(answer).toContainText('Hello, Ada!')
  await expect(answer).toContainText('It returns Hello, Ada with a bang')

  dojo.mock.script({
    provider: 'claude',
    expect: 'It returns Hello, Ada with a bang',
    text: '**Got right** the punctuation. **Missed or misread** the trim.',
  })
  await answer.getByRole('button', { name: 'Grade my read' }).click()

  await expect(answer).toContainText('Feedback on your read')
  await expect(answer).toContainText('Got right the punctuation. Missed or misread the trim.')
  await expect(answer.getByRole('button', { name: 'Grade again' })).toBeVisible()
})

test('a code reference opens that file at the pull request head', async ({ dojo }) => {
  const page = await openTour(dojo)
  await tourStop(page, 'Friendlier greeting').click()

  await page.getByRole('region', { name: 'Read also' }).getByRole('button', { name: 'README.md:1-3' }).click()

  const peek = page.getByRole('dialog', { name: 'README.md:1-3' })
  await expect(peek).toContainText("At the pull request's head")
  await expect(peek).toContainText('Describes the helpers.')
  await expect(peek.locator('[data-content]')).toContainText('Greeting helpers.')

  await peek.getByRole('button', { name: 'GitHub' }).click()
  await expect
    .poll(() => dojo.openedLinks())
    .toEqual([`https://github.com/acme/widget/blob/${dojo.prs.widget.headSha}/README.md#L1-L3`])
  await peek.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: 'src/util/math.ts:2' }).click()
  await expect(page.getByRole('dialog', { name: 'src/util/math.ts:2' }).locator('[data-content]')).toContainText(
    'return a + b',
  )
})

test("copying the reviewer's guide puts the whole tour on the clipboard as Markdown", async ({ dojo }) => {
  const page = await openTour(dojo)
  const copied: string[] = []
  await page.exposeFunction('recordCopy', (text: string) => void copied.push(text))
  await page.evaluate(() => {
    const record = (window as unknown as { recordCopy(text: string): Promise<void> }).recordCopy
    Object.defineProperty(navigator.clipboard, 'writeText', { value: (text: string) => record(text) })
  })

  await page.getByRole('button', { name: "Copy reviewer's guide" }).click()

  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(copied).toHaveLength(1)
  expect(copied[0]).toContain("# Reviewer's guide: Friendlier greetings (#7)")
  expect(copied[0]).toContain('### Friendlier greeting')
  expect(copied[0]).toContain('### Farewell helper')
  expect(copied[0]).toContain('### Double helper')
  expect(copied[0]).toContain('- [ ] Confirm `shout` still upper-cases the name')
})

test('the tour, progress and drafts are still there after quitting and reopening', async ({ dojo }) => {
  let page = await openTour(dojo)
  const pr = dojo.prs.widget
  await tourStop(page, 'Friendlier greeting').click()
  await page.getByRole('button', { name: 'Mark understood & next' }).click()
  const greet = fileCard(page, 'src/greet.ts')
  await startComment(greet, 'addition', 3)
  await commentBox(greet).fill('Kept across a restart')
  await greet.getByRole('button', { name: 'Add comment' }).click()
  await expect.poll(() => savedReview(dojo.run, pr)?.drafts.length).toBe(1)

  page = await dojo.launch()
  await page
    .getByRole('region', { name: 'Recently opened' })
    .getByRole('button', { name: /Friendlier greetings/ })
    .click()

  await expect(page.getByText('Greetings gain an exclamation mark and a farewell.')).toBeVisible()
  await expect(meter(page)).toHaveAttribute('aria-valuenow', '1')
  await expect(tourStop(page, 'Friendlier greeting').getByRole('img', { name: 'Understood' })).toBeVisible()
  await expect(
    fileCard(page, 'src/greet.ts').getByRole('group', { name: 'Draft comment on src/greet.ts Line 3' }),
  ).toContainText('Kept across a restart')
})
