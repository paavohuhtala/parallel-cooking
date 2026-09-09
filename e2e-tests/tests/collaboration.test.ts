import { COOK, STEP } from '../defaultMenu.ts'
import { pcTest } from '../pcTest.ts'

pcTest('both cooks see the same kitchen as it changes', async ({
  kitchen,
  room,
  openSecondCook,
}) => {
  await kitchen.goto(room.id)
  const second = await openSecondCook()

  await kitchen.startStepAs(STEP.mushrooms, COOK.first)

  await second.recipe.step(STEP.mushrooms).expectStatus('active')
  await second.recipe.step(STEP.mushrooms).expectCook(COOK.first)

  // And the other way: the second cook finishes it, the first one sees that.
  await second.finishStep(STEP.mushrooms)

  await kitchen.recipe.step(STEP.mushrooms).expectStatus('done')
  await kitchen.recipe.step(STEP.roast).expectStatus('ready')
})

pcTest('a cook added in one browser appears in the other', async ({
  kitchen,
  room,
  openSecondCook,
}) => {
  await kitchen.goto(room.id)
  const second = await openSecondCook()

  const roster = await kitchen.openCooks()
  await roster.addCook()
  await roster.renameCook(COOK.third, 'Paavo')

  const otherRoster = await second.openCooks()
  await otherRoster.expectCookNames([COOK.first, COOK.second, 'Paavo'])
})

pcTest('shows which cooks are in the kitchen right now', async ({
  kitchen,
  room,
  openSecondCook,
}) => {
  await kitchen.goto(room.id)
  await kitchen.ensureIAm(COOK.first)

  const second = await openSecondCook()
  await second.ensureIAm(COOK.second)

  const roster = await kitchen.openCooks()
  await roster.expectPresent(COOK.first)
  await roster.expectPresent(COOK.second)

  // Presence is only true while the socket is open, so closing the second
  // browser has to take it away without anyone sending a command.
  await second.page.close()

  await roster.expectAway(COOK.second)
  await roster.expectPresent(COOK.first)
})
