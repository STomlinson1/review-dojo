import { reviewRequests, signedIn, signedOut } from '../harness/world'
import { expect, test } from '../support/test'

test('home reports the GitHub account and the provider that will write tours', async ({ dojo }) => {
  const page = await dojo.launch()
  const setup = page.getByRole('list', { name: 'Setup' })
  await expect(setup).toContainText('GitHub CLI signed in as octo-reviewer')
  await expect(setup).toContainText('Claude: Using your Anthropic API key.')
  await expect(page.getByText('Nothing is waiting for your review.')).toBeVisible()
})

test('a signed-out GitHub CLI is explained and rechecked on request', async ({ dojo }) => {
  signedOut(dojo.gh)
  const page = await dojo.launch()
  const setup = page.getByRole('list', { name: 'Setup' })
  await expect(setup).toContainText("GitHub CLI isn't signed in.")

  signedIn(dojo.gh)
  await setup.getByRole('button', { name: 'check again' }).click()

  await expect(setup).toContainText('GitHub CLI signed in as octo-reviewer')
})

test('a pull request waiting for review opens from the list', async ({ dojo }) => {
  reviewRequests(dojo.gh, [dojo.prs.widget])
  const page = await dojo.launch()

  const requests = page.getByRole('region', { name: 'Review requested' })
  await expect(requests.getByRole('button')).toContainText(['Refresh', 'Friendlier greetings'])
  await expect(requests).toContainText('acme/widget #7 · alice')
  await requests.getByRole('button', { name: /Friendlier greetings/ }).click()

  await expect(page.getByRole('banner')).toContainText('acme/widget #7')
})

test('a pull request opened before is offered again under recently opened', async ({ dojo }) => {
  const page = await dojo.launch()
  await expect(page.getByRole('region', { name: 'Recently opened' })).toHaveCount(0)
  await page.getByLabel('Open a pull request').fill('acme/widget#7')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByRole('button', { name: 'Back to home' }).click()

  const recent = page.getByRole('region', { name: 'Recently opened' })
  await expect(recent).toContainText('acme/widget #7')
  await recent.getByRole('button', { name: /Friendlier greetings/ }).click()

  await expect(page.getByRole('banner')).toContainText('Friendlier greetings')
})

test('text that names no pull request is refused with the reason', async ({ dojo }) => {
  const page = await dojo.launch()
  await page.getByLabel('Open a pull request').fill('not a pull request')
  await page.getByRole('button', { name: 'Open', exact: true }).click()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText("Couldn't open that pull request")
  await expect(alert).toContainText('Not a GitHub pull request URL: not a pull request')
  await expect(page.getByLabel('Open a pull request')).toBeEnabled()
})
