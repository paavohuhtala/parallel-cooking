import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The menu outliner, at `/m/<id>` or as the overlay inside a kitchen.
 *
 * Rows are addressed by their visible title through the dynamic `aria-label`
 * the editor puts on every title input — React does not reflect a controlled
 * input's value into the DOM attribute, so there is nothing else to match on.
 * The same trick names each row's `⋯` menu and each list's tail row, so a move
 * here reads as "the thing called X", never as a nth-child.
 */
export class MenuEditorModel {
  readonly page: Page
  readonly root: Locator
  readonly title: Locator
  readonly saveButton: Locator
  readonly dirtyFlag: Locator
  readonly problems: Locator
  readonly closeButton: Locator
  readonly mergeButton: Locator
  readonly importDialog: Locator
  readonly inspector: Locator
  readonly inspectorTitle: Locator
  readonly addCourseButton: Locator
  readonly undoButton: Locator
  readonly redoButton: Locator

  constructor(page: Page) {
    // Locators are built here, not as field initialisers: `useDefineForClassFields`
    // would run those before the constructor could store `page`.
    this.page = page
    this.root = page.locator('.editor')
    this.title = this.root.getByLabel('Menun nimi')
    this.saveButton = this.root.getByRole('button', { name: 'Tallenna', exact: true })
    this.dirtyFlag = this.root.locator('.editor-dirty')
    this.problems = this.root.locator('.editor-problems')
    this.closeButton = this.root.getByRole('button', { name: 'Sulje', exact: true })
    this.mergeButton = this.root.getByRole('button', { name: 'Tuo ja yhdistä' })
    this.importDialog = page.getByRole('dialog', { name: 'Tuo ja yhdistä' })
    this.inspector = this.root.locator('.inspector')
    this.inspectorTitle = this.inspector.locator('.inspector-title')
    this.addCourseButton = this.root.getByLabel('Lisää ruokalaji', { exact: true })
    this.undoButton = this.root.getByLabel('Kumoa', { exact: true })
    this.redoButton = this.root.getByLabel('Tee uudelleen', { exact: true })
  }

  /* ---------------------------------------------------------------- undo */

  /**
   * Undo through the keyboard, which is the way it is reached in practice.
   * `ControlOrMeta` so the same spec means Cmd on a Mac runner.
   */
  async undo(): Promise<void> {
    await this.page.keyboard.press('ControlOrMeta+z')
  }

  async redo(): Promise<void> {
    await this.page.keyboard.press('ControlOrMeta+Shift+z')
  }

  /**
   * Empty a row's title and press Backspace once more — the keystroke that used
   * to delete whatever the row was, contents and all.
   */
  async backspaceEmptyRow(kind: 'Ruokalaji' | 'Osa' | 'Vaihe', title: string): Promise<void> {
    await this.row(kind, title).click()
    await this.page.keyboard.press('ControlOrMeta+a')
    await this.page.keyboard.press('Backspace')
    await this.page.keyboard.press('Backspace')
  }

  /** The title input of a row, found by the text currently in it. */
  row(kind: 'Ruokalaji' | 'Osa' | 'Vaihe', title: string): Locator {
    return this.root.getByLabel(`${kind}: ${title}`, { exact: true })
  }

  step(title: string): Locator {
    return this.row('Vaihe', title)
  }

  /** The whole row block, for its buttons and its geometry rather than its title. */
  rowBlock(kind: 'Ruokalaji' | 'Osa' | 'Vaihe', title: string): Locator {
    return this.root.locator('.outline-row').filter({
      has: this.page.getByLabel(`${kind}: ${title}`, { exact: true }),
    })
  }

  stepRow(title: string): Locator {
    return this.rowBlock('Vaihe', title)
  }

  /** Press the row's blank space, past the end of its title. */
  async clickRowBlank(kind: 'Ruokalaji' | 'Osa' | 'Vaihe', title: string): Promise<void> {
    const block = this.rowBlock(kind, title)
    const box = await block.boundingBox()
    if (!box) throw new Error(`row ${kind}: ${title} is not on screen`)
    await block.click({ position: { x: box.width - 20, y: box.height / 2 } })
  }

  /**
   * Pixels from the end of a row's title *text* to its `⋯`. Measured from the
   * text rather than from the field, because a field as wide as the column puts
   * the button right after the field and ~700px from anything you can read.
   */
  async menuButtonDistance(kind: 'Ruokalaji' | 'Osa' | 'Vaihe', title: string): Promise<number> {
    return this.rowBlock(kind, title).evaluate((row) => {
      const input = row.querySelector('.outline-title') as HTMLInputElement
      const button = row.querySelector('.row-menu-open')!
      const style = getComputedStyle(input)
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const textEnd =
        input.getBoundingClientRect().left +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.paddingLeft) +
        ctx.measureText(input.value).width
      return Math.round(button.getBoundingClientRect().left - textEnd)
    })
  }

  /** An `<input>` cannot ellipsize, so overflow means text cut through a glyph. */
  async titleClipped(kind: 'Ruokalaji' | 'Osa' | 'Vaihe', title: string): Promise<boolean> {
    return this.row(kind, title).evaluate((el) => el.scrollWidth > el.clientWidth)
  }

  titles(): Locator {
    return this.root.locator('.outline-title')
  }

  /**
   * The outline in order. Rows are `<input>`s, so their text content is always
   * empty — the value is the thing to compare.
   */
  async expectTitles(expected: string[]): Promise<void> {
    await expect
      .poll(() =>
        this.titles().evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value)),
      )
      .toEqual(expected)
  }

  async expectOpen(): Promise<void> {
    await expect(this.root).toBeVisible()
  }

  /** Type into the focused row and press Enter, which starts the next one. */
  async typeRow(text: string): Promise<void> {
    await this.page.keyboard.type(text)
    await this.page.keyboard.press('Enter')
  }

  /* ------------------------------------------------------------ tail rows */

  /**
   * The "+ Osa" / "+ Vaihe" / "+ Ruokalaji" rows. Each leaves the cursor in
   * the row it made, so `name` is typed straight into it.
   */
  async addCourse(name: string): Promise<void> {
    await this.addCourseButton.click()
    await this.page.keyboard.type(name)
  }

  async addComponent(courseName: string, name: string): Promise<void> {
    await this.root.getByLabel(`Lisää osa kohtaan ${courseName}`, { exact: true }).click()
    await this.page.keyboard.type(name)
  }

  async addStep(componentName: string, title: string): Promise<void> {
    await this.root.getByLabel(`Lisää vaihe kohtaan ${componentName}`, { exact: true }).click()
    await this.page.keyboard.type(title)
  }

  /* -------------------------------------------------------- the row's menu */

  /**
   * Open a row's `⋯`, which is where everything but typing lives. Matched as a
   * substring, so a spec can name a long step by the part that identifies it.
   */
  async openRowMenu(title: string): Promise<Locator> {
    // By role: the open menu carries the same label as the button that opened it.
    await this.root.getByRole('button', { name: `Toiminnot: ${title}` }).click()
    return this.page.getByRole('menu')
  }

  async closeRowMenu(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await expect(this.page.getByRole('menu')).toBeHidden()
  }

  async openDetails(title: string): Promise<void> {
    // A step wears its details on the station glyph; a course or a dish has
    // nothing in that slot but its disclosure triangle, so it goes via ⋯.
    const glyph = this.root.getByLabel(`Tiedot: ${title}`)
    if (await glyph.count()) {
      await glyph.click()
    } else {
      const menu = await this.openRowMenu(title)
      await menu.getByRole('menuitem', { name: 'Tiedot' }).click()
    }
    await expect(this.inspector).toBeVisible()
  }

  async moveRow(title: string, direction: 'ylös' | 'alas'): Promise<void> {
    const menu = await this.openRowMenu(title)
    await menu.getByRole('menuitem', { name: `Siirrä ${direction}` }).click()
  }

  async deleteRow(title: string): Promise<void> {
    await (await this.deleteItem(title)).click()
  }

  /**
   * A row's delete item, menu opened. Its label carries the counts of what it
   * would take, so it is matched on the verb; inside an open menu there is
   * only ever one of them.
   */
  async deleteItem(title: string): Promise<Locator> {
    const menu = await this.openRowMenu(title)
    return menu.getByRole('menuitem', { name: /^Poista/ })
  }

  async toggleCollapse(title: string, to: 'Näytä' | 'Piilota'): Promise<void> {
    await this.root.getByLabel(`${to} sisältö: ${title}`, { exact: true }).click()
  }

  /* -------------------------------------------------------- the inspector */

  async setStation(stepTitle: string, station: string): Promise<void> {
    await this.openDetails(stepTitle)
    await this.inspector.getByLabel(station, { exact: true }).click()
  }

  /**
   * The inspector is a fixed column, so nothing inside it may take its width
   * from its content — a long step title in a dependency chip, or as an option
   * in the picker, would otherwise hand the panel a horizontal scrollbar.
   *
   * The picker is measured against the panel rather than just checking the
   * scroll width, because a `select` is sized by its widest *option*: a step
   * with nothing left to depend on has an empty picker that fits no matter what
   * the CSS says, and an assertion that only ever saw one of those would pass
   * while the panel was visibly broken.
   */
  async expectNoHorizontalOverflow(): Promise<void> {
    await expect
      .poll(() =>
        this.inspector.evaluate((el) => {
          const picker = el.querySelector('.dep-picker') as HTMLSelectElement | null
          return {
            panelOverflow: el.scrollWidth - el.clientWidth,
            pageOverflow:
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
            pickerFits: picker === null || picker.getBoundingClientRect().width <= el.clientWidth,
          }
        }),
      )
      .toEqual({ panelOverflow: 0, pageOverflow: 0, pickerFits: true })
  }

  /**
   * The rendered distance between a field's label and the controls under it.
   *
   * Measured in pixels rather than read off `row-gap`, because the property can
   * say 10px while nothing moves: a `<legend>` is not a flex item, so a gap on
   * its fieldset applies to nothing, and an assertion on the declared value
   * passes while the label sits flush against its own controls.
   */
  async labelSpacing(label: string): Promise<number | null> {
    return this.inspector.evaluate((panel, label) => {
      const el = [...panel.querySelectorAll('legend, .field > span')].find(
        (x) => x.textContent?.trim() === label,
      )
      const next = el?.parentElement?.querySelector('.chips, textarea, input')
      if (!el || !next) return null
      return Math.round(next.getBoundingClientRect().top - el.getBoundingClientRect().bottom)
    }, label)
  }

  /** Guards the test above against going vacuous: an empty picker proves nothing. */
  async expectDependencyOptions(atLeast: number): Promise<void> {
    await expect
      .poll(() => this.inspector.locator('.dep-picker option').count())
      .toBeGreaterThanOrEqual(atLeast)
  }

  async addDependency(stepTitle: string, optionText: string): Promise<void> {
    await this.openDetails(stepTitle)
    await this.inspector.getByLabel('Lisää riippuvuus').selectOption({ label: optionText })
  }

  /** Append another converted recipe to the menu that is open. */
  async merge(doc: unknown): Promise<void> {
    await this.mergeButton.click()
    await expect(this.importDialog).toBeVisible()
    await this.importDialog.getByLabel('Menu JSON-muodossa').fill(JSON.stringify(doc))
    await this.importDialog.getByRole('button', { name: 'Yhdistä' }).click()
    await expect(this.importDialog).toBeHidden()
  }

  async save(): Promise<void> {
    await this.saveButton.click()
    await expect(this.dirtyFlag).toHaveText('Tallennettu')
  }

  async expectClean(): Promise<void> {
    await expect(this.dirtyFlag).toHaveText('Tallennettu')
  }

  async expectDirty(): Promise<void> {
    await expect(this.dirtyFlag).toHaveText('Tallentamattomia muutoksia')
  }
}
