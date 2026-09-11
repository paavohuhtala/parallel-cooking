import type { KitchenState, Menu, Station, Step } from '../model/types.ts'
import { recordOf, statusOf, type GraphIndex } from './graph.ts'

/*
 * What one cook, on one phone, needs to know: what I have going, what I should
 * take next and why, and who I am waiting on.
 *
 * Pure, DOM-free and React-free — the whole point is that "what should Anna do
 * next" is a unit test rather than a dinner. Everything here is derived from
 * `(menu, index, state, cookId)`, all four of which every client already has,
 * so none of it goes near the protocol.
 */

/**
 * Why a step is being suggested. Structured rather than a Finnish string: the
 * view owns the wording, this module owns the reasoning, and the test can
 * assert the reason without asserting a translation.
 */
export type ShiftReason =
  /** Same dish as something you have going, or just finished. */
  | { kind: 'continues'; componentId: string }
  /** Somebody put your name on it. */
  | { kind: 'assigned' }
  /** You are already standing at that station. */
  | { kind: 'station'; station: Station }
  /** Nothing personal — it just has the most work hanging off it. */
  | { kind: 'chain'; opens: number }
  /** Nothing personal, and it can wait. */
  | { kind: 'hold' }

export interface ShiftPick {
  step: Step
  score: number
  reason: ShiftReason
  /**
   * False for work already in another cook's name. Still returned, so the list
   * can show it greyed with their dot — it is not offered, but hiding it would
   * make the kitchen look emptier than it is.
   */
  offered: boolean
}

/**
 * The weights, exported so the test names them instead of restating the
 * numbers. Continuity is dominant on purpose: staying in one dish is one
 * board, one set of ingredients out, one head-space, and jumping between
 * dishes is how things get missed.
 */
export const WEIGHT = {
  /** Per step of `chainLength`: the existing measure of how urgent work is. */
  chain: 4,
  continues: 100,
  assigned: 25,
  station: 20,
  /** `holdPoint` says in the type that this can be done well ahead. */
  hold: -15,
} as const

/*
 * `index.criticalPath` is deliberately not a signal here. `buildIndex` says of
 * it that ties between equally long chains are broken arbitrarily, "so it is
 * never used to label an individual step" — and ranking by it is labelling by
 * it, one step removed. The first time two cooks compared phones and saw a
 * different "critical" step, this would have lied to one of them.
 * `chainLength` carries the same information with none of the arbitrariness.
 */

/** Steps this cook has going right now, in dependency order. */
export function activeFor(
  menu: Menu,
  index: GraphIndex,
  state: KitchenState,
  cookId: string | null,
): Step[] {
  const order = topoRank(index)
  return menu.steps
    .filter((s) => {
      const record = recordOf(state, s.id)
      return record.state === 'active' && record.cookId === cookId && cookId !== null
    })
    .sort((a, b) => order(a.id) - order(b.id))
}

/**
 * Where this cook's attention already is: the dishes and stations that should
 * pull the next suggestion towards them.
 *
 * While something is on, that is the answer. With nothing on, the dish you
 * finished last still counts — you are between steps of it, not done with it —
 * but the station does not, because you are no longer standing there.
 */
function focusOf(
  menu: Menu,
  index: GraphIndex,
  state: KitchenState,
  cookId: string | null,
): { components: Set<string>; stations: Set<Station> } {
  const active = activeFor(menu, index, state, cookId)
  if (active.length) {
    return {
      components: new Set(active.map((s) => s.componentId)),
      stations: new Set(active.map((s) => s.station)),
    }
  }

  let last: Step | null = null
  let lastAt = -Infinity
  for (const step of menu.steps) {
    const record = recordOf(state, step.id)
    if (record.state !== 'done' || record.cookId !== cookId || cookId === null) continue
    const at = record.completedAt ?? -Infinity
    if (at > lastAt) {
      last = step
      lastAt = at
    }
  }
  return { components: new Set(last ? [last.componentId] : []), stations: new Set() }
}

/**
 * Ready work, ordered for one cook. Offered work first, best first; then
 * whatever is already in somebody else's name.
 *
 * Ties break on dependency order, so the ordering is total and a test can
 * assert a sequence rather than a set.
 */
export function rankReady(
  menu: Menu,
  index: GraphIndex,
  state: KitchenState,
  cookId: string | null,
): ShiftPick[] {
  const focus = focusOf(menu, index, state, cookId)
  const order = topoRank(index)

  const picks = menu.steps
    .filter((s) => statusOf(s, state) === 'ready')
    .map((step): ShiftPick => {
      const assignee = recordOf(state, step.id).cookId
      const mine = cookId !== null && assignee === cookId
      const chain = index.chainLength.get(step.id) ?? 1

      const continues = focus.components.has(step.componentId)
      const sameStation = focus.stations.has(step.station)

      let score = WEIGHT.chain * chain
      if (continues) score += WEIGHT.continues
      if (mine) score += WEIGHT.assigned
      if (sameStation) score += WEIGHT.station
      if (step.holdPoint) score += WEIGHT.hold

      // The reason is whichever bonus decided it, strongest first. A ranking a
      // cook cannot interrogate is a ranking a cook will not trust, and the
      // moment they distrust it they are back to reading fifteen rows.
      const reason: ShiftReason = continues
        ? { kind: 'continues', componentId: step.componentId }
        : mine
          ? { kind: 'assigned' }
          : sameStation
            ? { kind: 'station', station: step.station }
            : step.holdPoint
              ? { kind: 'hold' }
              : { kind: 'chain', opens: chain - 1 }

      return { step, score, reason, offered: assignee === null || mine }
    })

  return picks.sort((a, b) => {
    if (a.offered !== b.offered) return a.offered ? -1 : 1
    if (!a.offered) return order(a.step.id) - order(b.step.id)
    return b.score - a.score || order(a.step.id) - order(b.step.id)
  })
}

export interface Waiting {
  step: Step
  /** The steps in the way — all of them active, or this would not be listed. */
  blockers: Step[]
}

/**
 * Blocked work that is one step from being yours: every unmet dependency is
 * already under way. This is the list that makes a phone worth holding — the
 * person you need to nudge is standing two metres away, and you are the only
 * one who knows you are stuck behind them.
 */
export function oneStepAway(menu: Menu, index: GraphIndex, state: KitchenState): Waiting[] {
  const order = topoRank(index)
  const waiting: Waiting[] = []

  for (const step of menu.steps) {
    if (statusOf(step, state) !== 'blocked') continue
    const unmet = step.deps.filter((d) => recordOf(state, d).state !== 'done')
    if (!unmet.length || !unmet.every((d) => recordOf(state, d).state === 'active')) continue
    waiting.push({
      step,
      blockers: unmet.map((d) => index.steps.get(d)!).sort((a, b) => order(a.id) - order(b.id)),
    })
  }

  return waiting.sort((a, b) => order(a.step.id) - order(b.step.id))
}

/**
 * What finishing `stepId` opened up: its dependents that are ready now. Offered
 * straight back in the gesture that finished the last one, which is what turns
 * three lists into a flow.
 */
export function justUnblocked(index: GraphIndex, state: KitchenState, stepId: string): Step[] {
  const order = topoRank(index)
  return (index.dependents.get(stepId) ?? [])
    .map((id) => index.steps.get(id)!)
    .filter((step) => step && statusOf(step, state) === 'ready')
    .sort((a, b) => order(a.id) - order(b.id))
}

/** Position in dependency order; the tie-break that makes every sort total. */
function topoRank(index: GraphIndex): (id: string) => number {
  const order = new Map(index.topoOrder.map((id, i) => [id, i]))
  return (id) => order.get(id) ?? Number.MAX_SAFE_INTEGER
}
