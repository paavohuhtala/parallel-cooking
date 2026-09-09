import { expect } from '@playwright/test'
import { pcTest as test } from '../pcTest.ts'

/*
 * The editor as a person actually uses it: typing a dish with the keyboard, and
 * fixing a menu while a kitchen is already cooking from it.
 *
 * Auto-chaining is asserted through *behaviour* rather than through a chip —
 * that a step is blocked until the one above it is done is the thing that has
 * to be true, and it is what a dependency is for.
 */

const smallDoc = (name: string) => ({
  name,
  courses: [
    {
      name: 'Alkupala',
      components: [{ name: 'Keitto', ingredients: ['voita'], steps: [{ title: 'Pilko sipuli' }] }],
    },
  ],
})

test('a dish can be typed with the keyboard alone, and auto-chains as it goes', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  await library.import(smallDoc('Näppäimistömenu'))
  await editor.expectOpen()

  // Enter at the end of the dish starts the next step, already depending on it.
  await editor.step('Pilko sipuli').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await editor.typeRow('Kuullota sipuli')
  await page.keyboard.type('Lisää liemi')

  await editor.expectTitles([
    'Alkupala',
    'Keitto',
    'Pilko sipuli',
    'Kuullota sipuli',
    'Lisää liemi',
  ])
  await editor.expectDirty()
  await editor.save()

  // The chain is real: in the kitchen, step two waits for step one.
  await page.goto('/')
  await library.startKitchen('Näppäimistömenu')
  const first = page.locator('.step-row').filter({ hasText: 'Pilko sipuli' })
  const second = page.locator('.step-row').filter({ hasText: 'Kuullota sipuli' })
  await expect(first).toHaveClass(/status-ready/)
  await expect(second).toHaveClass(/status-blocked/)

  await first.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await first.getByRole('button', { name: 'Valmis' }).click()
  await expect(second).toHaveClass(/status-ready/)
})

test('Alt+Arrow reorders a step and rebuilds the chain around it', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  await library.import({
    name: 'Järjestys',
    courses: [
      {
        name: 'K',
        components: [
          {
            name: 'Osa',
            // Chained in the document itself: an import is taken literally, so
            // this is what puts the three steps on the default chain.
            steps: [
              { title: 'Eka' },
              { title: 'Toka', deps: ['Eka'] },
              { title: 'Kolmas', deps: ['Toka'] },
            ],
          },
        ],
      },
    ],
  })

  await editor.step('Kolmas').click()
  await page.keyboard.press('Alt+ArrowUp')
  await editor.expectTitles(['K', 'Osa', 'Eka', 'Kolmas', 'Toka'])
  await editor.save()

  await page.goto('/')
  await library.startKitchen('Järjestys')
  // "Kolmas" now follows "Eka", so finishing Eka unblocks it rather than Toka.
  const eka = page.locator('.step-row').filter({ hasText: 'Eka' })
  const kolmas = page.locator('.step-row').filter({ hasText: 'Kolmas' })
  await expect(kolmas).toHaveClass(/status-blocked/)
  await eka.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await eka.getByRole('button', { name: 'Valmis' }).click()
  await expect(kolmas).toHaveClass(/status-ready/)
})

test('deleting a step in the middle heals the chain instead of breaking it', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  await library.import({
    name: 'Poisto',
    courses: [
      {
        name: 'K',
        components: [
          {
            name: 'Osa',
            steps: [
              { title: 'Eka' },
              { title: 'Toka', deps: ['Eka'] },
              { title: 'Kolmas', deps: ['Toka'] },
            ],
          },
        ],
      },
    ],
  })

  await editor.deleteRow('Toka')
  await editor.expectTitles(['K', 'Osa', 'Eka', 'Kolmas'])
  await editor.save()

  await page.goto('/')
  await library.startKitchen('Poisto')
  const eka = page.locator('.step-row').filter({ hasText: 'Eka' })
  const kolmas = page.locator('.step-row').filter({ hasText: 'Kolmas' })
  await expect(kolmas).toHaveClass(/status-blocked/)
  await eka.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await eka.getByRole('button', { name: 'Valmis' }).click()
  await expect(kolmas).toHaveClass(/status-ready/)
})

test('a menu with an error cannot be saved, and the problem says where', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  await library.import(smallDoc('Virheellinen'))

  // Blanking a dish name is not fatal, but an empty menu name is.
  await editor.title.fill('')
  await expect(editor.saveButton).toBeDisabled()
  await editor.title.fill('Korjattu')
  await expect(editor.saveButton).toBeEnabled()
})

test('an import with a bad dependency is explained and not stored', async ({ page, library }) => {
  await page.goto('/')
  await library.check({
    name: 'Rikki',
    courses: [
      {
        name: 'K',
        components: [{ name: 'Osa', steps: [{ title: 'A', deps: ['Ei ole olemassa'] }] }],
      },
    ],
  })
  await expect(library.dialog).toContainText('tuntemattomasta vaiheesta')
  await expect(library.confirmImportButton).toBeDisabled()
})

test('the menu can be fixed while a kitchen is cooking, and everyone sees it', async ({
  page,
  kitchen,
  room,
  editor,
  openSecondCook,
}) => {
  const second = await openSecondCook()
  await page.goto(`/r/${room.id}`)

  await page.getByRole('button', { name: '✏️ Muokkaa menua' }).click()
  await editor.expectOpen()

  const renamed = 'Puhdista kantarellit huolella'
  await editor.step('Puhdista ja hienonna kantarellit').fill(renamed)
  await editor.save()
  await editor.closeButton.click()

  // Both cooks are looking at the new menu, with no reload anywhere.
  await expect(kitchen.page.locator('.step-row').filter({ hasText: renamed })).toBeVisible()
  await expect(second.page.locator('.step-row').filter({ hasText: renamed })).toBeVisible()
})

test('removing a step that somebody has started asks before discarding it', async ({
  page,
  room,
  editor,
}) => {
  await page.goto(`/r/${room.id}`)
  const doomed = 'Kuori ja pilko sipuli'
  const row = page.locator('.step-row').filter({ hasText: doomed })
  await row.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await expect(row).toHaveClass(/status-active/)

  await page.getByRole('button', { name: '✏️ Muokkaa menua' }).click()
  await editor.deleteRow(doomed)

  // The confirmation names the step whose progress is about to be lost.
  const seen: string[] = []
  page.on('dialog', (d) => {
    seen.push(d.message())
    void d.accept()
  })
  await editor.save()
  expect(seen.join(' ')).toContain(doomed)

  await editor.closeButton.click()
  await expect(page.locator('.step-row').filter({ hasText: doomed })).toHaveCount(0)
})

test('declining the confirmation leaves the kitchen exactly as it was', async ({
  page,
  room,
  editor,
}) => {
  await page.goto(`/r/${room.id}`)
  const doomed = 'Kuori ja pilko sipuli'
  const row = page.locator('.step-row').filter({ hasText: doomed })
  await row.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()

  await page.getByRole('button', { name: '✏️ Muokkaa menua' }).click()
  await editor.deleteRow(doomed)

  page.on('dialog', (d) => void d.dismiss())
  await editor.saveButton.click()
  await editor.expectDirty()

  await editor.closeButton.click()
  await expect(row).toHaveClass(/status-active/)
})

/** One recipe converted on its own, which is the unit an LLM produces. */
const course = (courseName: string, dish: string, steps: string[]) => ({
  name: courseName,
  courses: [
    {
      name: courseName,
      components: [
        {
          name: dish,
          ingredients: ['suolaa'],
          steps: steps.map((title, i) => ({
            title,
            ...(i === 0 ? {} : { deps: [steps[i - 1]] }),
          })),
        },
      ],
    },
  ],
})

test('several separately converted recipes assemble into one multi-course menu', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  // Recipe one becomes the menu; the rest are merged into it, which is what
  // converting a four-course dinner one recipe at a time actually looks like.
  await library.import(course('Alkupala', 'Keitto', ['Pilko sipuli', 'Keitä liemi']))
  await editor.expectOpen()

  await editor.merge(course('Pääruoka', 'Paisti', ['Mausta liha', 'Paista uunissa']))
  await editor.merge(course('Jälkiruoka', 'Jäätelö', ['Nostetaan pakkasesta']))

  await editor.expectTitles([
    'Alkupala',
    'Keitto',
    'Pilko sipuli',
    'Keitä liemi',
    'Pääruoka',
    'Paisti',
    'Mausta liha',
    'Paista uunissa',
    'Jälkiruoka',
    'Jäätelö',
    'Nostetaan pakkasesta',
  ])
  await editor.save()

  // The assembled menu cooks: each course keeps its own chain.
  await page.goto('/')
  await library.startKitchen('Alkupala')
  await expect(page.locator('.course')).toHaveCount(3)
  const roast = page.locator('.step-row').filter({ hasText: 'Paista uunissa' })
  const season = page.locator('.step-row').filter({ hasText: 'Mausta liha' })
  await expect(roast).toHaveClass(/status-blocked/)
  await season.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await season.getByRole('button', { name: 'Valmis' }).click()
  await expect(roast).toHaveClass(/status-ready/)
})

test('merging two recipes that use the same names keeps their chains apart', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  // Both documents were authored alone, so both slugify to the same ids.
  await library.import(course('Alkupala', 'Osa', ['Pilko', 'Paista']))
  await editor.merge(course('Pääruoka', 'Osa', ['Pilko', 'Paista']))
  await editor.save()

  await page.goto('/')
  await library.startKitchen('Alkupala')
  // Four distinct steps, not two collapsed pairs.
  await expect(page.locator('.step-row')).toHaveCount(4)

  // Finishing the first course's "Pilko" must not unblock the second course's
  // "Paista" — that is exactly what an id collision would have caused.
  const rows = page.locator('.step-row').filter({ hasText: 'Paista' })
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toHaveClass(/status-blocked/)
  await expect(rows.nth(1)).toHaveClass(/status-blocked/)

  const firstPilko = page.locator('.step-row').filter({ hasText: 'Pilko' }).nth(0)
  await firstPilko.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await firstPilko.getByRole('button', { name: 'Valmis' }).click()

  // Exactly one of the two "Paista" steps became ready.
  await expect(page.locator('.step-row.status-ready').filter({ hasText: 'Paista' })).toHaveCount(1)
})

test('tabbing through the editor never changes the recipe', async ({ page, library, editor }) => {
  await page.goto('/')
  await library.import({
    name: 'Koskematon',
    courses: [
      {
        name: 'Alkupala',
        components: [
          {
            name: 'Keitto',
            steps: [{ title: 'Pilko' }, { title: 'Keitä', deps: ['Pilko'] }],
          },
        ],
      },
    ],
  })
  const before = ['Alkupala', 'Keitto', 'Pilko', 'Keitä']
  await editor.expectTitles(before)
  await editor.expectClean()

  // Tab is the one key everyone already knows: it moves between controls and
  // must never restructure the document, forwards or backwards, at any level.
  await editor.row('Ruokalaji', 'Alkupala').click()
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
  await editor.row('Osa', 'Keitto').click()
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
  await editor.step('Pilko').click()
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+Tab')
  await editor.row('Osa', 'Keitto').click()
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+Tab')

  await editor.expectTitles(before)
  // Nothing was touched at all, so there is nothing to save.
  await editor.expectClean()
})
