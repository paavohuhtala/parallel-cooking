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
  const first = page.getByTestId('step-row').filter({ hasText: 'Pilko sipuli' })
  const second = page.getByTestId('step-row').filter({ hasText: 'Kuullota sipuli' })
  await expect(first).toHaveAttribute('data-status', 'ready')
  await expect(second).toHaveAttribute('data-status', 'blocked')

  await first.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await first.getByRole('button', { name: 'Valmis' }).click()
  await expect(second).toHaveAttribute('data-status', 'ready')
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
  await expect(page.getByTestId('course')).toHaveCount(2)

  const chop = page.getByTestId('step-row').filter({ hasText: 'Pilko sipuli' })
  const broth = page.getByTestId('step-row').filter({ hasText: 'Keitä liemi' })
  const salad = page.getByTestId('step-row').filter({ hasText: 'Pese salaatti' })
  const icecream = page.getByTestId('step-row').filter({ hasText: 'Nosta pakkasesta' })

  await expect(chop).toHaveAttribute('data-status', 'ready')
  await expect(broth).toHaveAttribute('data-status', 'blocked')
  // First in their own dish, so they wait for nothing at all.
  await expect(salad).toHaveAttribute('data-status', 'ready')
  await expect(icecream).toHaveAttribute('data-status', 'ready')

  await chop.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await chop.getByRole('button', { name: 'Valmis' }).click()
  await expect(broth).toHaveAttribute('data-status', 'ready')
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

test("a row's ⋯ sits beside its title, and opening it marks the row without selecting it", async ({
  page,
  library,
  editor,
}) => {
  const long = 'Paahda sienet, ruskista voissa ja nosta neljäsosa sivuun koristeeksi hienovaraisesti'
  await page.goto('/')
  await library.import({
    name: 'Rivin mitat',
    courses: [
      {
        name: 'Alkupala',
        components: [{ name: 'Keitto', steps: [{ title: 'Eka' }, { title: long, deps: ['Eka'] }] }],
      },
    ],
  })
  await editor.expectOpen()

  // Right after the text, not at the far margin of a field as wide as the column.
  expect(await editor.menuButtonDistance('Vaihe', 'Eka')).toBeLessThan(40)
  // A field that fits its text must still fit a long one where there is room:
  // a fixed cap would fix the short rows by cutting the long ones.
  expect(await editor.titleClipped('Vaihe', long)).toBe(false)

  // The field shrank, the row did not: its blank space still means this row.
  await editor.clickRowBlank('Vaihe', 'Eka')
  await expect(editor.step('Eka')).toBeFocused()
  await expect(editor.inspectorTitle).toHaveText('Eka')

  // Looking at a row's menu is not choosing to edit the row: the inspector stays
  // where it was, and the row the menu belongs to is marked instead.
  const menu = await editor.openRowMenu('Keitto')
  await expect(editor.rowBlock('Osa', 'Keitto')).toHaveAttribute('data-menu-open', 'true')
  // A short title puts the ⋯ near the left edge; a menu that ends at its button
  // would open off the screen.
  await editor.expectRowMenuOnScreen()
  await expect(editor.inspectorTitle).toHaveText('Eka')
  // Beside the outline the inspector already follows the selection, so the
  // menu has no details item to offer.
  await expect(menu.getByRole('menuitem', { name: 'Tiedot' })).toBeHidden()
  await editor.closeRowMenu()
  await expect(editor.rowBlock('Osa', 'Keitto')).not.toHaveAttribute('data-menu-open', 'true')
})

test("on a phone the row menu is how a dish's details are opened", async ({
  page,
  library,
  editor,
}) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')
  await library.import({
    name: 'Puhelin',
    courses: [
      {
        name: 'Alkupala: kantarellikeitto ja valkosipulibruschetta',
        components: [{ name: 'Keitto', steps: [{ title: 'Pilko sipuli' }] }],
      },
    ],
  })
  await editor.expectOpen()

  // Being in the row selects it, but the sheet stays shut: it would cover the
  // outline on every tap.
  await editor.row('Osa', 'Keitto').click()
  await expect(editor.inspector).toBeHidden()

  // A long title pushes the ⋯ to the right edge, so the menu has to open the
  // other way.
  await editor.openRowMenu('Alkupala')
  await editor.expectRowMenuOnScreen()
  await editor.closeRowMenu()

  await editor.openDetailsFromMenu('Keitto')
  await expect(editor.inspectorTitle).toHaveText('Keitto')
})

test('on a phone a long title wraps instead of being cut through a letter', async ({
  page,
  library,
  editor,
}) => {
  const long = 'Alkupala: kantarellikeitto ja valkosipulibruschetta'
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')
  await library.import({
    name: 'Rivitys',
    courses: [{ name: long, components: [{ name: 'Keitto', steps: [{ title: 'Pilko sipuli' }] }] }],
  })
  await editor.expectOpen()

  // An <input> showed "…ja valk" and stopped there, with nothing to say so.
  expect(await editor.titleClipped('Ruokalaji', long)).toBe(false)
  expect(await editor.titleLines('Ruokalaji', long)).toBe(2)
  // The disclosure and the ⋯ stay with the line the title starts on.
  expect(await editor.sideControlOffsets('Ruokalaji', long)).toEqual({ glyph: 0, menu: 0 })
  // And a title that fits is still one line, with the same alignment.
  expect(await editor.titleLines('Vaihe', 'Pilko sipuli')).toBe(1)
  expect(await editor.sideControlOffsets('Vaihe', 'Pilko sipuli')).toEqual({ glyph: 0, menu: 0 })

  // It wraps on screen, but it is still one line of text: a pasted line break
  // becomes a space, and Enter starts the next row rather than a second line.
  await editor.step('Pilko sipuli').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' ja\nvalkosipuli')
  await page.keyboard.press('Enter')
  await editor.expectTitles([long, 'Keitto', 'Pilko sipuli ja valkosipuli', ''])
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
  const eka = page.getByTestId('step-row').filter({ hasText: 'Eka' })
  const kolmas = page.getByTestId('step-row').filter({ hasText: 'Kolmas' })
  await expect(kolmas).toHaveAttribute('data-status', 'blocked')
  await eka.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await eka.getByRole('button', { name: 'Valmis' }).click()
  await expect(kolmas).toHaveAttribute('data-status', 'ready')
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
  const eka = page.getByTestId('step-row').filter({ hasText: 'Eka' })
  const kolmas = page.getByTestId('step-row').filter({ hasText: 'Kolmas' })
  await expect(kolmas).toHaveAttribute('data-status', 'blocked')
  await eka.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await eka.getByRole('button', { name: 'Valmis' }).click()
  await expect(kolmas).toHaveAttribute('data-status', 'ready')
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
  const eka = page.getByTestId('step-row').filter({ hasText: 'Eka' })
  const toka = page.getByTestId('step-row').filter({ hasText: 'Toka' })
  await expect(toka).toHaveAttribute('data-status', 'blocked')
  await eka.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await eka.getByRole('button', { name: 'Valmis' }).click()
  await expect(toka).toHaveAttribute('data-status', 'ready')
})

test('the row menu says what a delete would take with it', async ({ page, library, editor }) => {
  await page.goto('/')
  await library.import(chainDoc('Laajuus'))
  await editor.expectOpen()

  // One word on a step and on a course holding a whole dish reads the same;
  // the counts are what make them different items.
  await expect(await editor.deleteItem('Alkupala')).toHaveText('Poista ruokalaji (1 osa, 3 vaihetta)')
  await editor.closeRowMenu()
  await expect(await editor.deleteItem('Keitto')).toHaveText('Poista osa (3 vaihetta)')
  await editor.closeRowMenu()
  await expect(await editor.deleteItem('Eka')).toHaveText('Poista vaihe')
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

/** One dish long enough to scroll well past the header: forty steps. */
const longDoc = (name: string) => ({
  name,
  courses: [
    {
      name: 'Alkupala',
      components: [
        {
          name: 'Keitto',
          steps: Array.from({ length: 40 }, (_, i) => ({ title: `Vaihe ${i + 1}` })),
        },
      ],
    },
  ],
})

test.describe('on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })

  test('every control on a row is a 44px target, and none takes the title', async ({
    page,
    library,
    editor,
  }) => {
    await page.goto('/')
    await library.import(chainDoc('Sormi'))
    await editor.expectOpen()

    // A middle step, so a neighbouring row that took part of a target would
    // show up as a shorter one. The ⋯ measured 28×22 and the glyphs 24×24.
    const targets = {
      disclosure: editor.glyph('Osa', 'Keitto'),
      station: editor.glyph('Vaihe', 'Toka'),
      'row menu': editor.rowMenuButton('Toka'),
      'tail row': editor.tailRow('Vaihe', 'Keitto'),
    }
    for (const [name, target] of Object.entries(targets)) {
      const area = await editor.hitArea(target)
      expect(area.width, `${name} width`).toBeGreaterThanOrEqual(44)
      expect(area.height, `${name} height`).toBeGreaterThanOrEqual(44)
    }
    // The glyph's target grew past the glyph, but not over the title's text.
    expect(await editor.titleTextTakesTap('Vaihe', 'Toka')).toBe(true)

    // The row menu is where a thumb reorders and deletes, so its items count too.
    const menu = await editor.openRowMenu('Toka')
    for (const item of await menu.getByRole('menuitem').all()) {
      expect((await editor.hitArea(item)).height, await item.innerText()).toBeGreaterThanOrEqual(44)
    }
  })

  test('the header is one sticky line of undo and save, with the rest behind ⋯', async ({
    page,
    library,
    editor,
  }) => {
    await page.goto('/')
    await library.import(longDoc('Kapea'))
    await editor.expectOpen()

    // Tuo ja yhdistä, Kopioi LLM-kehote and Vie JSON took a line of their own
    // above undo and save, and pushed save onto a third.
    await expect(editor.mergeButton).toBeHidden()
    expect(await editor.headerActionLines()).toBe(1)

    // Forty steps down, save is still there to press.
    await editor.step('Vaihe 40').click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await editor.expectDirty()
    expect(await editor.isUncovered(editor.saveButton)).toBe(true)
    expect(await editor.isUncovered(editor.undoButton)).toBe(true)
    // Only the actions stick; the name has scrolled away with the page.
    expect(await editor.isUncovered(editor.title)).toBe(false)

    // Nothing that was in the header is gone, only folded away.
    const more = await editor.openMoreMenu()
    await expect(more.getByRole('menuitem')).toHaveText([
      'Tuo ja yhdistä',
      'Kopioi LLM-kehote',
      'Vie JSON',
    ])
    await more.getByRole('menuitem', { name: 'Tuo ja yhdistä' }).click()
    await expect(editor.importDialog).toBeVisible()
    await editor.importDialog.getByRole('button', { name: 'Peruuta' }).click()

    await editor.saveButton.click()
    await editor.expectClean()
  })

  test('the details sheet is modal, and a tap beside it closes it rather than editing the row behind', async ({
    page,
    library,
    editor,
  }) => {
    await page.goto('/')
    await library.import(chainDoc('Arkki'))
    await editor.expectOpen()

    await editor.openDetails('Toka')
    await expect(editor.sheet).toBeVisible()
    await expect(editor.sheet).toBeFocused()
    // The keyboard cannot walk out of it, into the outline or off the editor.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      expect(await editor.focusInSheet(), `Tab ${i + 1} left the sheet`).toBe(true)
    }

    // A press that misses the sheet used to land on the row behind it: the
    // course got selected and the sheet went on editing that instead.
    await editor.pressRowBehindSheet('Ruokalaji', 'Alkupala')
    await expect(editor.sheet).toBeHidden()
    await expect(editor.row('Ruokalaji', 'Alkupala')).not.toBeFocused()
    // Focus goes back to what opened it — not to a title, or the keyboard
    // would come up over the outline that was just uncovered.
    await expect(editor.glyph('Vaihe', 'Toka')).toBeFocused()

    await editor.openDetails('Kolmas')
    await page.keyboard.press('Escape')
    await expect(editor.sheet).toBeHidden()
    await expect(editor.glyph('Vaihe', 'Kolmas')).toBeFocused()

    // A pull on the head: short springs back, long lets go.
    await editor.openDetails('Eka')
    await editor.pullSheetDown(30)
    await expect(editor.sheet).toBeVisible()
    await expect(editor.inspectorTitle).toHaveText('Eka')
    await editor.pullSheetDown(150)
    await expect(editor.sheet).toBeHidden()

    // Wide enough for a column, the same panel is not a dialog at all: nothing
    // behind it is blocked, and there is nothing to close.
    await editor.openDetails('Eka')
    await page.setViewportSize({ width: 1440, height: 800 })
    await expect(editor.sheet).toHaveCount(0)
    await expect(editor.sheetBackdrop).toHaveCount(0)
    await expect(editor.inspectorTitle).toHaveText('Eka')
    await editor.step('Toka').click()
    await expect(editor.inspectorTitle).toHaveText('Toka')
  })
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
  // Disabled for a reason, and it says which: "nothing to save" and "this will
  // not save" must not be one silent grey button.
  await expect(editor.saveButton).toHaveAccessibleDescription(/Menulla pitää olla nimi/)
  await editor.title.fill('Korjattu')
  await expect(editor.saveButton).toBeEnabled()
})

test('the header holds still whatever state the draft is in', async ({
  page,
  library,
  editor,
}) => {
  await page.goto('/')
  await library.import(smallDoc('Paikallaan'))
  await editor.expectOpen()

  // Hold the save in flight, so "Tallennetaan…" can be measured too.
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/api/menus/*', async (route) => {
    if (route.request().method() === 'PUT') await held
    await route.continue()
  })

  // 1440: the buttons share the row with the name field. 600: they wrap under
  // it, where a wider status used to wrap them onto a third row.
  for (const width of [1440, 600]) {
    await page.setViewportSize({ width, height: 800 })
    await editor.expectClean()
    const clean = await editor.headerGeometry()

    await editor.title.click()
    await page.keyboard.press('End')
    await page.keyboard.type('x')
    await editor.expectDirty()
    expect(await editor.headerGeometry(), `dirty at ${width}px`).toEqual(clean)

    await editor.title.fill('')
    await expect(editor.saveButton).toBeDisabled()
    expect(await editor.headerGeometry(), `blocked at ${width}px`).toEqual(clean)
    await editor.title.fill('Paikallaan')
    await editor.expectClean()
  }

  await editor.title.fill('Paikallaan 2')
  const before = await editor.headerGeometry()
  await editor.saveButton.click()
  await editor.expectSaving()
  expect(await editor.headerGeometry(), 'saving').toEqual(before)
  release()
  await editor.expectClean()
  expect(await editor.headerGeometry(), 'saved').toEqual(before)
})

test('save and undo stay on screen down a long menu, and no row scrolls in under them', async ({
  page,
  library,
  editor,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/')
  await library.import(longDoc('Pitkä'))
  await editor.expectOpen()

  await editor.step('Vaihe 40').click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  await editor.expectDirty()
  expect(await editor.isUncovered(editor.saveButton)).toBe(true)
  expect(await editor.isUncovered(editor.undoButton)).toBe(true)
  // The inspector column sticks as well, and stops below the header.
  expect(await editor.inspectorClearance()).toBeGreaterThanOrEqual(0)

  // Walking back up with ↑ scrolls each row in from above: it has to stop
  // below the sticky band, not at the top edge underneath it.
  for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowUp')
  await expect(editor.step('Vaihe 15')).toBeFocused()
  expect(await editor.isUncovered(editor.step('Vaihe 15'))).toBe(true)

  await editor.saveButton.click()
  await editor.expectClean()
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
  await expect(kitchen.page.getByTestId('step-row').filter({ hasText: renamed })).toBeVisible()
  await expect(second.page.getByTestId('step-row').filter({ hasText: renamed })).toBeVisible()
})

test("in a kitchen the header sticks flush to the overlay's top, with no strip above it", async ({
  page,
  room,
  editor,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(`/r/${room.id}`)
  await page.getByRole('button', { name: 'Muokkaa menua' }).click()
  await editor.expectOpen()

  // The overlay is its own scroll container, and a sticky header sticks at its
  // padding edge: with padding on top, rows scrolled through a 16px gap above it.
  await editor.titles().last().scrollIntoViewIfNeeded()
  expect(await editor.stickyBandTop()).toBe(0)
  expect(await editor.isUncovered(editor.saveButton)).toBe(true)
})

test('removing a step that somebody has started asks before discarding it', async ({
  page,
  room,
  editor,
}) => {
  await page.goto(`/r/${room.id}`)
  const doomed = 'Kuori ja pilko sipuli'
  const row = page.getByTestId('step-row').filter({ hasText: doomed })
  await row.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await expect(row).toHaveAttribute('data-status', 'active')

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
  await expect(page.getByTestId('step-row').filter({ hasText: doomed })).toHaveCount(0)
})

test('declining the confirmation leaves the kitchen exactly as it was', async ({
  page,
  room,
  editor,
}) => {
  await page.goto(`/r/${room.id}`)
  const doomed = 'Kuori ja pilko sipuli'
  const row = page.getByTestId('step-row').filter({ hasText: doomed })
  await row.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()

  await page.getByRole('button', { name: 'Muokkaa menua' }).click()
  await editor.deleteRow(doomed)

  page.on('dialog', (d) => void d.dismiss())
  await editor.saveButton.click()
  await editor.expectDirty()

  await editor.closeButton.click()
  await expect(row).toHaveAttribute('data-status', 'active')
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
  await expect(page.getByTestId('course')).toHaveCount(3)
  const roast = page.getByTestId('step-row').filter({ hasText: 'Paista uunissa' })
  const season = page.getByTestId('step-row').filter({ hasText: 'Mausta liha' })
  await expect(roast).toHaveAttribute('data-status', 'blocked')
  await season.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await season.getByRole('button', { name: 'Valmis' }).click()
  await expect(roast).toHaveAttribute('data-status', 'ready')
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
  await expect(page.getByTestId('step-row')).toHaveCount(4)

  // Finishing the first course's "Pilko" must not unblock the second course's
  // "Paista" — that is exactly what an id collision would have caused.
  const rows = page.getByTestId('step-row').filter({ hasText: 'Paista' })
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toHaveAttribute('data-status', 'blocked')
  await expect(rows.nth(1)).toHaveAttribute('data-status', 'blocked')

  const firstPilko = page.getByTestId('step-row').filter({ hasText: 'Pilko' }).nth(0)
  await firstPilko.getByRole('button', { name: 'Aloita' }).click()
  await page.getByRole('button', { name: 'Aloita ilman tekijää' }).click()
  await firstPilko.getByRole('button', { name: 'Valmis' }).click()

  // Exactly one of the two "Paista" steps became ready.
  await expect(page.locator('[data-testid="step-row"][data-status="ready"]').filter({ hasText: 'Paista' })).toHaveCount(1)
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
