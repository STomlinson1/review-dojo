import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import type { ReviewState } from '../../src/shared/types'
import type { Run } from '../harness/launcher'
import type { FixturePr } from '../harness/remotes'
import { expect } from './test'

export async function openPullRequest(page: Page, pr: FixturePr): Promise<void> {
  await page.getByLabel('Open a pull request').fill(pr.url)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Back to home' })).toBeVisible()
}

export const fullDiff = (page: Page): Locator => page.getByRole('region', { name: 'Full diff' })

export const fileCard = (page: Page, path: string): Locator =>
  fullDiff(page).getByRole('article', { name: path, exact: true })

export const tourNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Tour' })

export const tourStop = (page: Page, title: string): Locator =>
  tourNav(page).getByRole('button', { name: new RegExp(title) })

export const reviewDrawer = (page: Page): Locator => page.getByRole('dialog', { name: 'Review' })

export function savedReview(run: Run, pr: FixturePr): ReviewState | null {
  const path = join(run.userData, 'reviews', pr.owner, pr.repo, String(pr.number), `${pr.headSha}.review.json`)
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ReviewState
  } catch {
    return null
  }
}
