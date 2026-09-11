import { expect, type Locator, type Page } from '@playwright/test'
import type { StepStatus } from '../../src/model/types.ts'
import { StepControlsModel } from './StepControlsModel.ts'

export type Grouping = 'Ei ryhmittelyä' | 'Kokin mukaan' | 'Pisteen mukaan' | 'Osan mukaan'

/** One step as the board renders it. */
export class StepCardModel extends StepControlsModel {
  readonly title: string
  readonly cookDot: Locator

  constructor(board: Locator, title: string) {
    super(board.getByTestId('card').filter({ hasText: title }))
    this.title = title
    this.cookDot = this.root.getByTestId('cook-dot')
  }

  async select(): Promise<void> {
    await this.root.getByTestId('card-title').click()
  }
}

export class BoardViewModel {
  readonly locator: Locator
  readonly toolbar: Locator

  constructor(page: Page) {
    this.locator = page.getByTestId('board')
    this.toolbar = this.locator.getByTestId('board-toolbar')
  }

  card(title: string): StepCardModel {
    return new StepCardModel(this.locator, title)
  }

  column(status: StepStatus): Locator {
    return this.locator.getByTestId(`column-${status}`)
  }

  async expectVisible(): Promise<void> {
    await expect(this.locator).toBeVisible()
  }

  async groupBy(grouping: Grouping): Promise<void> {
    await this.toolbar.getByRole('button', { name: grouping }).click()
  }

  async expectCardIn(title: string, status: StepStatus): Promise<void> {
    await expect(this.column(status).getByTestId('card').filter({ hasText: title })).toBeVisible()
  }

  /** A lane exists per cook / station / component once grouping is on. */
  lane(label: string): Locator {
    return this.locator.getByTestId('lane').filter({ hasText: label })
  }
}
