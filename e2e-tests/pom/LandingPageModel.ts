import { expect, type Locator, type Page } from '@playwright/test'
import { KitchenPageModel } from './KitchenPageModel.ts'

/** The front page: pick a menu, name the kitchen, get a link to share. */
export class LandingPageModel {
  private readonly page: Page

  readonly heading: Locator
  readonly nameInput: Locator
  readonly menuOptions: Locator
  readonly createButton: Locator
  readonly error: Locator
  readonly recentSection: Locator
  readonly recentRooms: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: 'Keittiömestari' })
    this.nameInput = page.getByRole('textbox', { name: 'Nimi' })
    this.menuOptions = page.getByRole('radio')
    this.createButton = page.getByRole('button', { name: 'Luo keittiö' })
    this.error = page.locator('.error')
    this.recentSection = page.locator('.landing-card').filter({ hasText: 'Viimeksi avatut' })
    this.recentRooms = this.recentSection.locator('.recent-item')
  }

  menuOption(name: string): Locator {
    return this.page.locator('.menu-row').filter({ hasText: name }).getByRole('radio')
  }

  recentRoom(name: string): Locator {
    return this.recentRooms.filter({ hasText: name })
  }

  async goto(): Promise<void> {
    await this.page.goto('/')
    await expect(this.heading).toBeVisible()
    // The menu list arrives from /api/templates and /api/menus, and nothing can
    // be created before it does.
    await expect(this.createButton).toBeEnabled()
  }

  async chooseMenu(name: string): Promise<void> {
    await this.menuOption(name).check()
  }

  /** Creates the kitchen and follows the navigation into it. */
  async createKitchen(name?: string): Promise<KitchenPageModel> {
    if (name !== undefined) await this.nameInput.fill(name)
    await this.createButton.click()
    await this.page.waitForURL(/\/r\/[^/]+$/)
    const kitchen = new KitchenPageModel(this.page)
    await kitchen.expectLoaded()
    return kitchen
  }

  async openRecentRoom(name: string): Promise<KitchenPageModel> {
    await this.recentRoom(name).click()
    await this.page.waitForURL(/\/r\/[^/]+$/)
    const kitchen = new KitchenPageModel(this.page)
    await kitchen.expectLoaded()
    return kitchen
  }

  async expectMenuListed(name: string): Promise<void> {
    await expect(this.menuOption(name)).toBeVisible()
  }

  async expectNoRecentRooms(): Promise<void> {
    await expect(this.recentSection).toHaveCount(0)
  }
}
