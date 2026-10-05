import { expect, test } from '../support/test'

test('the chosen provider, sign-in and model survive quitting the app', async ({ dojo }) => {
  let page = await dojo.launch()
  await page.getByRole('list', { name: 'Setup' }).getByRole('button', { name: 'Settings' }).click()
  let settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('group', { name: 'Guide' }).getByLabel('Codex').check()
  await settings.getByRole('radiogroup', { name: 'Codex sign-in' }).getByLabel('Subscription').check()
  await settings.getByRole('group', { name: 'Codex' }).getByLabel('Model').fill('gpt-test-model')
  await settings.getByRole('group', { name: 'Claude' }).getByLabel('Reasoning effort').selectOption({ label: 'Low' })
  await settings.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settings).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Setup' })).toContainText('Codex:')

  page = await dojo.launch()

  await expect(page.getByRole('list', { name: 'Setup' })).toContainText('Codex:')
  await page.getByRole('list', { name: 'Setup' }).getByRole('button', { name: 'Settings' }).click()
  settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('group', { name: 'Guide' }).getByLabel('Codex')).toBeChecked()
  await expect(settings.getByRole('radiogroup', { name: 'Codex sign-in' }).getByLabel('Subscription')).toBeChecked()
  await expect(settings.getByRole('radiogroup', { name: 'Claude sign-in' }).getByLabel('API key')).toBeChecked()
  await expect(settings.getByRole('group', { name: 'Codex' }).getByLabel('Model')).toHaveValue('gpt-test-model')
  await expect(settings.getByRole('group', { name: 'Claude' }).getByLabel('Reasoning effort')).toHaveValue('low')
})
