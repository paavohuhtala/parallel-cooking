import { expect, type Locator, type Page } from '@playwright/test'
import type { StepStatus } from '../../src/model/types.ts'
import { STATUS_LABEL } from '../labels.ts'
import { StepControlsModel } from './StepControlsModel.ts'

/** One step as the recipe view renders it: a row with a status and controls. */
export class StepRowModel extends StepControlsModel {
  readonly title: string
  /** The row itself, which opens the detail panel. */
  readonly main: Locator
  readonly facts: Locator
  readonly cookDot: Locator

  constructor(recipe: Locator, title: string) {
    super(recipe.getByTestId('step-row').filter({ hasText: title }))
    this.title = title
    this.main = this.root.getByTestId('step-main')
    this.facts = this.root.getByTestId('step-facts')
    this.cookDot = this.root.getByTestId('cook-dot')
  }

  async open(): Promise<void> {
    await this.main.click()
  }

  async expectStatus(status: StepStatus): Promise<void> {
    await expect(this.facts).toContainText(STATUS_LABEL[status])
  }

  async expectCook(name: string): Promise<void> {
    await expect(this.cookDot).toHaveAttribute('title', name)
  }

  async expectNoCook(): Promise<void> {
    await expect(this.cookDot).toHaveCount(0)
  }
}

/** One component ("Kantarellikeitto") and its progress counter. */
export class ComponentModel {
  readonly locator: Locator
  readonly steps: Locator
  readonly progress: Locator

  constructor(recipe: Locator, name: string) {
    this.locator = recipe.getByTestId('component').filter({ hasText: name })
    this.steps = this.locator.getByTestId('step-row')
    this.progress = this.locator.getByTestId('component-progress')
  }

  async expectProgress(done: number, total: number): Promise<void> {
    await expect(this.progress).toHaveText(`${done}/${total} valmiina`)
  }

  /** For when the menu's own step count is not what the test is about. */
  async expectDoneCount(done: number): Promise<void> {
    await expect(this.progress).toHaveText(new RegExp(`^${done}/`))
  }
}

export class RecipeViewModel {
  readonly locator: Locator
  readonly courses: Locator
  readonly stepRows: Locator

  constructor(page: Page) {
    this.locator = page.getByTestId('recipe')
    this.courses = this.locator.getByTestId('course')
    this.stepRows = this.locator.getByTestId('step-row')
  }

  step(title: string): StepRowModel {
    return new StepRowModel(this.locator, title)
  }

  component(name: string): ComponentModel {
    return new ComponentModel(this.locator, name)
  }

  course(name: string): Locator {
    return this.courses.filter({ hasText: name })
  }

  async expectVisible(): Promise<void> {
    await expect(this.locator).toBeVisible()
  }
}
