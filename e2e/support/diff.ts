import { type Locator, expect } from '@playwright/test'

export type LineKind = 'addition' | 'deletion' | 'expanded'

const LINE_TYPE: Record<LineKind, string> = {
  addition: 'change-addition',
  deletion: 'change-deletion',
  expanded: 'context-expanded',
}

const codeLine = (scope: Locator, kind: LineKind, line: number): Locator =>
  scope.locator(`[data-content] [data-line-type="${LINE_TYPE[kind]}"][data-line="${line}"]`)

const lineNumber = (scope: Locator, kind: LineKind, line: number): Locator =>
  scope.locator(`[data-gutter] [data-line-type="${LINE_TYPE[kind]}"][data-column-number="${line}"]`)

/** The composer's and the draft editor's text field; their forms carry "comment" in their own names. */
export const commentBox = (scope: Locator): Locator => scope.getByRole('textbox', { name: 'Comment', exact: true })

export const diffCode = (scope: Locator): Locator => scope.locator('[data-content]')

/**
 * The "+" exists only while a line is hovered, and a diff that re-renders (highlighting landing, a
 * neighbour mounting) drops it until the pointer moves again, so the hover is repeated with the click.
 */
export async function startComment(scope: Locator, kind: LineKind, line: number): Promise<void> {
  await expect(async () => {
    await scope.page().mouse.move(0, 0)
    await codeLine(scope, kind, line).hover()
    await scope.locator('[data-utility-button]').click({ timeout: 1000 })
  }).toPass()
}

export async function selectLines(scope: Locator, kind: LineKind, from: number, to: number): Promise<void> {
  const mouse = scope.page().mouse
  await lineNumber(scope, kind, from).hover()
  await mouse.down()
  await lineNumber(scope, kind, to).hover()
  await mouse.up()
}

export async function expandContextBetweenHunks(scope: Locator): Promise<void> {
  await scope.locator('[data-gutter] [data-expand-button][data-expand-both]').click()
}
