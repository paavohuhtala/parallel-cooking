import { COOK, COMPONENT, STEP } from '../defaultMenu.ts'
import { expect, pcTest } from '../pcTest.ts'

pcTest('a kitchen opens with nothing done and the first steps ready', async ({
  kitchen,
  room,
  api,
}) => {
  const [template] = await api.listTemplates()

  await kitchen.goto(room.id)

  await kitchen.expectTitle(room.name)
  await kitchen.expectProgress(0, template.stepCount)
  await kitchen.recipe.step(STEP.mushrooms).expectStatus('ready')
  await kitchen.recipe.step(STEP.roast).expectStatus('blocked')
  await expect(kitchen.upNextChip(STEP.mushrooms)).toBeVisible()
})

pcTest('starting a step asks who is taking it, and finishing it unblocks the next', async ({
  kitchen,
  room,
}) => {
  await kitchen.goto(room.id)

  await kitchen.startStepAs(STEP.mushrooms, COOK.first)
  await kitchen.recipe.step(STEP.roast).expectStatus('blocked')

  await kitchen.finishStep(STEP.mushrooms)

  await kitchen.recipe.step(STEP.roast).expectStatus('ready')
  await kitchen.recipe.component(COMPONENT.soup).expectDoneCount(1)
})

pcTest('what a kitchen has done survives a reload', async ({ kitchen, room, page }) => {
  await kitchen.goto(room.id)
  await kitchen.startStepAs(STEP.mushrooms, COOK.first)
  await kitchen.finishStep(STEP.mushrooms)

  await page.reload()
  await kitchen.expectLoaded()

  await kitchen.recipe.step(STEP.mushrooms).expectStatus('done')
  await kitchen.recipe.step(STEP.mushrooms).expectCook(COOK.first)
  await kitchen.recipe.step(STEP.roast).expectStatus('ready')
})

pcTest('a blocked step says what it is waiting for', async ({ kitchen, room }) => {
  await kitchen.goto(room.id)

  await kitchen.recipe.step(STEP.roast).expectStartBlocked(new RegExp(STEP.mushrooms))
})

pcTest('a finished step cannot be undone from under work that depends on it', async ({
  kitchen,
  room,
}) => {
  await kitchen.goto(room.id)
  await kitchen.startStepAs(STEP.mushrooms, COOK.first)
  await kitchen.finishStep(STEP.mushrooms)
  await kitchen.startStepAs(STEP.roast, COOK.second)

  await kitchen.recipe.step(STEP.mushrooms).expectUndoBlocked(/Kumoa ensin/)

  // Once the dependent is back to todo, undoing is allowed again.
  await kitchen.recipe.step(STEP.roast).revert()
  await kitchen.recipe.step(STEP.roast).expectStatus('ready')
  await kitchen.recipe.step(STEP.mushrooms).undo()
  await kitchen.recipe.step(STEP.mushrooms).expectStatus('ready')
})

pcTest('the detail panel shows what a step needs and what it opens', async ({ kitchen, room }) => {
  await kitchen.goto(room.id)

  const detail = await kitchen.openStep(STEP.mushrooms)

  await detail.expectStatus('ready')
  await expect(detail.component).toHaveText(COMPONENT.soup)
  await expect(detail.dependencies).toHaveCount(0)
  await expect(detail.dependents).toContainText([new RegExp(STEP.roast)])

  await detail.assignTo(STEP.mushrooms, COOK.second)
  await kitchen.recipe.step(STEP.mushrooms).expectCook(COOK.second)

  await detail.close()
})
