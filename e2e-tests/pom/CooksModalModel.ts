import { expect, type Locator, type Page } from '@playwright/test'

/**
 * "Kokit" — the roster. Rows are addressed by cook name through the remove
 * button's aria-label, because the name itself only exists as the value of a
 * controlled input, which React does not keep in the DOM attribute.
 */
export class CooksModalModel {
  private readonly page: Page

  readonly locator: Locator
  readonly rows: Locator
  readonly nameInputs: Locator
  readonly addButton: Locator
  readonly closeButton: Locator

  constructor(page: Page) {
    this.page = page
    this.locator = page.getByRole('dialog', { name: 'Kokit' })
    this.rows = this.locator.locator('.cook-row')
    this.nameInputs = this.locator.getByRole('textbox', { name: 'Kokin nimi' })
    this.addButton = this.locator.getByRole('button', { name: 'Lisää kokki' })
    this.closeButton = this.locator.locator('.modal-actions').getByRole('button', { name: 'Sulje' })
  }

  row(name: string): Locator {
    return this.rows.filter({ has: this.page.getByRole('button', { name: `Poista ${name}` }) })
  }

  nameInput(name: string): Locator {
    return this.row(name).getByRole('textbox', { name: 'Kokin nimi' })
  }

  /** "Oon tää": which cook this browser is. Local to the browser, not the room. */
  meButton(name: string): Locator {
    return this.row(name).getByRole('button', { name: 'Oon tää' })
  }

  removeButton(name: string): Locator {
    return this.locator.getByRole('button', { name: `Poista ${name}` })
  }

  /** Somebody has the room open as this cook right now. */
  presenceDot(name: string): Locator {
    return this.row(name).getByRole('img', { name: 'Paikalla' })
  }

  async expectOpen(): Promise<void> {
    await expect(this.locator).toBeVisible()
  }

  async addCook(): Promise<void> {
    const before = await this.rows.count()
    await this.addButton.click()
    await expect(this.rows).toHaveCount(before + 1)
  }

  async renameCook(from: string, to: string): Promise<void> {
    await this.nameInput(from).fill(to)
    await expect(this.nameInput(to)).toHaveValue(to)
  }

  async removeCook(name: string): Promise<void> {
    await this.removeButton(name).click()
    await expect(this.row(name)).toHaveCount(0)
  }

  async claimAsMe(name: string): Promise<void> {
    await this.meButton(name).click()
    await expect(this.meButton(name)).toHaveAttribute('aria-pressed', 'true')
  }

  async expectCookNames(names: string[]): Promise<void> {
    await expect(this.nameInputs).toHaveCount(names.length)
    for (const [i, name] of names.entries()) {
      await expect(this.nameInputs.nth(i)).toHaveValue(name)
    }
  }

  async expectPresent(name: string): Promise<void> {
    await expect(this.presenceDot(name)).toBeVisible()
  }

  async expectAway(name: string): Promise<void> {
    await expect(this.presenceDot(name)).toHaveCount(0)
  }

  async close(): Promise<void> {
    await this.closeButton.click()
    await expect(this.locator).toBeHidden()
  }
}
