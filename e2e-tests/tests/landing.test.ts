import { expect, pcTest } from '../pcTest.ts'

pcTest('lists the menus a kitchen can be started from', async ({ landingPage, api }) => {
  const templates = await api.listTemplates()

  await landingPage.goto()

  await expect(landingPage.menuOptions).toHaveCount(templates.length)
  for (const template of templates) await landingPage.expectMenuListed(template.name)
})

pcTest('creates a named kitchen and opens it', async ({ landingPage, api }) => {
  const [template] = await api.listTemplates()

  await landingPage.goto()
  const kitchen = await landingPage.createKitchen('Perjantain illallinen')

  await kitchen.expectTitle('Perjantain illallinen')
  await kitchen.expectProgress(0, template.stepCount)
  await expect(api.roomExists(kitchen.roomId())).resolves.toBe(true)
})

pcTest('offers a kitchen you have opened before', async ({ landingPage }) => {
  await landingPage.goto()
  await landingPage.expectNoRecentRooms()

  const created = await landingPage.createKitchen('Lauantain illallinen')
  const roomId = created.roomId()

  await landingPage.goto()
  const reopened = await landingPage.openRecentRoom('Lauantain illallinen')

  expect(reopened.roomId()).toBe(roomId)
})

pcTest('explains a link that leads nowhere', async ({ kitchen }) => {
  await kitchen.gotoUnchecked('ei-tallaista-keittiota')

  await kitchen.expectNotFound()
})
