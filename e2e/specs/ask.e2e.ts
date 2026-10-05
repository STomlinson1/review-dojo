import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { commentBox, selectLines, startComment } from '../support/diff'
import { fileCard, openPullRequest } from '../support/review'
import { type Dojo, expect, test } from '../support/test'
import { generateTour } from '../support/tour'

const askPanel = (page: Page) => page.getByRole('complementary', { name: 'Ask' })

async function openAskOnFirstStop(dojo: Dojo) {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  await generateTour(dojo, page)
  await page
    .getByRole('navigation', { name: 'Tour' })
    .getByRole('button', { name: /Friendlier greeting/ })
    .click()
  await page.getByRole('banner').getByRole('button', { name: 'Ask', exact: true }).click()
  return page
}

async function ask(page: Page, question: string) {
  await askPanel(page).getByLabel('Ask a question').fill(question)
  await askPanel(page).getByLabel('Ask a question').press('Enter')
}

test('a question about a stop is answered in the session that wrote the tour', async ({ dojo }) => {
  const page = await openAskOnFirstStop(dojo)
  dojo.mock.script({
    provider: 'claude',
    expect: 'Why the exclamation mark?',
    text: 'Because the description asks for friendlier greetings.',
    chunks: 3,
  })

  await ask(page, 'Why the exclamation mark?')

  await expect(askPanel(page).locator('[data-role="user"]')).toContainText('Why the exclamation mark?')
  await expect(askPanel(page).locator('[data-role="assistant"]')).toHaveText(
    'Because the description asks for friendlier greetings.',
  )
  const [tourRequest, askRequest] = dojo.mock.requests
  expect(askRequest.input).toContain('The reviewer is on the stop \\"Friendlier greeting\\"')
  expect(askRequest.headers['x-claude-code-session-id']).toBe(tourRequest.headers['x-claude-code-session-id'])
})

test('a question about selected lines carries those lines to the agent', async ({ dojo }) => {
  const page = await openAskOnFirstStop(dojo)
  const farewell = fileCard(page, 'src/farewell.ts')
  await selectLines(farewell, 'addition', 3, 4)
  await farewell.getByRole('button', { name: 'Ask about these lines' }).click()
  await expect(askPanel(page).getByRole('button', { name: 'src/farewell.ts:3-4' })).toBeVisible()
  dojo.mock.script({
    provider: 'claude',
    expect: "return greet(name).replace('Hello', 'Goodbye')",
    text: 'It swaps one word of the greeting.',
  })

  await ask(page, 'What do these lines do?')

  await expect(askPanel(page).locator('[data-role="assistant"]')).toHaveText('It swaps one word of the greeting.')
  await expect(askPanel(page).locator('[data-role="user"]')).toContainText('src/farewell.ts:3-4')
  expect(dojo.mock.requests[1].input).toContain('They selected src/farewell.ts:3-4 (at the PR head)')
})

test('cancelling a question stops the agent and keeps the question unanswered', async ({ dojo }) => {
  const page = await openAskOnFirstStop(dojo)
  dojo.mock.script({ provider: 'claude', expect: 'Is this safe?', text: 'Partly, becau', hold: true })
  await ask(page, 'Is this safe?')
  await expect(askPanel(page).locator('[data-role="assistant"]')).toContainText('Partly, becau')

  await askPanel(page).getByRole('button', { name: 'Cancel' }).click()

  await expect(askPanel(page).locator('[data-role="assistant"]')).toHaveCount(0)
  await expect(askPanel(page).locator('[data-role="user"]')).toContainText('Is this safe?')
  await expect(askPanel(page).getByRole('alert')).toHaveCount(0)
  await expect.poll(() => dojo.mock.requests[1].closed).toBe(true)
})

test('a question is still answered when the tour session no longer exists', async ({ dojo }) => {
  const page = await openAskOnFirstStop(dojo)
  rmSync(join(dojo.run.claudeConfig, 'projects'), { recursive: true })
  dojo.mock.script({ provider: 'claude', expect: 'Still there?', text: 'Yes, starting over.' })

  await ask(page, 'Still there?')

  await expect(askPanel(page).locator('[data-role="assistant"]')).toHaveText('Yes, starting over.')
  expect(dojo.mock.requests.at(-1)?.input).toContain('# Pull request #7: Friendlier greetings')
})

test('polishing a draft offers a rewrite that replaces the comment only when accepted', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  const greet = fileCard(page, 'src/greet.ts')
  await startComment(greet, 'addition', 3)
  await commentBox(greet).fill('why ! here')
  await greet.getByRole('button', { name: 'Add comment' }).click()
  await page.getByRole('button', { name: 'Review 1', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Review' })
  const draft = drawer.getByLabel('Comment on src/greet.ts Line 3')
  dojo.mock.script({
    provider: 'claude',
    expect: 'why ! here',
    text: 'Could you explain why the greeting needs an exclamation mark?',
  })

  await drawer.getByRole('button', { name: 'Polish' }).click()

  await expect(drawer.getByText('Could you explain why the greeting needs an exclamation mark?')).toBeVisible()
  await expect(draft).toHaveValue('why ! here')
  await drawer.getByRole('button', { name: 'Use suggestion' }).click()
  await expect(draft).toHaveValue('Could you explain why the greeting needs an exclamation mark?')
  expect(dojo.mock.requests[0].input).toContain('  return `Hello, ${cleaned}!`')
})
