import type { Page } from '@playwright/test'
import { widgetTour } from '../harness/tour'
import { openPullRequest, tourStop } from '../support/review'
import { type Dojo, expect, test } from '../support/test'
import { TOUR_REQUEST } from '../support/tour'

test.use({ provider: 'codex' })

const finishedTour = (page: Page) => page.getByRole('button', { name: "Copy reviewer's guide" })

async function openWithTour(dojo: Dojo) {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  dojo.mock.script({ provider: 'codex', expect: TOUR_REQUEST, text: JSON.stringify(widgetTour(dojo.prs.widget)) })
  await page.getByRole('button', { name: 'Generate tour' }).click()
  await expect(finishedTour(page)).toBeVisible()
  return page
}

test('Codex runs a command in the checkout and returns a tour under the schema', async ({ dojo }) => {
  const page = await dojo.launch()
  await expect(page.getByRole('list', { name: 'Setup' })).toContainText('Codex: Using your OpenAI API key.')
  await openPullRequest(page, dojo.prs.widget)
  dojo.mock.script(
    { provider: 'codex', expect: TOUR_REQUEST, tool: { name: 'exec_command', input: { cmd: 'cat src/greet.ts' } } },
    { provider: 'codex', expect: 'const cleaned = name.trim()', text: JSON.stringify(widgetTour(dojo.prs.widget)) },
  )

  await page.getByRole('button', { name: 'Generate tour' }).click()

  await expect(finishedTour(page)).toBeVisible()
  await expect(page.getByText('Greetings gain an exclamation mark and a farewell.')).toBeVisible()
  await expect(tourStop(page, 'Double helper')).toBeVisible()
  await expect(page.getByText(/^Codex · /)).toBeVisible()
  expect(dojo.mock.requests[0].body).toMatchObject({ text: { format: { type: 'json_schema', strict: true } } })
})

test('a Codex question resumes the thread that wrote the tour', async ({ dojo }) => {
  const page = await openWithTour(dojo)
  await page.getByRole('banner').getByRole('button', { name: 'Ask', exact: true }).click()
  const panel = page.getByRole('complementary', { name: 'Ask' })
  dojo.mock.script({ provider: 'codex', expect: 'Where should I start?', text: 'Start with the greeting.' })

  await panel.getByLabel('Ask a question').fill('Where should I start?')
  await panel.getByLabel('Ask a question').press('Enter')

  await expect(panel.locator('[data-role="assistant"]')).toHaveText('Start with the greeting.')
  const [tourRequest, askRequest] = dojo.mock.requests
  expect(askRequest.headers['session-id']).toBe(tourRequest.headers['session-id'])
  expect(askRequest.input).not.toContain('# Pull request #7')
})

test('a Codex tour in the wrong shape is corrected in a second turn', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  dojo.mock.script(
    { provider: 'codex', expect: TOUR_REQUEST, text: '{"summary": 42}' },
    { provider: 'codex', expect: 'Your tour could not be used', text: JSON.stringify(widgetTour(dojo.prs.widget)) },
  )

  await page.getByRole('button', { name: 'Generate tour' }).click()

  await expect(finishedTour(page)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const [tourRequest, repairRequest] = dojo.mock.requests
  expect(repairRequest.headers['session-id']).toBe(tourRequest.headers['session-id'])
})

test('cancelling a Codex tour stops the agent and reports nothing', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  dojo.mock.script({ provider: 'codex', expect: TOUR_REQUEST, text: '{"summary": "Half a', hold: true })
  await page.getByRole('button', { name: 'Generate tour' }).click()
  await expect.poll(() => dojo.mock.requests.length).toBe(1)

  await page.getByRole('group', { name: 'Exploring the repository' }).getByRole('button', { name: 'Cancel' }).click()

  await expect(page.getByRole('button', { name: 'Generate tour' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => dojo.mock.requests[0].closed).toBe(true)
})
