import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The menu outliner, at `/m/<id>` or as the overlay inside a kitchen.
 *
 * Rows are addressed by their visible title through the dynamic `aria-label`
 * the editor puts on every title input — React does not reflect a controlled
 * input's value into the DOM attribute, so there is nothing else to match on.
 */
export class MenuEditorModel {
  readonly page: Page
  readonly root: Locator
  readonly title: Locator
  readonly saveButton: Locator
  readonly dirtyFlag: Locator
  readonly problems: Locator
  readonly closeButton: Locator

  constructor(page: Page) {
    // Locators are built here, not as field initialisers: `useDefineForClassFields`
    // would run those before the constructor could store `page`.
    this.page = page
    this.root = page.locator('.editor')
    this.title = this.root.getByLabel('Menun nimi')
    this.saveButton = this.root.getByRole('button', { name: 'Tallenna', exact: true })
    this.dirtyFlag = this.root.locator('.editor-dirty')
    this.problems = this.root.locator('.editor-problems')
    this.closeButton = this.root.getByRole('button', { name: 'Sulje' })
  }

  /** The title input of a row, found by the text currently in it. */
  row(kind: 'Ruokalaji' | 'Osa' | 'Vaihe', title: string): Locator {
    return this.root.getByLabel(`${kind}: ${title}`, { exact: true })
  }

  step(title: string): Locator {
    return this.row('Vaihe', title)
  }

  /** The whole row block, for its buttons rather than its title. */
  stepRow(title: string): Locator {
    return this.root.locator('.outline-row.kind-step').filter({
      has: this.page.getByLabel(`Vaihe: ${title}`, { exact: true }),
    })
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

  async openDetails(stepTitle: string): Promise<void> {
    await this.stepRow(stepTitle).getByRole('button', { name: `Tiedot: ${stepTitle}` }).click()
  }

  async setStation(stepTitle: string, station: string): Promise<void> {
    await this.stepRow(stepTitle).getByRole('button', { name: station, exact: true }).click()
  }

  async addDependency(stepTitle: string, optionText: string): Promise<void> {
    await this.openDetails(stepTitle)
    await this.root.getByLabel('Lisää riippuvuus').selectOption({ label: optionText })
  }

  async deleteRow(title: string): Promise<void> {
    await this.root.getByRole('button', { name: `Poista ${title}` }).click()
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
