import { COOK, COMPONENT, STEP } from '../defaultMenu.ts'
import { expect, pcTest } from '../pcTest.ts'

/*
 * "Oma vuoro" on a phone-sized viewport — the project this spec runs under in
 * playwright.config.ts. The point of the view is a loop rather than a layout,
 * so most of this walks it: say who you are, take what is suggested, do it,
 * finish it, and be handed what that opened.
 */

pcTest('a phone opens on the view, and the view opens on who you are', async ({
  kitchen,
  room,
}) => {
  await kitchen.goto(room.id)

  // No tab click: at this width the room already opens here.
  await kitchen.shift.expectGate()
  await expect(kitchen.shift.locator).toHaveCount(0)

  await kitchen.shift.claim(COOK.first)
  await kitchen.shift.expectActive()
})

pcTest('the suggestion explains itself, and taking it asks nobody', async ({ kitchen, room }) => {
  await kitchen.goto(room.id)
  await kitchen.shift.claim(COOK.first)

  // Nothing going yet, so the longest remaining chain leads and says so.
  await kitchen.shift.expectSuggested(STEP.mushrooms, /^Avaa \d+ vaihetta$/)

  await kitchen.shift.startSuggested()

  // Straight through: no "Kuka ottaa tämän?", because the gate already asked.
  await expect(kitchen.startDialog.locator).toHaveCount(0)
  await kitchen.shift.expectActive(STEP.mushrooms)
  await expect(kitchen.shift.card(STEP.mushrooms).elapsed).toBeVisible()

  // And the next suggestion now stays in the dish that is under way.
  await kitchen.shift.expectSuggested(STEP.onions, `Jatkoa: ${COMPONENT.soup}`)
})

pcTest('finishing a step offers back what it opened', async ({ kitchen, room }) => {
  await kitchen.goto(room.id)
  await kitchen.shift.claim(COOK.first)

  await kitchen.shift.startSuggested()
  await kitchen.shift.card(STEP.mushrooms).finish()

  await kitchen.shift.expectToast(STEP.mushrooms)
  await kitchen.shift.expectToast(STEP.roast)

  await kitchen.shift.takeWhatOpened()
  await kitchen.shift.expectActive(STEP.roast)
})

pcTest('a mis-tapped Valmis is undone from the bar that confirms it', async ({
  kitchen,
  room,
}) => {
  await kitchen.goto(room.id)
  await kitchen.shift.claim(COOK.first)

  await kitchen.shift.startSuggested()
  await kitchen.shift.card(STEP.mushrooms).finish()
  await kitchen.shift.undoFromToast()

  // All the way back to unclaimed, so it is on offer again.
  await kitchen.shift.expectActive()
  await kitchen.shift.expectSuggested(STEP.mushrooms)
})

pcTest('the first card carries its instructions, the rest are titles', async ({
  kitchen,
  room,
}) => {
  await kitchen.goto(room.id)
  await kitchen.shift.claim(COOK.first)

  await kitchen.shift.startSuggested()
  await kitchen.shift.card(STEP.mushrooms).expectOpen()

  await kitchen.shift.startSuggested()
  await kitchen.shift.expectActive(STEP.mushrooms, STEP.onions)
  // The newest is second in dependency order, and collapsed until asked.
  await kitchen.shift.card(STEP.onions).expectCollapsed()
  await kitchen.shift.card(STEP.onions).toggle()
  await kitchen.shift.card(STEP.onions).expectOpen()
})

pcTest("work in another cook's name is listed but not offered", async ({
  kitchen,
  room,
  openSecondCook,
}) => {
  const other = await openSecondCook()
  await other.showRecipe()
  await other.startStepAs(STEP.mushrooms, COOK.second)

  await kitchen.goto(room.id)
  await kitchen.shift.claim(COOK.first)

  // Their step is active, so it is not ready for anyone; what is ready and
  // unclaimed is what gets suggested.
  await kitchen.shift.expectSuggested(STEP.onions)

  await other.finishStep(STEP.mushrooms)

  // Now that it is done, the step it unblocks is one they are holding nothing
  // of — but the bruschetta's oil is still free, and still on offer.
  await kitchen.shift.unfold('Kaikki vapaat')
  await expect(kitchen.shift.row(STEP.oil)).toBeVisible()
})

pcTest('the waiting list names the cook you are stuck behind', async ({
  kitchen,
  room,
  openSecondCook,
}) => {
  const other = await openSecondCook()
  await other.showRecipe()
  await other.startStepAs(STEP.mushrooms, COOK.second)

  await kitchen.goto(room.id)
  await kitchen.shift.claim(COOK.first)

  await kitchen.shift.unfold('Odottaa muita')
  await expect(kitchen.shift.row(STEP.roast)).toContainText(COOK.second)
  await expect(kitchen.shift.row(STEP.roast)).toContainText(STEP.mushrooms)
})

pcTest('the station filter narrows the suggestion too', async ({ kitchen, room }) => {
  await kitchen.goto(room.id)
  await kitchen.shift.claim(COOK.first)

  await kitchen.shift.expectSuggested(STEP.mushrooms)

  // Nothing at the oven is ready at the start except preheating it.
  await kitchen.shift.filterByStation('Uuni')
  await kitchen.shift.expectSuggested('Kuumenna uuni')
})

pcTest('the header collapses to one row, with the actions behind it', async ({
  kitchen,
  room,
}) => {
  await kitchen.goto(room.id)

  await expect(kitchen.topbar.locator('.topbar-actions')).toBeHidden()
  await expect(kitchen.page.locator('.upnext')).toBeHidden()

  await kitchen.topbar.getByRole('button', { name: 'Toiminnot' }).click()
  const sheet = kitchen.page.getByRole('dialog', { name: 'Toiminnot' })
  await expect(sheet.getByRole('button', { name: 'Jaa' })).toBeVisible()

  await sheet.getByRole('button', { name: /^Kokit/ }).click()
  await kitchen.cooks.expectOpen()
})
