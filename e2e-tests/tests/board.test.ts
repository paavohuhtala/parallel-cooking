import { COOK, STEP } from '../defaultMenu.ts'
import { expect, pcTest } from '../pcTest.ts'

pcTest('sorts steps into columns and moves them as work starts', async ({ kitchen, room }) => {
  await kitchen.goto(room.id)
  await kitchen.showBoard()

  await kitchen.board.expectCardIn(STEP.mushrooms, 'ready')
  await kitchen.board.expectCardIn(STEP.roast, 'blocked')

  await kitchen.board.card(STEP.mushrooms).start()
  await kitchen.startDialog.chooseCook(COOK.first)

  await kitchen.board.expectCardIn(STEP.mushrooms, 'active')

  await kitchen.board.card(STEP.mushrooms).finish()

  await kitchen.board.expectCardIn(STEP.mushrooms, 'done')
  await kitchen.board.expectCardIn(STEP.roast, 'ready')
})

pcTest('groups the board by cook', async ({ kitchen, room }) => {
  await kitchen.goto(room.id)
  await kitchen.showBoard()
  await kitchen.board.card(STEP.mushrooms).start()
  await kitchen.startDialog.chooseCook(COOK.second)

  await kitchen.board.groupBy('Kokin mukaan')

  const lane = kitchen.board.lane(COOK.second)
  await expect(lane.locator('.card').filter({ hasText: STEP.mushrooms })).toBeVisible()
  await expect(
    kitchen.board.lane('Ei tekijää').locator('.card').filter({ hasText: STEP.onions }),
  ).toBeVisible()
})

pcTest('the three views are the same kitchen', async ({ kitchen, room }) => {
  await kitchen.goto(room.id)
  await kitchen.startStepAs(STEP.mushrooms, COOK.first)

  await kitchen.showBoard()
  await kitchen.board.expectCardIn(STEP.mushrooms, 'active')

  await kitchen.showGraph()

  await kitchen.showRecipe()
  await kitchen.recipe.step(STEP.mushrooms).expectStatus('active')
})
