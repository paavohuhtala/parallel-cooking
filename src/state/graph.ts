import type {
  KitchenState,
  Menu,
  Step,
  StepRecord,
  StepState,
  StepStatus,
} from '../model/types.ts'

export const EMPTY_RECORD: StepRecord = { state: 'todo', cookId: null }

export interface GraphIndex {
  steps: Map<string, Step>
  /** Reverse edges: step id -> ids of steps that depend on it. */
  dependents: Map<string, string[]>
  /** Dependency order; every step appears after all of its deps. */
  topoOrder: string[]
  /**
   * Length, in steps, of the longest chain from this step to the end of the
   * menu. Nothing to do with clock time — it is how many rounds of strictly
   * sequential work still hang off this step.
   */
  chainLength: Map<string, number>
  /**
   * One longest chain through the graph, used to draw the spine of the menu in
   * the graph view. Not a CPM critical path: with no durations on `Step` this
   * counts steps rather than minutes, and ties between equally long chains are
   * broken arbitrarily — so it is never used to label an individual step.
   */
  criticalPath: Set<string>
  problems: string[]
}

export function buildIndex(menu: Menu): GraphIndex {
  const steps = new Map(menu.steps.map((s) => [s.id, s]))
  const dependents = new Map<string, string[]>(menu.steps.map((s) => [s.id, []]))
  const problems: string[] = []

  // Two steps sharing an id would silently collapse into one above, taking the
  // last one's deps with them — so say so rather than quietly losing a step.
  if (steps.size !== menu.steps.length) {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const step of menu.steps) {
      if (seen.has(step.id)) duplicates.add(step.id)
      seen.add(step.id)
    }
    problems.push(`Sama vaihetunnus esiintyy useasti: ${[...duplicates].join(', ')}.`)
  }

  for (const step of menu.steps) {
    for (const dep of step.deps) {
      const list = dependents.get(dep)
      if (!list) {
        problems.push(`Vaihe "${step.id}" riippuu tuntemattomasta vaiheesta "${dep}".`)
        continue
      }
      list.push(step.id)
    }
  }

  // Kahn's algorithm; anything left over sits on a cycle.
  const indegree = new Map(
    menu.steps.map((s) => [s.id, s.deps.filter((d) => steps.has(d)).length]),
  )
  const queue = menu.steps.filter((s) => indegree.get(s.id) === 0).map((s) => s.id)
  const topoOrder: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    topoOrder.push(id)
    for (const next of dependents.get(id) ?? []) {
      const left = indegree.get(next)! - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  if (topoOrder.length !== menu.steps.length) {
    const stuck = menu.steps.filter((s) => !topoOrder.includes(s.id)).map((s) => s.id)
    problems.push(`Riippuvuuksissa on kehä: ${stuck.join(', ')}.`)
  }

  // Walk the topo order backwards so every dependent's chain is already known.
  const chainLength = new Map<string, number>()
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i]
    const downstream = (dependents.get(id) ?? []).map((d) => chainLength.get(d) ?? 0)
    chainLength.set(id, 1 + Math.max(0, ...downstream))
  }

  const criticalPath = new Set<string>()
  const longest = (ids: string[]) =>
    ids.reduce<string | undefined>(
      (best, id) =>
        best === undefined || chainLength.get(id)! > chainLength.get(best)! ? id : best,
      undefined,
    )
  let cursor = longest(topoOrder.filter((id) => steps.get(id)!.deps.length === 0))
  while (cursor) {
    criticalPath.add(cursor)
    cursor = longest(dependents.get(cursor) ?? [])
  }

  return { steps, dependents, topoOrder, chainLength, criticalPath, problems }
}

/**
 * Every step reachable by following dependents from `id`, excluding `id`. What a
 * dependency picker must refuse to offer: adding any of these as a dependency of
 * `id` would close a cycle.
 */
export function reachableFrom(index: GraphIndex, id: string): Set<string> {
  const seen = new Set<string>()
  const queue = [...(index.dependents.get(id) ?? [])]
  while (queue.length) {
    const next = queue.shift()!
    if (seen.has(next)) continue
    seen.add(next)
    queue.push(...(index.dependents.get(next) ?? []))
  }
  return seen
}

export const recordOf = (state: KitchenState, id: string): StepRecord =>
  state.steps[id] ?? EMPTY_RECORD

export function statusOf(step: Step, state: KitchenState): StepStatus {
  const stored = recordOf(state, step.id).state
  if (stored === 'done') return 'done'
  if (stored === 'active') return 'active'
  return step.deps.every((d) => recordOf(state, d).state === 'done') ? 'ready' : 'blocked'
}

export function statusMap(menu: Menu, state: KitchenState): Map<string, StepStatus> {
  return new Map(menu.steps.map((s) => [s.id, statusOf(s, state)]))
}

export interface TransitionCheck {
  allowed: boolean
  reason?: string
}

/**
 * A transition is rejected when it would leave the board describing something
 * that cannot physically be true — chiefly, work in progress or finished on
 * top of a prerequisite that is no longer done.
 */
export function checkTransition(
  index: GraphIndex,
  state: KitchenState,
  stepId: string,
  next: StepState,
): TransitionCheck {
  const step = index.steps.get(stepId)
  if (!step) return { allowed: false, reason: 'Tuntematon vaihe.' }
  const current = recordOf(state, stepId).state
  if (current === next) return { allowed: true }

  if (next === 'active' || next === 'done') {
    const missing = step.deps.filter((d) => recordOf(state, d).state !== 'done')
    if (missing.length) {
      const names = missing.map((d) => index.steps.get(d)?.title ?? d)
      return { allowed: false, reason: `Odottaa: ${names.join(', ')}.` }
    }
  }

  // Stepping back out of `done` is only safe while nothing downstream has
  // started leaning on it.
  if (current === 'done' && next !== 'done') {
    const committed = (index.dependents.get(stepId) ?? []).filter(
      (d) => recordOf(state, d).state !== 'todo',
    )
    if (committed.length) {
      const names = committed.map((d) => index.steps.get(d)?.title ?? d)
      return { allowed: false, reason: `Kumoa ensin: ${names.join(', ')}.` }
    }
  }

  return { allowed: true }
}

export interface Progress {
  total: number
  done: number
  active: number
  ready: number
  blocked: number
  /** Steps on the longest chain of work still ahead. */
  criticalChainLeft: number
}

export function progressOf(menu: Menu, index: GraphIndex, state: KitchenState): Progress {
  const statuses = statusMap(menu, state)
  const p: Progress = {
    total: menu.steps.length,
    done: 0,
    active: 0,
    ready: 0,
    blocked: 0,
    criticalChainLeft: 0,
  }
  for (const step of menu.steps) {
    const status = statuses.get(step.id)!
    p[status]++
    if (status !== 'done') {
      p.criticalChainLeft = Math.max(p.criticalChainLeft, index.chainLength.get(step.id) ?? 0)
    }
  }
  return p
}

/**
 * Ready work, most urgent first: whatever has the longest chain of work still
 * hanging off it should be picked up before work that has slack.
 */
export function suggestedNext(menu: Menu, index: GraphIndex, state: KitchenState): Step[] {
  const statuses = statusMap(menu, state)
  return menu.steps
    .filter((s) => statuses.get(s.id) === 'ready')
    .sort((a, b) => (index.chainLength.get(b.id) ?? 0) - (index.chainLength.get(a.id) ?? 0))
}
