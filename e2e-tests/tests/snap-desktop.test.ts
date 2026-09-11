/*
 * TEMPORARY. Pixel-for-pixel baselines of every screen, taken before the CSS
 * was split into modules and replayed after, so the refactor can be shown to
 * have changed nothing. Delete once the refactor has landed — the rest of the
 * suite is about behaviour, and behaviour is what belongs in it.
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

/** Everything whose text is a clock reading, which no two runs agree on. */
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

/* ------------------------------------------------------------------ landing */

pcTest('snap: landing', async ({ api, landingPage, page }) => {
  await clearMenuShelf(api)
  await landingPage.goto()
  await shot(page, 'landing.png', { fullPage: true })
})

pcTest('snap: landing, dark', async ({ api, landingPage, page }) => {
  await clearMenuShelf(api)
  await page.emulateMedia({ colorScheme: 'dark' })
  await landingPage.goto()
  await shot(page, 'landing-dark.png', { fullPage: true })
})

pcTest('snap: landing with a recent kitchen', async ({
  api,
  landingPage,
  kitchen,
  room,
  page,
}) => {
  await clearMenuShelf(api)
  await kitchen.goto(room.id)
  await landingPage.goto()
  await expect(landingPage.recentRooms).toHaveCount(1)
  await shot(page, 'landing-recent.png', { fullPage: true })
})

pcTest('snap: a link that leads nowhere', async ({ kitchen, page }) => {
  await kitchen.gotoUnchecked('ei-ole')
  await kitchen.expectNotFound()
  await shot(page, 'not-found.png')
})

/* ------------------------------------------------------------------ kitchen */

pcTest('snap: the recipe view', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await shot(page, 'recipe.png')
})

pcTest('snap: the recipe view part-way through', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.startStepAs(STEP.mushrooms, COOK.first)
  await kitchen.finishStep(STEP.mushrooms)
  await kitchen.startStepAs(STEP.onions, COOK.second)
  await shot(page, 'recipe-progress.png')
})

pcTest('snap: the recipe view, dark', async ({ kitchen, room, page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await kitchen.goto(room.id)
  await kitchen.startStepAs(STEP.mushrooms, COOK.first)
  await shot(page, 'recipe-dark.png')
})

pcTest('snap: the detail panel', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.startStepAs(STEP.mushrooms, COOK.first)
  await kitchen.openStep(STEP.mushrooms)
  await shot(page, 'detail-panel.png')
})

pcTest('snap: the ingredients of a dish, opened', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.recipe.component(COMPONENT.soup).locator.getByText(/^Ainekset/).click()
  await shot(page, 'recipe-ingredients.png')
})

pcTest('snap: the graph', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.showGraph()
  await shot(page, 'graph.png')
})

pcTest('snap: the graph with a chain selected', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.showGraph()
  await kitchen.upNextChip(STEP.mushrooms).click()
  await expect(kitchen.detail.root).toBeVisible()
  await shot(page, 'graph-selected.png')
})

pcTest('snap: the graph unmerged', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.showGraph()
  await page.getByLabel('Yhdistä peräkkäiset vaiheet').uncheck()
  await shot(page, 'graph-unmerged.png')
})

pcTest('snap: the board', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.showBoard()
  await shot(page, 'board.png')
})

pcTest('snap: the board grouped by cook', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.startStepAs(STEP.mushrooms, COOK.first)
  await kitchen.showBoard()
  await kitchen.board.groupBy('Kokin mukaan')
  await shot(page, 'board-by-cook.png')
})

pcTest('snap: a card selected on the board', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.showBoard()
  await kitchen.board.card(STEP.mushrooms).select()
  await expect(kitchen.detail.root).toBeVisible()
  await shot(page, 'board-selected.png')
})

pcTest('snap: "Oma vuoro" beside the panel', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  const shift = await kitchen.showShift()
  await shift.claim(COOK.first)
  await shift.startSuggested()
  await shift.unfold('Kaikki vapaat')
  await shot(page, 'shift-desktop.png')
})

pcTest('snap: who is holding the phone', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  const shift = await kitchen.showShift()
  await shift.expectGate()
  await shot(page, 'shift-gate.png')
})

pcTest('snap: the roster', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.ensureIAm(COOK.first)
  await kitchen.openCooks()
  await shot(page, 'cooks-modal.png')
})

pcTest('snap: who takes this step', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.recipe.step(STEP.mushrooms).start()
  await kitchen.startDialog.expectOpen(STEP.mushrooms)
  await shot(page, 'start-dialog.png')
})

pcTest('snap: a notice the kitchen could not avoid', async ({ api, kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.startStepAs(STEP.mushrooms, COOK.first)

  // The step somebody had started is taken out of the menu underneath them;
  // the server prunes the record and the room is told why.
  const before = await api.getRoomMenu(room.id)
  const trimmed = structuredClone(before.menu)
  const gone = trimmed.steps.find((step) => step.title.includes(STEP.mushrooms))!
  trimmed.steps = trimmed.steps
    .filter((step) => step.id !== gone.id)
    .map((step) => ({ ...step, deps: step.deps.filter((dep) => dep !== gone.id) }))
  await api.saveRoomMenu(room.id, trimmed, before.version)

  await kitchen.expectRejection(/Menua muokattiin/)
  await shot(page, 'rejection.png')
})

/* ------------------------------------------------------------- menu editor */

pcTest('snap: the menu editor', async ({ api, editor, page }) => {
  const menu = await api.createLibraryMenuFromTemplate('Snapshot-menu')
  await page.goto(`/m/${menu.id}`)
  await editor.expectOpen()
  await shot(page, 'editor.png', { fullPage: true })
})

pcTest('snap: the editor with a step open', async ({ api, editor, page }) => {
  const menu = await api.createLibraryMenuFromTemplate('Snapshot-menu')
  await page.goto(`/m/${menu.id}`)
  await editor.openDetails(STEP.mushrooms)
  await shot(page, 'editor-inspector.png', { fullPage: true })
})

pcTest('snap: a row menu, and a collapsed course', async ({ api, editor, page }) => {
  const menu = await api.createLibraryMenuFromTemplate('Snapshot-menu')
  await page.goto(`/m/${menu.id}`)
  await editor.expectOpen()
  await editor.openRowMenu(STEP.onions)
  await shot(page, 'editor-row-menu.png', { fullPage: true })
  await editor.closeRowMenu()
  await editor.toggleCollapse(COMPONENT.soup, 'Piilota')
  await shot(page, 'editor-collapsed.png', { fullPage: true })
})

pcTest('snap: the editor complaining', async ({ api, editor, page }) => {
  const menu = await api.createLibraryMenuFromTemplate('Snapshot-menu')
  await page.goto(`/m/${menu.id}`)
  await editor.expectOpen()
  await editor.title.fill('')
  await expect(editor.problems).toBeVisible()
  await shot(page, 'editor-problems.png', { fullPage: true })
})

pcTest('snap: the import dialog', async ({ api, library, landingPage, page }) => {
  await clearMenuShelf(api)
  await landingPage.goto()
  await library.importButton.click()
  await expect(library.dialog).toBeVisible()
  await shot(page, 'import-dialog.png')
})

pcTest('snap: the import dialog with a verdict', async ({ api, library, landingPage, page }) => {
  await clearMenuShelf(api)
  await landingPage.goto()
  await library.check({ name: 'Ei kelpaa', courses: [{ name: 'Alku', components: [] }] })
  await expect(library.dialog.getByRole('button', { name: 'Tarkista' })).toBeEnabled()
  await shot(page, 'import-dialog-checked.png')
})

pcTest('snap: editing the menu of a running kitchen', async ({ kitchen, editor, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.topbar.getByRole('button', { name: 'Muokkaa menua' }).click()
  await editor.expectOpen()
  await shot(page, 'editor-overlay.png')
})
