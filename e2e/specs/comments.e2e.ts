import { commentBox, diffCode, expandContextBetweenHunks, selectLines, startComment } from '../support/diff'
import { fileCard, openPullRequest } from '../support/review'
import { expect, test } from '../support/test'

test('a comment started from the gutter becomes a draft on that line', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  const greet = fileCard(page, 'src/greet.ts')

  await startComment(greet, 'addition', 3)
  const composer = greet.getByRole('form', { name: 'New comment on src/greet.ts Line 3' })
  await commentBox(composer).fill('Why the exclamation mark?')
  await composer.getByRole('button', { name: 'Add comment' }).click()

  await expect(greet.getByRole('group', { name: 'Draft comment on src/greet.ts Line 3' })).toContainText(
    'Why the exclamation mark?',
  )
  await expect(composer).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review 1', exact: true })).toBeVisible()
})

test('dragging over line numbers drafts one comment for the whole range', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  const farewell = fileCard(page, 'src/farewell.ts')

  await selectLines(farewell, 'addition', 3, 4)
  const composer = farewell.getByRole('form', { name: 'New comment on src/farewell.ts Lines 3–4' })
  await commentBox(composer).fill('Could this reuse shout?')
  await composer.getByRole('button', { name: 'Add comment' }).click()

  await expect(farewell.getByRole('group', { name: 'Draft comment on src/farewell.ts Lines 3–4' })).toContainText(
    'Could this reuse shout?',
  )
})

test('editing and deleting act on the chosen draft only', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  const greet = fileCard(page, 'src/greet.ts')
  const math = fileCard(page, 'src/util/math.ts')
  for (const [card, line, body] of [
    [greet, 3, 'First thought'],
    [math, 6, 'Second thought'],
  ] as const) {
    await startComment(card, 'addition', line)
    await commentBox(card).fill(body)
    await card.getByRole('button', { name: 'Add comment' }).click()
  }
  const first = greet.getByRole('group', { name: 'Draft comment on src/greet.ts Line 3' })
  const second = math.getByRole('group', { name: 'Draft comment on src/util/math.ts Line 6' })

  await first.getByRole('button', { name: 'Edit' }).click()
  const editor = greet.getByRole('form', { name: 'Edit draft comment on src/greet.ts Line 3' })
  await commentBox(editor).fill('Reworded thought')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(first).toContainText('Reworded thought')
  await expect(second).toContainText('Second thought')

  await second.getByRole('button', { name: 'Delete' }).click()
  await expect(second).toHaveCount(0)
  await expect(first).toContainText('Reworded thought')
  await expect(page.getByRole('button', { name: 'Review 1', exact: true })).toBeVisible()
})

test('expanding context reveals the unchanged lines between two hunks', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  const greet = fileCard(page, 'src/greet.ts')
  await expect(diffCode(greet)).not.toContainText('export const pad8 = 8')

  await expandContextBetweenHunks(greet)

  await expect(diffCode(greet)).toContainText('export const pad8 = 8')
})

test('a comment on a line outside the diff is refused with the reason', async ({ dojo }) => {
  const page = await dojo.launch()
  await openPullRequest(page, dojo.prs.widget)
  const greet = fileCard(page, 'src/greet.ts')
  await expandContextBetweenHunks(greet)

  await startComment(greet, 'expanded', 12)

  await expect(greet.getByRole('alert')).toContainText('Comments can only go on lines that are part of the diff.')
  await expect(greet.getByRole('form')).toHaveCount(0)
})
