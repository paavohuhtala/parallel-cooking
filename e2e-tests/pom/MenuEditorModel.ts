import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The menu outliner, at `/m/<id>` or as the overlay inside a kitchen.
 *
 * Rows are addressed by their visible title through the dynamic `aria-label`
 * the editor puts on every title field — React does not reflect a controlled
 * field's value into the DOM, so there is nothing else to match on.
 * The same trick names each row's `⋯` menu and each list's tail row, so a move
 * here reads as "the thing called X", never as a nth-child.
 */
export class MenuEditorModel {
  readonly page: Page
  readonly root: Locator
  readonly title: Locator
  readonly saveButton: Locator
  readonly problems: Locator
  readonly closeButton: Locator
  readonly mergeButton: Locator
  readonly importDialog: Locator
  readonly inspector: Locator
  readonly inspectorTitle: Locator
  /** The inspector as a modal sheet — only below 900px is it one. */
  readonly sheet: Locator
  readonly sheetBackdrop: Locator
  readonly sheetHead: Locator
  readonly addCourseButton: Locator
  readonly undoButton: Locator
  readonly redoButton: Locator
  /** The header's `⋯`, which holds the rarely used actions on a phone. */
  readonly moreButton: Locator

  constructor(page: Page) {
    // Locators are built here, not as field initialisers: `useDefineForClassFields`
    // would run those before the constructor could store `page`.
    this.page = page
    this.root = page.getByTestId('menu-editor')
    this.title = this.root.getByLabel('Menun nimi')
    // By test id, not by name: the button's name *is* the draft's state.
    this.saveButton = this.root.getByTestId('editor-save')
    this.problems = this.root.getByTestId('editor-problems')
    this.closeButton = this.root.getByRole('button', { name: 'Sulje', exact: true })
    this.mergeButton = this.root.getByRole('button', { name: 'Tuo ja yhdistä' })
    this.importDialog = page.getByRole('dialog', { name: 'Tuo ja yhdistä' })
    this.inspector = this.root.getByTestId('inspector')
    this.inspectorTitle = this.inspector.getByTestId('inspector-title')
    this.sheet = this.root.getByRole('dialog', { name: 'Rivin tiedot' })
    this.sheetBackdrop = this.root.getByTestId('detail-backdrop')
    this.sheetHead = this.inspector.getByTestId('inspector-grab')
    this.addCourseButton = this.root.getByLabel('Lisää ruokalaji', { exact: true })
    this.undoButton = this.root.getByLabel('Kumoa', { exact: true })
    this.redoButton = this.root.getByLabel('Tee uudelleen', { exact: true })
    this.moreButton = this.root.getByRole('button', { name: 'Lisää toimintoja' })
  }

  async openMoreMenu(): Promise<Locator> {
    await this.moreButton.click()
    return this.page.getByRole('menu', { name: 'Lisää toimintoja' })
  }

  /**
   * Whether `target` is on screen and nothing is drawn over its centre — the
   * sticky header, say, or the band a row scrolled under.
   */
  async isUncovered(target: Locator): Promise<boolean> {
    return target.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      if (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth) return false
      const at = document.elementFromPoint(x, y)
      return at !== null && el.contains(at)
    })
  }

  /**
   * How many lines the header's visible actions are laid out on. By centre,
   * not top: they differ in height and are centred on their line.
   */
  async headerActionLines(): Promise<number> {
    return this.root.getByTestId('editor-actions').evaluate((actions) => {
      const centres = [...actions.children]
        .filter((el) => el.checkVisibility())
        .map((el) => {
          const r = el.getBoundingClientRect()
          return Math.round(r.top + r.height / 2)
        })
      return new Set(centres).size
    })
  }

  /**
   * The top of whichever part of the header is sticking — all of it beside the
   * outline, only its actions on a phone — relative to the viewport.
   */
  async stickyBandTop(): Promise<number> {
    return this.root.evaluate((root) => {
      const band = [
        root.querySelector('[data-testid="editor-head"]')!,
        root.querySelector('[data-testid="editor-actions"]')!,
      ].find(
        (el) => {
          const style = getComputedStyle(el)
          return style.position === 'sticky' && style.display !== 'contents'
        },
      )!
      return Math.round(band.getBoundingClientRect().top)
    })
  }

  /** Where the header's sticky band and the inspector column meet, in px: >= 0 means apart. */
  async inspectorClearance(): Promise<number> {
    return this.root.evaluate((root) => {
      const band = root.querySelector('[data-testid="editor-head"]')!.getBoundingClientRect()
      const panel = root.querySelector('[data-testid="inspector"]')!.getBoundingClientRect()
      return Math.round(panel.top - band.bottom)
    })
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
    return this.root.getByTestId('outline-row').filter({
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
      const input = row.querySelector('[data-testid="outline-title"]') as HTMLTextAreaElement
      const button = row.querySelector('[data-testid="row-menu-open"]')!
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

  /**
   * A form field cannot ellipsize, so overflow means text cut through a glyph —
   * sideways in a field that scrolls, or downwards in one that wraps but did
   * not grow.
   */
  async titleClipped(kind: 'Ruokalaji' | 'Osa' | 'Vaihe', title: string): Promise<boolean> {
    return this.row(kind, title).evaluate(
      (el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight,
    )
  }

  /** How many lines a row's title is laid out on. */
  async titleLines(kind: 'Ruokalaji' | 'Osa' | 'Vaihe', title: string): Promise<number> {
    return this.row(kind, title).evaluate((el) => {
      const style = getComputedStyle(el)
      const content =
        el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      return Math.round(content / parseFloat(style.lineHeight))
    })
  }

  /**
   * How far the centres of a row's left glyph and its `⋯` sit from the centre
   * of the title's *first* line, in whole pixels. Beside a wrapped title they
   * belong to the line the title starts on, not to the middle of the block.
   */
  async sideControlOffsets(
    kind: 'Ruokalaji' | 'Osa' | 'Vaihe',
    title: string,
  ): Promise<{ glyph: number; menu: number }> {
    return this.rowBlock(kind, title).evaluate((row) => {
      const input = row.querySelector('[data-testid="outline-title"]')!
      const style = getComputedStyle(input)
      const top = input.getBoundingClientRect().top
      const firstLine =
        top +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.paddingTop) +
        parseFloat(style.lineHeight) / 2
      // `+ 0` turns a -0 into a 0, which `toEqual` would otherwise tell apart.
      const offset = (el: Element) => {
        const r = el.getBoundingClientRect()
        return Math.round(r.top + r.height / 2 - firstLine) + 0
      }
      return {
        glyph: offset(row.querySelector('[data-testid="row-glyph"]')!),
        menu: offset(row.querySelector('[data-testid="row-menu-open"]')!),
      }
    })
  }

  /**
   * The area a tap on `target` lands in, in whole pixels, found by asking the
   * page what is under each point rather than by reading the element's box: a
   * target can be larger than what it draws, and a neighbour can take part of
   * it. Probed outwards from the centre, each edge bisected to a tenth of a
   * pixel; capped at 80, since only "at least 44" is ever the question.
   */
  async hitArea(target: Locator): Promise<{ width: number; height: number }> {
    return target.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const hits = (x: number, y: number) => {
        const at = document.elementFromPoint(x, y)
        return at !== null && el.contains(at)
      }
      const reach = (dx: number, dy: number) => {
        let inside = 0
        let outside = 40
        if (hits(cx + dx * outside, cy + dy * outside)) return outside
        while (outside - inside > 0.1) {
          const mid = (inside + outside) / 2
          if (hits(cx + dx * mid, cy + dy * mid)) inside = mid
          else outside = mid
        }
        return inside
      }
      return {
        width: Math.round(reach(-1, 0) + reach(1, 0)),
        height: Math.round(reach(0, -1) + reach(0, 1)),
      }
    })
  }

  /** The row's left glyph: a disclosure on a course or a dish, the station on a step. */
  glyph(kind: 'Ruokalaji' | 'Osa' | 'Vaihe', title: string): Locator {
    return this.rowBlock(kind, title).getByTestId('row-glyph')
  }

  rowMenuButton(title: string): Locator {
    return this.root.getByRole('button', { name: `Toiminnot: ${title}` })
  }

  tailRow(kind: 'Osa' | 'Vaihe', parentName: string): Locator {
    return this.root.getByLabel(`Lisää ${kind.toLowerCase()} kohtaan ${parentName}`, { exact: true })
  }

  /** What a tap at the first letter of a row's title lands on. */
  async titleTextTakesTap(kind: 'Ruokalaji' | 'Osa' | 'Vaihe', title: string): Promise<boolean> {
    return this.row(kind, title).evaluate((el) => {
      const style = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const x = r.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) + 1
      return document.elementFromPoint(x, r.top + r.height / 2) === el
    })
  }

  titles(): Locator {
    return this.root.getByTestId('outline-title')
  }

  /**
   * The outline in order. Rows are form fields, so their text content is
   * always empty — the value is the thing to compare.
   */
  async expectTitles(expected: string[]): Promise<void> {
    await expect
      .poll(() =>
        this.titles().evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value)),
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
    await this.tailRow('Osa', courseName).click()
    await this.page.keyboard.type(name)
  }

  async addStep(componentName: string, title: string): Promise<void> {
    await this.tailRow('Vaihe', componentName).click()
    await this.page.keyboard.type(title)
  }

  /* -------------------------------------------------------- the row's menu */

  /**
   * Open a row's `⋯`, which is where everything but typing lives. Matched as a
   * substring, so a spec can name a long step by the part that identifies it.
   */
  async openRowMenu(title: string): Promise<Locator> {
    // By role: the open menu carries the same label as the button that opened it.
    await this.rowMenuButton(title).click()
    return this.page.getByRole('menu')
  }

  /** The open row menu lies wholly inside the viewport, whichever way it opened. */
  async expectRowMenuOnScreen(): Promise<void> {
    await expect
      .poll(() =>
        this.page.getByRole('menu').evaluate((el) => {
          const r = el.getBoundingClientRect()
          return r.left >= 0 && r.right <= document.documentElement.clientWidth
        }),
      )
      .toBe(true)
  }

  async closeRowMenu(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await expect(this.page.getByRole('menu')).toBeHidden()
  }

  async openDetails(title: string): Promise<void> {
    // A step wears its details on the station glyph. A course or a dish has
    // nothing in that slot but its disclosure triangle; beside the outline the
    // inspector follows the selection, so being in the row is enough.
    const glyph = this.root.getByLabel(`Tiedot: ${title}`)
    if (await glyph.count()) {
      await glyph.click()
    } else {
      await this.row('Ruokalaji', title).or(this.row('Osa', title)).click()
    }
    await expect(this.inspector).toBeVisible()
  }

  /**
   * The phone's route to a course's or a dish's details: there the inspector
   * is a sheet, selecting a row does not open it, and the row menu carries a
   * Tiedot item that the desktop layout hides.
   */
  async openDetailsFromMenu(title: string): Promise<void> {
    const menu = await this.openRowMenu(title)
    await menu.getByRole('menuitem', { name: 'Tiedot' }).click()
    await expect(this.inspector).toBeVisible()
  }

  /**
   * Press where a row shows above the open sheet. Before the sheet had a
   * backdrop, this landed on the row and quietly swapped what the sheet was
   * editing.
   */
  async pressRowBehindSheet(kind: 'Ruokalaji' | 'Osa' | 'Vaihe', title: string): Promise<void> {
    const box = await this.row(kind, title).boundingBox()
    if (!box) throw new Error(`row ${kind}: ${title} is not on screen`)
    await this.page.mouse.click(box.x + 20, box.y + box.height / 2)
  }

  /** Pull the sheet down by its head, as a finger would, and let go. */
  async pullSheetDown(px: number): Promise<void> {
    const box = await this.sheetHead.boundingBox()
    if (!box) throw new Error('the sheet is not open')
    const x = box.x + box.width / 3
    const y = box.y + 8
    await this.page.mouse.move(x, y)
    await this.page.mouse.down()
    await this.page.mouse.move(x, y + px, { steps: 8 })
    await this.page.mouse.up()
  }

  /** Whether keyboard focus is anywhere inside the open sheet. */
  async focusInSheet(): Promise<boolean> {
    return this.sheet.evaluate((el) => el.contains(document.activeElement))
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
          const picker = el.querySelector('[data-testid="dep-picker"]') as HTMLSelectElement | null
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
      const el = [...panel.querySelectorAll('legend, [data-testid="field-label"]')].find(
        (x) => x.textContent?.trim() === label,
      )
      const next = el?.parentElement?.querySelector('[data-testid="chips"], textarea, input')
      if (!el || !next) return null
      return Math.round(next.getBoundingClientRect().top - el.getBoundingClientRect().bottom)
    }, label)
  }

  /** Guards the test above against going vacuous: an empty picker proves nothing. */
  async expectDependencyOptions(atLeast: number): Promise<void> {
    await expect
      .poll(() => this.inspector.getByTestId('dep-picker').locator('option').count())
      .toBeGreaterThanOrEqual(atLeast)
  }

  /**
   * One of a dish's ingredients in its inspector: the name field. Its label
   * carries the name as last committed, so it holds still while being retyped.
   */
  ingredient(name: string): Locator {
    return this.inspector.getByLabel(`Aines: ${name}`, { exact: true })
  }

  /** Retype an ingredient's name and press Enter, which is what sends it. */
  async renameIngredient(from: string, to: string): Promise<void> {
    await this.ingredient(from).fill(to)
    await this.page.keyboard.press('Enter')
  }

  /** A step's "Tarvitaan" chips; `pressed: true` narrows them to the ones it uses. */
  stepIngredients(options?: { pressed: boolean }): Locator {
    return this.inspector.getByRole('group', { name: 'Tarvitaan' }).getByRole('button', options)
  }

  /** A step's slice of the dependency gutter beside the outline. */
  gutter(stepTitle: string): Locator {
    return this.root
      .getByTestId('outline-line')
      .filter({ has: this.page.getByLabel(`Vaihe: ${stepTitle}`, { exact: true }) })
      .getByTestId('dep-gutter')
  }

  /**
   * What the gutter draws at a step: whether the plain chain joins it to the
   * step above and below, and how many lanes — the exceptions — attach to it.
   */
  async expectGutter(
    stepTitle: string,
    expected: { trunk: 'in' | 'out' | 'in out' | null; lanes: number },
  ): Promise<void> {
    const gutter = this.gutter(stepTitle)
    if (expected.trunk === null) await expect(gutter).not.toHaveAttribute('data-trunk')
    else await expect(gutter).toHaveAttribute('data-trunk', expected.trunk)
    await expect(gutter).toHaveAttribute('data-branches', String(expected.lanes))
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
    await this.expectClean()
  }

  /*
   * The state is read off the button's accessible name, not its text: every
   * label is in the DOM, stacked, and only the visible one counts toward the
   * name — which is also what a screen reader says.
   */
  async expectClean(): Promise<void> {
    await expect(this.saveButton).toHaveAccessibleName('Tallennettu')
  }

  async expectDirty(): Promise<void> {
    await expect(this.saveButton).toHaveAccessibleName('Tallenna')
  }

  async expectSaving(): Promise<void> {
    await expect(this.saveButton).toHaveAccessibleName('Tallennetaan…')
  }

  /**
   * Where the header's parts sit, rounded to whole pixels. Compared across
   * states: the first keystroke used to shrink the name field being typed in
   * by 95px, or wrap the buttons onto another row.
   */
  async headerGeometry(): Promise<Record<string, number>> {
    return this.root.getByTestId('editor-head').evaluate((head) => {
      const box = (el: Element | null) => el!.getBoundingClientRect()
      const title = box(head.querySelector('[data-testid="editor-title"]'))
      const save = box(head.querySelector('[data-testid="editor-save"]'))
      // From the name to the bottom of the actions, rather than the header's
      // own box: on a phone the header is `display: contents` and has none.
      const actions = box(head.querySelector('[data-testid="editor-actions"]'))
      return {
        headHeight: Math.round(actions.bottom - title.top),
        titleWidth: Math.round(title.width),
        saveLeft: Math.round(save.left),
        saveTop: Math.round(save.top),
        saveWidth: Math.round(save.width),
      }
    })
  }
}
