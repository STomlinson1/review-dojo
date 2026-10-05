import { expect, test } from '../support/test'

test('home reports the GitHub account and the provider that will write tours', async ({ dojo }) => {
  const page = await dojo.launch()
  const setup = page.getByRole('list', { name: 'Setup' })
  await expect(setup).toContainText('GitHub CLI signed in as octo-reviewer')
  await expect(setup).toContainText('Claude: Using your Anthropic API key.')
  await expect(page.getByText('Nothing is waiting for your review.')).toBeVisible()
})
