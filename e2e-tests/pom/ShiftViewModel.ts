import { expect, type Locator, type Page } from '@playwright/test'

/** One card in "Työn alla": something this cook has going. */
export class ActiveCardModel {
  readonly root: Locator
  readonly title: Locator
  readonly detail: Locator
  readonly elapsed: Locator
  readonly finishButton: Locator
  readonly moreButton: Locator

  constructor(shift: Locator, title: string) {
    this.root = shift.locator('.shift-card.is-active').filter({ hasText: title })
    this.title = this.root.locator('.shift-title')
    this.detail = this.root.locator('.shift-detail')
    this.elapsed = this.root.locator('.shift-elapsed')
    this.finishButton = this.root.getByRole('button', { name: 'Valmis' })
    this.moreButton = this.root.getByRole('button', { name: /^Muut toiminnot/ })
  }

  async finish(): Promise<void> {
    await this.finishButton.click()
  }

  /** Collapses or expands the card by its head. */
  async toggle(): Promise<void> {
    await this.root.locator('.shift-card-head').click()
  }

  async expectOpen(): Promise<void> {
    await expect(this.detail).toBeVisible()
  }

  async expectCollapsed(): Promise<void> {
    await expect(this.detail).toHaveCount(0)
  }
}

/**
 * "Oma vuoro": one cook on one phone. Three zones — what I have going, what to
 * take next, and who I am waiting on — plus the gate that asks who is holding
 * the device before any of it is shown.
 */
export class ShiftViewModel {
  readonly locator: Locator
  readonly gate: Locator
  readonly activeZone: Locator
  readonly hero: Locator
  readonly heroTitle: Locator
  readonly heroReason: Locator
  readonly heroStart: Locator
  readonly toast: Locator
  readonly rows: Locator

  constructor(page: Page) {
    this.locator = page.locator('.shift')
    this.gate = page.locator('.shift-gate')
    this.activeZone = this.locator.locator('.shift-card.is-active')
    this.hero = this.locator.locator('.shift-card.is-hero')
    this.heroTitle = this.hero.locator('.shift-title')
    this.heroReason = this.hero.locator('.shift-why')
    this.heroStart = this.hero.getByRole('button', { name: 'Aloita' })
    this.toast = page.locator('.shift-toast')
    this.rows = this.locator.locator('.shift-row')
  }

  card(title: string): ActiveCardModel {
    return new ActiveCardModel(this.locator, title)
  }

  async expectVisible(): Promise<void> {
    await expect(this.locator).toBeVisible()
  }

  /** Say who this browser is, which is what makes every `Aloita` one tap. */
  async claim(cookName: string): Promise<void> {
    await this.gate.getByRole('button', { name: cookName }).click()
    await this.expectVisible()
  }

  async expectGate(): Promise<void> {
    await expect(this.gate.getByRole('heading', { name: 'Kuka sinä olet?' })).toBeVisible()
  }

  /** Take the suggested step. No dialog: the view already knows who you are. */
  async startSuggested(): Promise<void> {
    await this.heroStart.click()
  }

  async expectSuggested(title: string, reason?: string | RegExp): Promise<void> {
    await expect(this.heroTitle).toContainText(title)
    if (reason !== undefined) await expect(this.heroReason).toHaveText(reason)
  }

  async expectNothingSuggested(): Promise<void> {
    await expect(this.hero).toHaveCount(0)
  }

  async expectActive(...titles: string[]): Promise<void> {
    await expect(this.activeZone).toHaveCount(titles.length)
    for (const title of titles) await expect(this.card(title).root).toBeVisible()
  }

  /** Opens one of the collapsed lists — "Kaikki vapaat", "Odottaa muita"… */
  async unfold(label: string): Promise<Locator> {
    const fold = this.locator.locator('.shift-fold').filter({ hasText: label })
    await fold.click()
    return fold
  }

  row(title: string): Locator {
    return this.rows.filter({ hasText: title })
  }

  async startFromList(title: string): Promise<void> {
    await this.row(title).getByRole('button', { name: 'Aloita' }).click()
  }

  async expectToast(text: string | RegExp): Promise<void> {
    await expect(this.toast).toContainText(text)
  }

  async takeWhatOpened(): Promise<void> {
    await this.toast.getByRole('button', { name: 'Aloita se' }).click()
  }

  async undoFromToast(): Promise<void> {
    await this.toast.getByRole('button', { name: 'Kumoa' }).click()
  }

  /** Filters the zone — hero included — down to one station. */
  async filterByStation(label: string): Promise<void> {
    await this.locator.locator('.shift-filters').getByRole('button', { name: label }).click()
  }
}
