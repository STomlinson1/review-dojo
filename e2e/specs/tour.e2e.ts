import { json } from '../harness/gh'
import { widgetTour } from '../harness/tour'
import { prView } from '../harness/world'
import { openPullRequest } from '../support/review'
import { expect, test } from '../support/test'
import { TOUR_REQUEST, generateTour } from '../support/tour'

test('generating a tour lets the agent read the checkout and shows the finished guide', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  dojo.mock.script(
    { provider: 'claude', expect: TOUR_REQUEST, tool: { name: 'Read', input: { file_path: 'src/greet.ts' } } },
    { provider: 'claude', expect: 'const cleaned = name.trim()', text: JSON.stringify(widgetTour(dojo.prs.widget)) },
  )

  await page.getByRole('button', { name: 'Generate tour' }).click()

  await expect(page.getByText('Greetings gain an exclamation mark and a farewell.')).toBeVisible()
  const tour = page.getByRole('navigation', { name: 'Tour' })
  await expect(tour.getByRole('button', { name: /Friendlier greeting/ })).toBeVisible()
  await expect(tour.getByRole('button', { name: /Farewell helper/ })).toBeVisible()
  await expect(tour.getByRole('button', { name: /Double helper/ })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Stops understood' })).toHaveAttribute('aria-valuemax', '3')
})

test('stops are readable while the rest of the tour is still being written', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  const text = JSON.stringify(widgetTour(dojo.prs.widget))
  const afterFirstStop = text.indexOf('{"title":"Helpers"')
  dojo.mock.script({ provider: 'claude', expect: TOUR_REQUEST, text: text.slice(0, afterFirstStop), hold: true })

  await page.getByRole('button', { name: 'Generate tour' }).click()

  await expect(page.getByText('Still writing the tour: 1 stop so far')).toBeVisible()
  const tour = page.getByRole('navigation', { name: 'Tour' })
  await tour.getByRole('button', { name: /Friendlier greeting/ }).click()
  await expect(page.getByRole('heading', { name: 'Friendlier greeting' })).toBeVisible()
  await expect(tour.getByRole('button', { name: /Farewell helper/ })).toHaveCount(0)

  dojo.mock.release(text.slice(afterFirstStop))

  await expect(tour.getByRole('button', { name: /Farewell helper/ })).toBeVisible()
  await expect(page.getByText('Still writing the tour')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Friendlier greeting' })).toBeVisible()
})

test('a tour in the wrong shape is corrected in a second turn', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  dojo.mock.script(
    { provider: 'claude', expect: TOUR_REQUEST, text: 'Here is the tour: {"summary": 42}' },
    { provider: 'claude', expect: 'Your tour could not be used', text: JSON.stringify(widgetTour(dojo.prs.widget)) },
  )

  await page.getByRole('button', { name: 'Generate tour' }).click()

  await expect(page.getByText('Greetings gain an exclamation mark and a farewell.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a tour that stays unusable is reported and nothing is shown as a tour', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  dojo.mock.script(
    { provider: 'claude', expect: TOUR_REQUEST, text: '{"summary": 42}' },
    { provider: 'claude', expect: 'Your tour could not be used', text: '{"summary": 43}' },
  )

  await page.getByRole('button', { name: 'Generate tour' }).click()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText("The tour couldn't be generated")
  await expect(alert).toContainText('unusable tour')
  await expect(page.getByRole('button', { name: 'Generate tour' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Tour' })).toHaveCount(0)
})

test('cancelling generation stops the agent and returns to the empty tour screen', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  dojo.mock.script({ provider: 'claude', expect: TOUR_REQUEST, text: '{"summary": "Half a', hold: true })
  await page.getByRole('button', { name: 'Generate tour' }).click()
  const activity = page.getByRole('group', { name: 'Exploring the repository' })
  await expect(activity).toBeVisible()
  await expect.poll(() => dojo.mock.requests.length).toBe(1)

  await activity.getByRole('button', { name: 'Cancel' }).click()

  await expect(page.getByRole('button', { name: 'Generate tour' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => dojo.mock.requests[0].closed).toBe(true)
})

test('regenerating replaces the tour once the new one is complete', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  await generateTour(dojo, page)
  dojo.mock.script({
    provider: 'claude',
    expect: TOUR_REQUEST,
    text: JSON.stringify(widgetTour(dojo.prs.widget, 'A second reading of the same change.')),
  })

  await page.getByRole('button', { name: 'Regenerate' }).click()
  await expect(page.getByText('Write a new tour?')).toBeVisible()
  await page.getByRole('button', { name: 'Regenerate' }).click()

  await expect(page.getByText('A second reading of the same change.')).toBeVisible()
  await expect(page.getByText('Greetings gain an exclamation mark and a farewell.')).toHaveCount(0)
})

test('the agent is told what the linked issue asks for', async ({ dojo }) => {
  const pr = dojo.prs.widget
  const closes = [{ number: 5, url: 'https://github.com/acme/widget/issues/5' }]
  dojo.gh.set('pr acme/widget#7', json({ ...prView(pr), closingIssuesReferences: closes }))
  dojo.gh.set('issue acme/widget#5', json({ title: 'Greetings feel flat', body: 'Users asked for warmer wording.' }))
  const page = await dojo.launch()
  await openPullRequest(page, pr)

  await generateTour(dojo, page)

  expect(dojo.mock.requests[0].input).toContain(
    '### Linked issue #5: Greetings feel flat\\nUsers asked for warmer wording.',
  )
})
