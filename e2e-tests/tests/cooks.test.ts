import { COOK, STEP } from '../defaultMenu.ts'
import { expect, pcTest } from '../pcTest.ts'

pcTest('a kitchen starts with two cooks', async ({ kitchen, room }) => {
  await kitchen.goto(room.id)

  const roster = await kitchen.openCooks()

  await roster.expectCookNames([COOK.first, COOK.second])
  await roster.expectAway(COOK.first)
})

pcTest('the roster can be added to, renamed and cut down again', async ({
  kitchen,
  room,
  page,
}) => {
  await kitchen.goto(room.id)
  const roster = await kitchen.openCooks()

  await roster.addCook()
  await roster.renameCook(COOK.third, 'Paavo')
  await roster.close()

  await page.reload()
  await kitchen.expectLoaded()

  const afterReload = await kitchen.openCooks()
  await afterReload.expectCookNames([COOK.first, COOK.second, 'Paavo'])

  await afterReload.removeCook('Paavo')
  await afterReload.expectCookNames([COOK.first, COOK.second])
})

pcTest('once you say which cook you are, starting a step stops asking', async ({
  kitchen,
  room,
}) => {
  await kitchen.goto(room.id)
  await kitchen.ensureIAm(COOK.second)

  await kitchen.recipe.step(STEP.mushrooms).start()

  await expect(kitchen.startDialog.locator).toBeHidden()
  await kitchen.recipe.step(STEP.mushrooms).expectStatus('active')
  await kitchen.recipe.step(STEP.mushrooms).expectCook(COOK.second)
})
