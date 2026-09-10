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

test('a multi-course menu can be built from a blank one by clicking alone', async ({
  page,
  library,
  editor,
}) => {
  // No keyboard shortcuts anywhere in this test beyond typing the names: this
  // is the phone path, and it is the one that used to dead-end. A blank menu
  // arrives with one course and one dish and *no* steps, so every level below
  // has to be reachable from a tail row.
  await page.goto('/')
  await library.newButton.click()
  await editor.expectOpen()
  await editor.title.fill('Alusta')
  await editor.expectTitles(['Ruokalaji 1', 'Osa 1'])

  await editor.row('Ruokalaji', 'Ruokalaji 1').fill('Alkupala')
  await editor.row('Osa', 'Osa 1').fill('Keitto')

  // The first step of a dish that has none: unreachable before the tail rows.
  await editor.addStep('Keitto', 'Pilko sipuli')
  await editor.addStep('Keitto', 'Keitä liemi')

  // A second dish in the same course, and its own first step.
  await editor.addComponent('Alkupala', 'Salaatti')
  await editor.addStep('Salaatti', 'Pese salaatti')

  // A second course, from the tail row under the whole outline.
  await editor.addCourse('Jälkiruoka')
  await editor.addComponent('Jälkiruoka', 'Jäätelö')
  await editor.addStep('Jäätelö', 'Nosta pakkasesta')

  await editor.expectTitles([
    'Alkupala',
    'Keitto',
    'Pilko sipuli',
    'Keitä liemi',
    'Salaatti',
    'Pese salaatti',
    'Jälkiruoka',
    'Jäätelö',
    'Nosta pakkasesta',
  ])
  await editor.save()

  // It is a real menu: it cooks, and the dependencies are the ones implied by
  // the order things were typed in — chained inside a dish, independent across
  // dishes, so the two starters can be cooked by two people at once.
  await page.goto('/')
  await library.startKitchen('Alusta')
  await expect(page.locator('.course')).toHaveCount(2)

  const chop = page.locator('.step-row').filter({ hasText: 'Pilko sipuli' })
  const broth = page.locator('.step-row').filter({ hasText: 'Keitä liemi' })
  const salad = page.locator('.step-row').filter({ hasText: 'Pese salaatti' })
  const icecream = page.locator('.step-row').filter({ hasText: 'Nosta pakkasesta' })

  await expect(chop).toHaveClass(/status-ready/)
  await expect(broth).toHaveClass(/status-blocked/)
  // First in their own dish, so they wait for nothing at all.
  await expect(salad).toHaveClass(/status-ready/)
  await expect(icecream).toHaveClass(/status-ready/)

  await chop.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await chop.getByRole('button', { name: 'Valmis' }).click()
  await expect(broth).toHaveClass(/status-ready/)
})

test('a course collapses to a summary and reopens, without touching the menu', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  await library.import(smallDoc('Kokoontaitto'))
  await editor.expectOpen()

  await editor.toggleCollapse('Alkupala', 'Piilota')
  // Only the course itself is left, and it says what it is hiding.
  await editor.expectTitles(['Alkupala'])
  await expect(editor.root).toContainText('1 osa · 1 vaihe')

  await editor.toggleCollapse('Alkupala', 'Näytä')
  await editor.expectTitles(['Alkupala', 'Keitto', 'Pilko sipuli'])
  // Collapsing is a way of looking, not a way of editing.
  await editor.expectClean()
})

test('every field in the inspector keeps its label off its controls', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  await library.import(smallDoc('Välit'))
  await editor.expectOpen()
  await editor.openDetails('Pilko sipuli')

  // Ohje is a <label>, the rest are <fieldset>s, and only the first of those
  // spaces itself with the field's flex gap — a <legend> is not a flex item, so
  // the fieldsets need a margin and the declared gap proves nothing.
  for (const label of ['Ohje', 'Asema', 'Edellyttää', 'Tarvitaan']) {
    expect(await editor.labelSpacing(label), `${label} sits flush against its controls`).toBe(10)
  }
})

test('a long step title never widens the inspector', async ({ page, library, editor }) => {
  const long = 'Paahda sienet, ruskista voissa ja nosta neljäsosa sivuun koristeeksi hienovaraisesti'
  await page.goto('/')
  // Two dishes, so the second one's step still has something to depend on: a
  // step with no candidates left has an empty picker, which fits whatever the
  // CSS does and would make this test prove nothing.
  await library.import({
    name: 'Pitkät nimet',
    courses: [
      {
        name: 'Alkupala',
        components: [
          { name: 'Kantarellikeitto', steps: [{ title: long }] },
          { name: 'Bruschetta', steps: [{ title: 'Siivuta leivät' }] },
        ],
      },
    ],
  })
  await editor.expectOpen()

  // The picker: sized by its widest option, here "Kantarellikeitto — <long>".
  await editor.openDetails('Siivuta leivät')
  await editor.expectDependencyOptions(2)
  await editor.expectNoHorizontalOverflow()

  // And the chip, once that dependency is actually taken.
  await editor.addDependency('Siivuta leivät', `Kantarellikeitto — ${long}`)
  await editor.expectNoHorizontalOverflow()
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

/** One course, one dish, three steps in a line — enough to lose by accident. */
const chainDoc = (name: string) => ({
  name,
  courses: [
    {
      name: 'Alkupala',
      components: [
        {
          name: 'Keitto',
          steps: [{ title: 'Eka' }, { title: 'Toka', deps: ['Eka'] }, { title: 'Kolmas', deps: ['Toka'] }],
        },
      ],
    },
  ],
})

test('emptying a course name and pressing Backspace does not take the course with it', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  await library.import(chainDoc('Vahinko'))
  await editor.expectOpen()

  // Renaming a course by selecting the name and retyping leaves the field empty
  // for exactly as long as it takes to press Backspace once too often.
  await editor.backspaceEmptyRow('Ruokalaji', 'Alkupala')
  await editor.expectTitles(['', 'Keitto', 'Eka', 'Toka', 'Kolmas'])

  // The same keystroke still deletes a leaf, so the guard is a guard and not a
  // removal of the feature.
  await editor.backspaceEmptyRow('Vaihe', 'Kolmas')
  await editor.expectTitles(['', 'Keitto', 'Eka', 'Toka'])
})

test('a course deleted from the row menu comes back whole, chain and all', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  await library.import(chainDoc('Kumoa'))
  await editor.expectOpen()

  await editor.deleteRow('Alkupala')
  await editor.expectTitles([])

  await editor.undo()
  await editor.expectTitles(['Alkupala', 'Keitto', 'Eka', 'Toka', 'Kolmas'])
  // Back to exactly the stored document, not merely to the same row titles —
  // there is nothing left to save.
  await editor.expectClean()

  // Whole means the dependencies too. Take a leaf off the end so there is a
  // real save to make, then check in the kitchen that the chain the undo put
  // back is the one that got stored.
  await editor.deleteRow('Kolmas')
  await editor.save()
  await page.goto('/')
  await library.startKitchen('Kumoa')
  const eka = page.locator('.step-row').filter({ hasText: 'Eka' })
  const toka = page.locator('.step-row').filter({ hasText: 'Toka' })
  await expect(toka).toHaveClass(/status-blocked/)
  await eka.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await eka.getByRole('button', { name: 'Valmis' }).click()
  await expect(toka).toHaveClass(/status-ready/)
})

test('a typed title is one undo step, and redo puts it back', async ({ page, library, editor }) => {
  await page.goto('/')
  await library.import(chainDoc('Kirjoitus'))
  await editor.expectOpen()

  await editor.step('Eka').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' ja vielä')
  await editor.expectTitles(['Alkupala', 'Keitto', 'Eka ja vielä', 'Toka', 'Kolmas'])

  // Not nine presses, one: the run of keystrokes in one field is a single step.
  await editor.undo()
  await editor.expectTitles(['Alkupala', 'Keitto', 'Eka', 'Toka', 'Kolmas'])

  await editor.redo()
  await editor.expectTitles(['Alkupala', 'Keitto', 'Eka ja vielä', 'Toka', 'Kolmas'])
})

test('undo is reachable without a keyboard, and greys out when there is nothing to undo', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  await library.import(chainDoc('Peukalo'))
  await editor.expectOpen()

  await expect(editor.undoButton).toBeDisabled()
  await expect(editor.redoButton).toBeDisabled()

  await editor.deleteRow('Toka')
  await editor.expectTitles(['Alkupala', 'Keitto', 'Eka', 'Kolmas'])

  await editor.undoButton.click()
  await editor.expectTitles(['Alkupala', 'Keitto', 'Eka', 'Toka', 'Kolmas'])
  await expect(editor.undoButton).toBeDisabled()

  await editor.redoButton.click()
  await editor.expectTitles(['Alkupala', 'Keitto', 'Eka', 'Kolmas'])
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

  await page.getByRole('button', { name: 'Muokkaa menua' }).click()
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

  await page.getByRole('button', { name: 'Muokkaa menua' }).click()
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

  await page.getByRole('button', { name: 'Muokkaa menua' }).click()
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
