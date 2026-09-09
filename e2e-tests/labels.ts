import type { StepStatus } from '../src/model/types.ts'

/**
 * The UI is in Finnish, so the page objects match on Finnish text. This mirrors
 * `STATUS_LABEL` in src/components/StepControls.tsx; it is duplicated rather
 * than imported because that module is React, and the e2e project has no
 * business loading the client's components. `StepStatus` is imported, so
 * adding a status breaks this build too.
 */
export const STATUS_LABEL: Record<StepStatus, string> = {
  blocked: 'Odottaa',
  ready: 'Voi aloittaa',
  active: 'Työn alla',
  done: 'Valmis',
}

export const CONNECTION_LABEL = {
  connecting: 'Yhdistetään…',
  online: 'Verkossa',
  offline: 'Ei yhteyttä',
} as const
