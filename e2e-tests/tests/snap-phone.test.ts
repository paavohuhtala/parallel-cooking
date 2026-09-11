/*
 * TEMPORARY — the phone-sized half of the visual baselines. See
 * snap-desktop.test.ts; delete both together.
 *
 * Run them on their own — `npx playwright test --config playwright.local.config.ts snap-`
 * — not as part of the whole suite: a worker's server and database are shared
 * by the tests that land on it, so the landing page's menu list depends on
 * which other specs have run there, and its height with it.
 */
import { pcTest, expect } from '../pcTest.ts'
import { COMPONENT, COOK, STEP } from '../defaultMenu.ts'
import type { TestApiClient } from '../testApiClient.ts'
import type { Page } from '@playwright/test'

const timeMasks = (page: Page) => [
  page.getByTestId('shift-elapsed'),
  page.getByTestId('detail-started'),
  page.getByTestId('recent-room-time'),
]

const shot = (page: Page, name: string, opts: { fullPage?: boolean } = {}) =>
  expect(page).toHaveScreenshot(name, { mask: timeMasks(page), ...opts })

/**
 * The worker's database is shared by every test that lands on it, and the
 * landing page lists every library menu in it. A worker runs one test at a
 * time, so clearing the shelf here is safe and makes the page deterministic.
 */
async function clearMenuShelf(api: TestApiClient): Promise<void> {
  for (const menu of await api.listMenus()) await api.deleteMenu(menu.id)
}

pcTest('snap: the landing page on a phone', async ({ api, landingPage, page }) => {
  await clearMenuShelf(api)
  await landingPage.goto()
  await shot(page, 'phone-landing.png', { fullPage: true })
})

pcTest('snap: a phone opens on the gate', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.shift.expectGate()
  await shot(page, 'phone-gate.png')
})

pcTest('snap: the queue once you have said who you are', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.shift.claim(COOK.first)
  await shot(page, 'phone-shift.png')
})

pcTest('snap: a step of your own, and the lists under it', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.shift.claim(COOK.first)
  await kitchen.shift.startSuggested()
  await kitchen.shift.unfold('Kaikki vapaat')
  await shot(page, 'phone-shift-active.png')
})

pcTest('snap: the bar that confirms a finished step', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.shift.claim(COOK.first)
  await kitchen.shift.startSuggested()
  await kitchen.shift.card(STEP.mushrooms).finish()
  await kitchen.shift.expectToast(/Valmis/)
  await shot(page, 'phone-toast.png')
})

pcTest('snap: the details as a sheet', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.shift.claim(COOK.first)
  await kitchen.shift.startSuggested()
  await kitchen.openStepFromShift(STEP.mushrooms)
  await shot(page, 'phone-detail-sheet.png')
})

pcTest('snap: the actions behind the header\'s ⋯', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.topbar.getByRole('button', { name: 'Toiminnot' }).click()
  await expect(page.getByRole('dialog', { name: 'Toiminnot' })).toBeVisible()
  await shot(page, 'phone-actions-sheet.png')
})

pcTest('snap: the recipe on a phone', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.showRecipe()
  await shot(page, 'phone-recipe.png')
})

pcTest('snap: the board on a phone', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.showBoard()
  await shot(page, 'phone-board.png')
})

pcTest('snap: the roster on a phone', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  // The header's four actions live behind the ⋯ at this width.
  await kitchen.topbar.getByRole('button', { name: 'Toiminnot' }).click()
  await page.getByRole('dialog', { name: 'Toiminnot' }).getByRole('button', { name: 'Kokit' }).click()
  await kitchen.cooks.expectOpen()
  await shot(page, 'phone-cooks.png')
})

pcTest('snap: the editor on a phone', async ({ api, editor, page }) => {
  const menu = await api.createLibraryMenuFromTemplate('Snapshot-menu')
  await page.goto(`/m/${menu.id}`)
  await editor.expectOpen()
  await shot(page, 'phone-editor.png', { fullPage: true })
})

pcTest('snap: the editor\'s details sheet', async ({ api, editor, page }) => {
  const menu = await api.createLibraryMenuFromTemplate('Snapshot-menu')
  await page.goto(`/m/${menu.id}`)
  await editor.openDetails(STEP.mushrooms)
  await expect(editor.sheet).toBeVisible()
  await shot(page, 'phone-editor-sheet.png')
})

pcTest('snap: a row menu on a phone', async ({ api, editor, page }) => {
  const menu = await api.createLibraryMenuFromTemplate('Snapshot-menu')
  await page.goto(`/m/${menu.id}`)
  await editor.expectOpen()
  await editor.openRowMenu(COMPONENT.soup)
  await shot(page, 'phone-editor-row-menu.png')
})
