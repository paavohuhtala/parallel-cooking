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
  readonly recentRows: Locator
  readonly recentRooms: Locator
  readonly recentError: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: 'Mössömestari' })
    this.nameInput = page.getByRole('textbox', { name: 'Nimi' })
    this.menuOptions = page.getByRole('radio')
    this.createButton = page.getByRole('button', { name: 'Luo keittiö' })
    this.error = page.getByTestId('error')
    this.recentSection = page.getByTestId('landing-card').filter({ hasText: 'Viimeksi avatut' })
    this.recentRows = this.recentSection.getByTestId('recent-row')
    this.recentRooms = this.recentSection.getByTestId('recent-room')
    this.recentError = this.recentSection.getByTestId('recent-error')
  }

  menuOption(name: string): Locator {
    return this.page.getByTestId('menu-row').filter({ hasText: name }).getByRole('radio')
  }

  recentRoom(name: string): Locator {
    return this.recentRooms.filter({ hasText: name })
  }

  recentRow(name: string): Locator {
    return this.recentRows.filter({ hasText: name })
  }

  removeRoomButton(name: string): Locator {
    return this.recentRow(name).getByTestId('recent-room-remove')
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

  /**
   * Waits for the page to have heard how many cooks are in the kitchen — the
   * count arrives from /api/rooms/<id> after the first render, and it is what
   * enables or disables the remove button.
   */
  async expectOnlineCount(name: string, count: number): Promise<void> {
    await expect(this.recentRow(name)).toHaveAttribute('data-online', String(count))
  }

  /** Removes the kitchen for good, past the confirm(). */
  async removeRoom(name: string): Promise<void> {
    await this.expectOnlineCount(name, 0)
    this.page.once('dialog', (dialog) => void dialog.accept())
    await this.removeRoomButton(name).click()
    await expect(this.recentRoom(name)).toHaveCount(0)
  }

  async expectMenuListed(name: string): Promise<void> {
    await expect(this.menuOption(name)).toBeVisible()
  }

  async expectNoRecentRooms(): Promise<void> {
    await expect(this.recentSection).toHaveCount(0)
  }
}
