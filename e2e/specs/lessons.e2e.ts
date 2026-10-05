import { failure } from '../harness/gh'
import { widgetTour } from '../harness/tour'
import { type PastComment, pastReviewComments } from '../harness/world'
import { openPullRequest } from '../support/review'
import { type Dojo, expect, test } from '../support/test'
import { TOUR_REQUEST, generateTour } from '../support/tour'

const LESSONS_REQUEST = 'Distill the recurring expectations'

const commentUrl = (index: number) => `https://github.com/acme/widget/pull/3#discussion_r${index}`

const pastComments: PastComment[] = Array.from({ length: 12 }, (_, index) => ({
  path: 'src/greet.ts',
  body: `Please build this string with a template literal, as we do elsewhere (${index + 1}).`,
  diff_hunk: "@@ -1,3 +1,3 @@\n-  return 'Hi ' + name\n+  return 'Hello ' + name",
  html_url: commentUrl(index + 1),
  user: { login: 'bob', type: 'User' },
}))

function lessonsTurn(title: string) {
  return {
    provider: 'claude' as const,
    expect: LESSONS_REQUEST,
    text: JSON.stringify({
      lessons: [{ title, detail: 'String concatenation gets flagged in review.', examples: [commentUrl(1)] }],
    }),
  }
}

async function generateWithLessons(dojo: Dojo) {
  pastReviewComments(dojo.gh, dojo.prs.widget, pastComments)
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  dojo.mock.script(lessonsTurn('Prefer template literals'), {
    provider: 'claude',
    expect: TOUR_REQUEST,
    text: JSON.stringify(widgetTour(dojo.prs.widget)),
  })
  await page.getByRole('button', { name: 'Generate tour' }).click()
  await expect(page.getByRole('button', { name: "Copy reviewer's guide" })).toBeVisible()
  return page
}

test('the first tour of a repository learns its review lessons and is held to them', async ({ dojo }) => {
  const page = await generateWithLessons(dojo)

  const lessons = page.getByRole('group').filter({ hasText: 'Team review lessons' })
  await lessons.getByText('Team review lessons').click()
  await expect(lessons).toContainText('Learned from 12 review comments')
  await expect(lessons).toContainText('Prefer template literals')
  expect(dojo.mock.requests[1].input).toContain(
    '**Prefer template literals**: String concatenation gets flagged in review.',
  )

  await lessons.getByRole('button', { name: '#3' }).click()
  await expect.poll(() => dojo.openedLinks()).toEqual([commentUrl(1)])
})

test('refreshing replaces the lessons with what the team says now', async ({ dojo }) => {
  const page = await generateWithLessons(dojo)
  const lessons = page.getByRole('group').filter({ hasText: 'Team review lessons' })
  await lessons.getByText('Team review lessons').click()
  dojo.mock.script(lessonsTurn('Name helpers after what they return'))

  await lessons.getByRole('button', { name: 'Refresh' }).click()

  await expect(lessons).toContainText('Name helpers after what they return')
  await expect(lessons).not.toContainText('Prefer template literals')
})

test('a tour is still written when the past review comments cannot be fetched', async ({ dojo }) => {
  dojo.gh.set('review-comments acme/widget page 1', failure('HTTP 502: Bad Gateway'))
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)

  await generateTour(dojo, page)

  await expect(page.getByText('Greetings gain an exclamation mark and a farewell.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Team review lessons' })).toContainText('Learn now')
  await expect(page.getByRole('alert')).toHaveCount(0)
})
