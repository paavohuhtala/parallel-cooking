import { expect, type Locator } from '@playwright/test'

/**
 * The buttons a step carries, wherever it is rendered: a recipe row, a board
 * card, or the detail panel. Those three models extend this, so a control is
 * described once.
 *
 * Note the constructor-body assignment. `useDefineForClassFields` is on, so a
 * field initialiser that reads `this.root` would run before the constructor
 * could set it — locators have to be built here, not in a field.
 */
export class StepControlsModel {
  readonly root: Locator
  readonly startButton: Locator
  readonly doneButton: Locator
  /** "Palauta": an active step back to todo. */
  readonly revertButton: Locator
  /** "Avaa uudelleen": a finished step back to active. */
  readonly reopenButton: Locator
  /** "Kumoa": a finished step back to todo. */
  readonly undoButton: Locator

  constructor(root: Locator) {
    this.root = root
    this.startButton = root.getByRole('button', { name: 'Aloita' })
    this.doneButton = root.getByRole('button', { name: 'Valmis' })
    this.revertButton = root.getByRole('button', { name: 'Palauta' })
    this.reopenButton = root.getByRole('button', { name: 'Avaa uudelleen' })
    this.undoButton = root.getByRole('button', { name: 'Kumoa' })
  }

  /**
   * Starting an unassigned step opens "Kuka ottaa tämän?" unless the browser
   * already knows which cook it is, so this only clicks — see
   * `KitchenPageModel.startAs` for the whole move.
   */
  async start(): Promise<void> {
    await this.startButton.click()
  }

  async finish(): Promise<void> {
    await this.doneButton.click()
  }

  async revert(): Promise<void> {
    await this.revertButton.click()
  }

  async reopen(): Promise<void> {
    await this.reopenButton.click()
  }

  async undo(): Promise<void> {
    await this.undoButton.click()
  }

  /** An illegal move is shown disabled and explained in the title attribute. */
  async expectStartBlocked(reason: string | RegExp): Promise<void> {
    await expect(this.startButton).toBeDisabled()
    await expect(this.startButton).toHaveAttribute('title', reason)
  }

  async expectUndoBlocked(reason: string | RegExp): Promise<void> {
    await expect(this.undoButton).toBeDisabled()
    await expect(this.undoButton).toHaveAttribute('title', reason)
  }
}
