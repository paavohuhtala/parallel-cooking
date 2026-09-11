import { COOK, COMPONENT, STEP } from '../defaultMenu.ts'
import { expect, pcTest } from '../pcTest.ts'

/*
 * "Oma vuoro" on a real screen, where `StepDetail` is a column rather than a
 * sheet — so the view is already two columns: the queue, and the step you have
 * open beside it. This spec is about that pairing; the loop itself is covered
 * at phone width in shift.test.ts.
 */

pcTest('the queue holds still when a step is opened beside it', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  const shift = await kitchen.showShift()
  await shift.claim(COOK.first)
  await shift.startSuggested()

  const column = page.locator('.shift')
  const closed = await column.boundingBox()

  await kitchen.openStepFromShift(STEP.mushrooms)

  // The panel takes its column out of the scroller's width, so a centred queue
  // would re-centre — 170px sideways, mid-task. Its width is reserved instead.
  const open = await column.boundingBox()
  expect(open!.x).toBe(closed!.x)
  expect(open!.width).toBe(closed!.width)
})

pcTest('the panel beside the queue is the same step, and finishing there moves it', async ({
  kitchen,
  room,
}) => {
  await kitchen.goto(room.id)
  const shift = await kitchen.showShift()
  await shift.claim(COOK.first)
  await shift.startSuggested()

  // Being in this cook's "Työn alla" is already proof of who has it: the zone
  // is filtered by cook id, not merely by state.
  await shift.expectActive(STEP.mushrooms)

  const detail = await kitchen.openStepFromShift(STEP.mushrooms)
  await detail.expectStatus('active')
  // Whatever the step opens is a section of the panel, so a cook who came here
  // to read is not missing the thing the completion bar would have told them.
  await expect(detail.dependents).toContainText(STEP.roast)

  await detail.finish()

  // Same command, so the queue follows — the bar does not appear, because it
  // belongs to the view's own one-tap Valmis rather than to the step.
  await shift.expectActive()
  await expect(shift.toast).toHaveCount(0)

  // What it suggests next is the onions, not the step it just unblocked: both
  // are soup, so both take the continuity bonus, and both hand off to the same
  // step and so sit on chains of equal length. The tie breaks on dependency
  // order, which is what makes this assertable at all.
  await shift.expectSuggested(STEP.onions, `Jatkoa: ${COMPONENT.soup}`)
})

pcTest('"Seuraavaksi" gives way to the view that supersedes it', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)

  // It is the recipe view's quick jump list, and it stays that.
  await expect(page.locator('.upnext')).toBeVisible()

  await kitchen.showShift()
  await expect(page.locator('.upnext')).toBeHidden()

  await kitchen.showRecipe()
  await expect(page.locator('.upnext')).toBeVisible()
})
