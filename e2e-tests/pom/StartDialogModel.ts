import { expect, type Locator, type Page } from '@playwright/test'

/** "Kuka ottaa tämän?" — shown when an unassigned step is started. */
export class StartDialogModel {
  readonly locator: Locator
  readonly stepTitle: Locator
  readonly withoutCookButton: Locator
  readonly cancelButton: Locator

  constructor(page: Page) {
    this.locator = page.getByRole('dialog', { name: 'Kuka ottaa tämän vaiheen?' })
    this.stepTitle = this.locator.locator('.muted.small')
    this.withoutCookButton = this.locator.getByRole('button', { name: 'Aloita ilman tekijää' })
    this.cancelButton = this.locator.getByRole('button', { name: 'Peruuta' })
  }

  cookChoice(name: string): Locator {
    return this.locator.locator('.cook-choice').filter({ hasText: name })
  }

  async expectOpen(stepTitle?: string): Promise<void> {
    await expect(this.locator).toBeVisible()
    if (stepTitle !== undefined) await expect(this.stepTitle).toContainText(stepTitle)
  }

  async chooseCook(name: string): Promise<void> {
    await this.cookChoice(name).click()
    await expect(this.locator).toBeHidden()
  }

  async startWithoutCook(): Promise<void> {
    await this.withoutCookButton.click()
    await expect(this.locator).toBeHidden()
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click()
    await expect(this.locator).toBeHidden()
  }
}
