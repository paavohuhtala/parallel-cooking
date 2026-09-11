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

/*
 * Removing a kitchen lives here rather than inside the kitchen: the front page
 * is where you can see which ones are empty, and a room you are standing in is
 * the one room you cannot answer that about.
 */
pcTest('removes a kitchen nobody is in', async ({ landingPage, api }) => {
  await landingPage.goto()
  const kitchen = await landingPage.createKitchen('Syöty illallinen')
  const roomId = kitchen.roomId()

  await landingPage.goto()
  await landingPage.removeRoom('Syöty illallinen')

  await expect(api.roomExists(roomId)).resolves.toBe(false)
  await landingPage.expectNoRecentRooms()
})

pcTest('leaves a kitchen with cooks in it alone', async ({
  landingPage,
  kitchen,
  room,
  api,
  openSecondCook,
}) => {
  const second = await openSecondCook()

  // This browser has to have been there for the kitchen to be on its list.
  await kitchen.goto(room.id)
  await landingPage.goto()

  await landingPage.expectOnlineCount(room.name, 1)
  await expect(landingPage.removeRoomButton(room.name)).toBeDisabled()
  // The button is a courtesy; the rule is the server's.
  await expect(api.deleteRoom(room.id)).resolves.toBe(409)

  // And once the kitchen empties out, the page notices without a reload.
  await second.page.close()
  await landingPage.removeRoom(room.name)
  await expect(api.roomExists(room.id)).resolves.toBe(false)
})

pcTest('explains a link that leads nowhere', async ({ kitchen }) => {
  await kitchen.gotoUnchecked('ei-tallaista-keittiota')

  await kitchen.expectNotFound()
})
