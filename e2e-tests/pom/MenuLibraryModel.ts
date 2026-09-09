import { expect, type Locator, type Page } from '@playwright/test'

/** The "Omat menut" card on the landing page, and its import dialog. */
export class MenuLibraryModel {
  readonly page: Page
  readonly root: Locator
  readonly newButton: Locator
  readonly importButton: Locator
  readonly rows: Locator

  readonly dialog: Locator
  readonly importText: Locator
  readonly checkButton: Locator
  readonly confirmImportButton: Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.locator('.landing-card').filter({ hasText: 'Omat menut' })
    this.newButton = this.root.getByRole('button', { name: 'Uusi menu' })
    this.importButton = this.root.getByRole('button', { name: 'Tuo JSON' })
    this.rows = this.root.locator('.menu-row')

    this.dialog = page.getByRole('dialog', { name: 'Tuo menu' })
    this.importText = this.dialog.getByLabel('Menu JSON-muodossa')
    this.checkButton = this.dialog.getByRole('button', { name: 'Tarkista' })
    this.confirmImportButton = this.dialog.getByRole('button', { name: 'Tuo', exact: true })
  }

  row(name: string): Locator {
    return this.rows.filter({ hasText: name })
  }

  async open(name: string): Promise<void> {
    await this.row(name).locator('.menu-open').click()
  }

  async startKitchen(name: string): Promise<void> {
    await this.row(name).getByRole('button', { name: 'Käynnistä keittiö' }).click()
  }

  async expectListed(name: string): Promise<void> {
    await expect(this.row(name)).toBeVisible()
  }

  async expectMissing(name: string): Promise<void> {
    await expect(this.row(name)).toHaveCount(0)
  }

  /** Paste a document and run the dry-run check, without committing to it. */
  async check(doc: unknown): Promise<void> {
    await this.importButton.click()
    await expect(this.dialog).toBeVisible()
    await this.importText.fill(JSON.stringify(doc))
    await this.checkButton.click()
  }

  async import(doc: unknown): Promise<void> {
    await this.check(doc)
    await this.confirmImportButton.click()
    await expect(this.dialog).toBeHidden()
  }
}
