import { expect } from '@playwright/test'
import { pcTest as test } from '../pcTest.ts'

/*
 * The menu write path, exercised through REST.
 *
 * This is the layer the editor UI will sit on, and the guarantees here are the
 * ones that are hard to see from the outside: that starting a kitchen copies the
 * menu, that a concurrent edit is refused rather than silently losing work, and
 * that removing a step takes its recorded progress with it.
 */

/** A small, valid menu written the way an LLM is asked to write one. */
const nestedDoc = (name: string) => ({
  name,
  courses: [
    {
      name: 'Alkupala',
      components: [
        {
          name: 'Keitto',
          ingredients: ['voita', 'sipuli'],
          steps: [
            { title: 'Pilko sipuli', uses: ['sipuli'] },
            {
              title: 'Kuullota sipuli',
              station: 'liesi',
              deps: ['Pilko sipuli'],
              uses: ['voita'],
            },
          ],
        },
      ],
    },
  ],
})

test('an imported menu gets ids, and dependencies written as titles are resolved', async ({
  api,
}) => {
  const { status, body } = await api.importMenu(nestedDoc('Tuotu'), { name: 'Tuotu' })
  expect(status).toBe(201)
  expect(body.problems).toEqual([])

  expect(body.menu.steps.map((s) => s.id)).toEqual(['pilko-sipuli', 'kuullota-sipuli'])
  expect(body.menu.steps[1].deps).toEqual(['pilko-sipuli'])
  expect(body.menu.steps[1].station).toBe('liesi')
  // The course and component ids were never written down by the author.
  expect(body.menu.components[0].courseId).toBe(body.menu.courses[0].id)
})

test('a dry run reports without storing anything', async ({ api }) => {
  const before = await api.listMenus()
  const { status, body } = await api.importMenu(nestedDoc('Kuiva'), { dryRun: true })
  expect(status).toBe(200)
  expect(body.id).toBeUndefined()
  expect(await api.listMenus()).toHaveLength(before.length)
})

test('a menu with a dependency cycle is refused with an explanation', async ({ api }) => {
  const { status, body } = await api.importMenu({
    name: 'Kehä',
    courses: [
      {
        name: 'K',
        components: [
          {
            name: 'O',
            steps: [
              { id: 'a', title: 'A', deps: ['b'] },
              { id: 'b', title: 'B', deps: ['a'] },
            ],
          },
        ],
      },
    ],
  })
  expect(status).toBe(422)
  expect(body.problems.some((p) => p.code === 'cycle')).toBe(true)
})

test('starting a kitchen copies the menu, so editing the library never touches it', async ({
  api,
}) => {
  const library = await api.createLibraryMenuFromTemplate('Kirjastomenu')
  const room = await api.createRoom({ fromMenuId: library.id, name: 'Illallinen' })

  const roomMenu = await api.getRoomMenu(room.id)
  expect(roomMenu.id).not.toBe(library.id)
  const originalTitle = roomMenu.menu.steps[0].title

  const edited = structuredClone(library.menu)
  edited.steps[0].title = 'Muokattu kirjastossa'
  expect((await api.saveMenu(library.id, edited, library.version)).status).toBe(200)

  expect((await api.getRoomMenu(room.id)).menu.steps[0].title).toBe(originalTitle)
})

test('a menu edited in the app stops following its code template', async ({ api }) => {
  // Otherwise the next server restart would quietly revert the user's work.
  const library = await api.createLibraryMenuFromTemplate('Irrotettu')
  expect(library.followsTemplate).toBe(false)

  const edited = structuredClone(library.menu)
  edited.name = 'Irrotettu, muokattu'
  await api.saveMenu(library.id, edited, library.version)
  expect((await api.getMenu(library.id)).followsTemplate).toBe(false)
})

test('a save against a stale version is refused and hands back the current menu', async ({
  api,
}) => {
  const library = await api.createLibraryMenuFromTemplate('Kilpailtu')
  const first = structuredClone(library.menu)
  first.name = 'Ensimmäinen'
  expect((await api.saveMenu(library.id, first, library.version)).status).toBe(200)

  const second = structuredClone(library.menu)
  second.name = 'Toinen'
  const stale = await api.saveMenu(library.id, second, library.version)
  expect(stale.status).toBe(409)
  expect(stale.body.error).toMatch(/Joku muu ehti muokata/)

  // The losing write did not land.
  expect((await api.getMenu(library.id)).menu.name).toBe('Ensimmäinen')
})

test('removing a step from a kitchen menu prunes the progress recorded against it', async ({
  api,
  page,
  room,
}) => {
  const before = await api.getRoomMenu(room.id)
  const doomed = before.menu.steps.find((s) => s.deps.length === 0)!

  // Record progress against the step that is about to disappear.
  await page.goto(`/r/${room.id}`)
  const row = page.getByTestId('step-row').filter({ hasText: doomed.title })
  await row.getByRole('button', { name: 'Aloita' }).click()
  // A fresh kitchen has two cooks and nobody has said who they are, so starting
  // a step asks first.
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await expect(row).toHaveClass(/status-active/)

  const trimmed = structuredClone(before.menu)
  trimmed.steps = trimmed.steps
    .filter((s) => s.id !== doomed.id)
    .map((s) => ({ ...s, deps: s.deps.filter((d) => d !== doomed.id) }))

  const write = await api.saveRoomMenu(room.id, trimmed, before.version)
  expect(write.status).toBe(200)
  expect(write.body.prunedRooms).toContain(room.id)

  // The open page is told, without a reload.
  await expect(page.getByTestId('step-row').filter({ hasText: doomed.title })).toHaveCount(0)
})

test('a library menu can be deleted, a kitchen’s own copy cannot', async ({ api }) => {
  const library = await api.createLibraryMenuFromTemplate('Poistettava')
  const room = await api.createRoom({ fromMenuId: library.id, name: 'Keittiö' })
  const roomMenu = await api.getRoomMenu(room.id)

  expect(await api.deleteMenu(roomMenu.id)).toBe(404)
  expect(await api.deleteMenu(library.id)).toBe(204)
  // Deleting the library entry leaves the kitchen alone.
  expect(await api.roomExists(room.id)).toBe(true)
})
