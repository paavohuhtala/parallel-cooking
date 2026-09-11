import { expect, type Locator, type Page } from '@playwright/test'
import { CONNECTION_LABEL } from '../labels.ts'
import { BoardViewModel } from './BoardViewModel.ts'
import { CooksModalModel } from './CooksModalModel.ts'
import { RecipeViewModel } from './RecipeViewModel.ts'
import { ShiftViewModel } from './ShiftViewModel.ts'
import { StartDialogModel } from './StartDialogModel.ts'
import { StepDetailModel } from './StepDetailModel.ts'

/**
 * One kitchen at /r/<id>: the chrome around the three views, plus the views
 * themselves. One of these per browser page, so a test with two cooks holds
 * two of them.
 */
export class KitchenPageModel {
  readonly page: Page

  readonly recipe: RecipeViewModel
  readonly board: BoardViewModel
  readonly shift: ShiftViewModel
  readonly detail: StepDetailModel
  readonly cooks: CooksModalModel
  readonly startDialog: StartDialogModel

  readonly topbar: Locator
  readonly title: Locator
  readonly progress: Locator
  readonly connection: Locator
  readonly cooksButton: Locator
  readonly shareButton: Locator
  readonly newKitchenButton: Locator
  readonly recipeTab: Locator
  readonly graphTab: Locator
  readonly boardTab: Locator
  readonly shiftTab: Locator
  readonly graph: Locator
  readonly upNext: Locator
  readonly rejection: Locator
  readonly notFoundHeading: Locator

  constructor(page: Page) {
    this.page = page
    this.recipe = new RecipeViewModel(page)
    this.board = new BoardViewModel(page)
    this.shift = new ShiftViewModel(page)
    this.detail = new StepDetailModel(page)
    this.cooks = new CooksModalModel(page)
    this.startDialog = new StartDialogModel(page)

    this.topbar = page.locator('.topbar')
    this.title = this.topbar.getByRole('heading', { level: 1 })
    this.progress = this.topbar.locator('.brand p')
    this.connection = this.topbar.locator('.conn')
    this.cooksButton = this.topbar.getByRole('button', { name: 'Kokit' })
    this.shareButton = this.topbar.getByRole('button', { name: 'Jaa' })
    this.newKitchenButton = this.topbar.getByRole('button', { name: 'Uusi keittiö' })
    this.recipeTab = this.topbar.getByRole('tab', { name: 'Resepti' })
    this.graphTab = this.topbar.getByRole('tab', { name: 'Graafi' })
    this.boardTab = this.topbar.getByRole('tab', { name: 'Keittiötaulu' })
    this.shiftTab = this.topbar.getByRole('tab', { name: 'Oma vuoro' })
    this.graph = page.locator('.graph')
    this.upNext = page.locator('.upnext-items .chip')
    this.rejection = page.locator('.banner-warn')
    this.notFoundHeading = page.getByRole('heading', { name: 'Keittiötä ei löytynyt' })
  }

  async goto(roomId: string): Promise<void> {
    await this.gotoUnchecked(roomId)
    await this.expectLoaded()
  }

  /** For links that are expected to be dead. */
  async gotoUnchecked(roomId: string): Promise<void> {
    await this.page.goto(`/r/${roomId}`)
  }

  /** The room rendered and its socket is up, so a command will not be queued. */
  async expectLoaded(): Promise<void> {
    await expect(this.title).toBeVisible()
    await this.expectOnline()
  }

  async expectOnline(): Promise<void> {
    await expect(this.connection).toHaveText(CONNECTION_LABEL.online)
  }

  async expectNotFound(): Promise<void> {
    await expect(this.notFoundHeading).toBeVisible()
  }

  async expectTitle(name: string): Promise<void> {
    await expect(this.title).toHaveText(name)
  }

  async expectProgress(done: number, total: number): Promise<void> {
    await expect(this.progress).toContainText(`${done}/${total} vaihetta valmiina`)
  }

  async showRecipe(): Promise<void> {
    await this.recipeTab.click()
    await this.recipe.expectVisible()
  }

  async showBoard(): Promise<void> {
    await this.boardTab.click()
    await this.board.expectVisible()
  }

  /**
   * "Oma vuoro". On a phone this is already the view a room opens on, so the
   * tab click is a no-op there rather than a navigation.
   */
  async showShift(): Promise<ShiftViewModel> {
    await this.shiftTab.click()
    return this.shift
  }

  async showGraph(): Promise<void> {
    await this.graphTab.click()
    await expect(this.graph).toBeVisible()
  }

  async openCooks(): Promise<CooksModalModel> {
    await this.cooksButton.click()
    await this.cooks.expectOpen()
    return this.cooks
  }

  /** Opens the detail panel from a card in "Oma vuoro". */
  async openStepFromShift(title: string): Promise<StepDetailModel> {
    await this.shift.card(title).root.getByRole('button', { name: 'Näytä kaikki tiedot' }).click()
    await this.detail.expectOpen(title)
    return this.detail
  }

  /** Opens the detail panel by clicking the step in the recipe view. */
  async openStep(title: string): Promise<StepDetailModel> {
    await this.recipe.step(title).open()
    await this.detail.expectOpen(title)
    return this.detail
  }

  /**
   * Start a step from the recipe view and say who is taking it. Assumes the
   * step is unassigned and this browser has not claimed a cook — that is what
   * makes "Kuka ottaa tämän?" appear.
   */
  async startStepAs(title: string, cookName: string): Promise<void> {
    const step = this.recipe.step(title)
    await step.start()
    await this.startDialog.expectOpen(title)
    await this.startDialog.chooseCook(cookName)
    await step.expectStatus('active')
    await step.expectCook(cookName)
  }

  async finishStep(title: string): Promise<void> {
    const step = this.recipe.step(title)
    await step.finish()
    await step.expectStatus('done')
  }

  /** Make sure this browser is a given cook, adding nobody and asking nobody. */
  async ensureIAm(cookName: string): Promise<void> {
    const cooks = await this.openCooks()
    await cooks.claimAsMe(cookName)
    await cooks.close()
  }

  upNextChip(title: string): Locator {
    return this.upNext.filter({ hasText: title })
  }

  async expectRejection(reason: string | RegExp): Promise<void> {
    await expect(this.rejection).toContainText(reason)
  }

  /** "Uusi keittiö": a fresh room from the same menu, behind a confirm(). */
  async startFreshKitchen(): Promise<string> {
    // This navigates from one room to another, so the wait has to be for a
    // *different* URL — the shape of a room URL already matches.
    const from = this.page.url()
    this.page.once('dialog', (dialog) => void dialog.accept())
    await this.newKitchenButton.click()
    await this.page.waitForURL((url) => url.href !== from)
    await this.expectLoaded()
    return this.roomId()
  }

  roomId(): string {
    const id = new URL(this.page.url()).pathname.split('/').pop()
    if (!id) throw new Error(`Not on a kitchen page: ${this.page.url()}`)
    return id
  }
}
