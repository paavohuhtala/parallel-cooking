/**
 * Where the work physically happens. Only the contended equipment is worth
 * naming — everything else is just "muu" (bench work, cold prep, plating).
 */
export type Station = 'liesi' | 'uuni' | 'grilli' | 'muu'

export const STATIONS: { id: Station; label: string; icon: string }[] = [
  { id: 'liesi', label: 'Liesi', icon: '🍳' },
  { id: 'uuni', label: 'Uuni', icon: '♨️' },
  { id: 'grilli', label: 'Grilli', icon: '🔥' },
  { id: 'muu', label: 'Muu', icon: '🔪' },
]

export interface Step {
  id: string
  componentId: string
  title: string
  /** Full instruction text, shown when the step is opened. */
  detail?: string
  station: Station
  /** Steps that must be `done` before this one may start. */
  deps: string[]
  /** Ingredients consumed by this step, for a per-step mise en place. */
  uses?: string[]
  /**
   * The step can be finished well ahead of service; everything downstream of a
   * `holdPoint` is last-minute work.
   */
  holdPoint?: boolean
}

export interface Component {
  id: string
  courseId: string
  name: string
  ingredients: string[]
  note?: string
}

export interface Course {
  id: string
  /** 1-based position in the menu. */
  order: number
  name: string
  note?: string
}

export interface Menu {
  name: string
  courses: Course[]
  components: Component[]
  steps: Step[]
}

/** What the user has explicitly recorded about a step. */
export type StepState = 'todo' | 'active' | 'done'

/** `StepState` plus the readiness implied by the dependency graph. */
export type StepStatus = 'blocked' | 'ready' | 'active' | 'done'

export interface Cook {
  id: string
  name: string
  color: string
}

export interface StepRecord {
  state: StepState
  /** Cook id, or null when nobody has claimed it. */
  cookId: string | null
  startedAt?: number
  completedAt?: number
}

export interface KitchenState {
  cooks: Cook[]
  /** Sparse: steps with no record are `todo` and unassigned. */
  steps: Record<string, StepRecord>
}
