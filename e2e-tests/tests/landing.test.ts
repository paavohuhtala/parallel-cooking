import { expect, pcTest } from '../pcTest.ts'

/*
 * The menus written in code and the ones on your own shelf are one list: both
 * are things a kitchen can be started from, and the page says so.
 */
pcTest('lists code menus and your own as one choice', async ({ landingPage, api }) => {
  const templates = await api.listTemplates()
  const own = await api.createLibraryMenuFromTemplate('Oma menu landingin listassa')

  await landingPage.goto()

  for (const template of templates) await landingPage.expectMenuListed(template.name)
  await landingPage.expectMenuListed(own.name)
})

pcTest('starts a named kitchen from a menu of your own', async ({ landingPage, api }) => {
  const own = await api.createLibraryMenuFromTemplate('Oma menu keittiön pohjaksi')

  await landingPage.goto()
  await landingPage.chooseMenu(own.name)
  const kitchen = await landingPage.createKitchen('Oma illallinen')

  // The name is the kitchen's, not the menu's — the two used to be one field
  // you could only reach from the code menus.
  await kitchen.expectTitle('Oma illallinen')
  await kitchen.expectProgress(0, own.stepCount)
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
