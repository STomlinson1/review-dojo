import { type Page, expect } from '@playwright/test'
import { type ScriptedTour, widgetTour } from '../harness/tour'
import type { Dojo } from './test'

export const TOUR_REQUEST = 'Prepare a guided tour'

export async function generateTour(dojo: Dojo, page: Page, tour: ScriptedTour = widgetTour(dojo.prs.widget)) {
  dojo.mock.script({ provider: 'claude', expect: TOUR_REQUEST, text: JSON.stringify(tour) })
  await page.getByRole('button', { name: 'Generate tour' }).click()
  await expect(page.getByRole('button', { name: "Copy reviewer's guide" })).toBeVisible()
}
