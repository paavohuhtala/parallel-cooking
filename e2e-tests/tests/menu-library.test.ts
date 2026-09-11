import { expect } from '@playwright/test'
import { pcTest as test } from '../pcTest.ts'

/*
 * The library card on the landing page: the buttons a person actually presses to
 * keep a shelf of menus between dinners.
 */

const doc = (name: string) => ({
  name,
  courses: [
    {
      name: 'Alkupala',
      components: [
        {
          name: 'Keitto',
          ingredients: ['voita'],
          steps: [{ title: 'Pilko' }, { title: 'Keitä', deps: ['Pilko'] }],
        },
      ],
    },
  ],
})

test('a new menu starts out editable rather than empty', async ({ page, library, editor }) => {
  await page.goto('/')
  await library.newButton.click()
  await editor.expectOpen()
  // A blank menu still has to be a legal one, so there is something to type into.
  await expect(editor.titles()).not.toHaveCount(0)
})

test('a menu can be duplicated, and the copy is independent', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  await library.import(doc('Alkuperäinen'))
  await editor.step('Pilko').fill('Pilko sipuli')
  await editor.save()

  await page.goto('/')
  await library.row('Alkuperäinen').getByRole('button', { name: 'Kopioi Alkuperäinen' }).click()
  await library.expectListed('Alkuperäinen (kopio)')

  // Editing the copy leaves the original alone.
  await library.open('Alkuperäinen (kopio)')
  await editor.step('Pilko sipuli').fill('Aivan muuta')
  await editor.save()

  await page.goto('/')
  // The copy kept its own name through an edit, rather than reverting to the
  // original's — the document owns the name, not just the row.
  await library.expectListed('Alkuperäinen (kopio)')
  await library.open('Alkuperäinen')
  await expect(editor.step('Pilko sipuli')).toBeVisible()
})

test('a menu can be exported as a file and imported back unchanged', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  await library.import(doc('Vietävä'))
  await editor.expectOpen()

  await page.goto('/')
  const download = await Promise.all([
    page.waitForEvent('download'),
    library.row('Vietävä').getByRole('button', { name: 'Vie Vietävä' }).click(),
  ]).then(([d]) => d)

  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'))

  // Round trip: what comes out imports back as the same menu.
  await library.import({ ...exported, name: 'Palautettu' })
  await editor.expectTitles(['Alkupala', 'Keitto', 'Pilko', 'Keitä'])
})

test('deleting a menu leaves a kitchen already started from it alone', async ({
  page,
  library,
}) => {
  await page.goto('/')
  await library.import(doc('Poistettava'))

  await page.goto('/')
  await library.startKitchen('Poistettava')
  await expect(page.getByTestId('step-row')).toHaveCount(2)
  const roomUrl = page.url()

  await page.goto('/')
  page.on('dialog', (d) => void d.accept())
  await library.row('Poistettava').getByRole('button', { name: 'Poista Poistettava' }).click()
  await library.expectMissing('Poistettava')

  // The kitchen cooks from its own copy, so it is untouched.
  await page.goto(roomUrl)
  await expect(page.getByTestId('step-row')).toHaveCount(2)
})

test('a cook is told when a menu edit takes away work they had started', async ({
  api,
  page,
  room,
}) => {
  await page.goto(`/r/${room.id}`)
  const doomed = 'Kuori ja pilko sipuli'
  const row = page.getByTestId('step-row').filter({ hasText: doomed })
  await row.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await expect(row).toHaveClass(/status-active/)

  // Somebody else edits the menu out from under them.
  const before = await api.getRoomMenu(room.id)
  const trimmed = structuredClone(before.menu)
  const gone = trimmed.steps.find((s) => s.title.includes(doomed))!
  trimmed.steps = trimmed.steps
    .filter((s) => s.id !== gone.id)
    .map((s) => ({ ...s, deps: s.deps.filter((d) => d !== gone.id) }))
  await api.saveRoomMenu(room.id, trimmed, before.version)

  // The step vanishing on its own would be baffling; it is explained instead.
  await expect(page.getByTestId('rejection')).toContainText('Menua muokattiin')
  await expect(page.getByTestId('rejection')).toContainText(doomed)
})

test('an edit that costs nothing passes without a notice', async ({ api, page, room }) => {
  await page.goto(`/r/${room.id}`)
  await expect(page.getByTestId('step-row').first()).toBeVisible()

  const before = await api.getRoomMenu(room.id)
  const renamed = structuredClone(before.menu)
  renamed.steps[0].title = 'Uusi otsikko kokonaan'
  await api.saveRoomMenu(room.id, renamed, before.version)

  await expect(page.getByTestId('step-row').filter({ hasText: 'Uusi otsikko kokonaan' })).toBeVisible()
  await expect(page.getByTestId('rejection')).toHaveCount(0)
})
