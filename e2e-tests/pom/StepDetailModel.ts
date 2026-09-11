import { expect, type Locator, type Page } from '@playwright/test'
import type { StepStatus } from '../../src/model/types.ts'
import { STATUS_LABEL } from '../labels.ts'
import { StepControlsModel } from './StepControlsModel.ts'

/** The side panel for the selected step: what it needs, who has it, what it unlocks. */
export class StepDetailModel extends StepControlsModel {
  private readonly page: Page

  readonly title: Locator
  readonly component: Locator
  readonly status: Locator
  readonly text: Locator
  readonly closeButton: Locator
  readonly dependencies: Locator
  readonly dependents: Locator

  constructor(page: Page) {
    super(page.getByTestId('step-detail'))
    this.page = page
    this.title = this.root.getByTestId('detail-title')
    this.component = this.root.getByTestId('detail-kicker')
    this.status = this.root.getByTestId('detail-status')
    this.text = this.root.getByTestId('detail-text')
    this.closeButton = this.root.getByRole('button', { name: 'Sulje tiedot' })
    this.dependencies = this.section('Edellyttää').getByTestId('detail-link')
    this.dependents = this.section('Avaa seuraavat').getByTestId('detail-link')
  }

  section(heading: string): Locator {
    // The inner locator of `has` is resolved from the matched element, so it is
    // built from the page rather than from `root`.
    return this.root
      .locator('section')
      .filter({ has: this.page.getByRole('heading', { name: heading }) })
  }

  /** The step's cook, changed from the detail panel rather than by starting it. */
  cookPicker(stepTitle: string): Locator {
    return this.root.getByRole('combobox', { name: `Kenelle: ${stepTitle}` })
  }

  async expectOpen(title: string): Promise<void> {
    await expect(this.title).toContainText(title)
  }

  async expectStatus(status: StepStatus): Promise<void> {
    await expect(this.status).toHaveText(STATUS_LABEL[status])
  }

  async assignTo(stepTitle: string, cookName: string): Promise<void> {
    await this.cookPicker(stepTitle).selectOption({ label: cookName })
  }

  async close(): Promise<void> {
    await this.closeButton.click()
    await expect(this.root).toBeHidden()
  }
}
