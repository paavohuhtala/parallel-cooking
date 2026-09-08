import type { StepStatus } from '../model/types'
import type { GraphIndex } from './graph'

/**
 * A maximal run of steps joined by "private" edges — each step in it hands off
 * to exactly one successor, and that successor waits for nothing else. Such a
 * run can never be parallelised, so the graph draws it as one multi-step card
 * instead of a long train of nodes.
 */
export interface Chain {
  /** Id of the first step in the run; also the chain's own id. */
  id: string
  stepIds: string[]
  componentId: string
  /** Chains this one waits for. */
  deps: string[]
}

export interface ChainIndex {
  chains: Chain[]
  byId: Map<string, Chain>
  /** step id -> id of the chain containing it. */
  chainOf: Map<string, string>
}

/**
 * Two steps may share a card when the edge between them is private in both
 * directions and they belong to the same dish — merging across dishes would
 * produce a card with no coherent heading.
 */
function mergeable(index: GraphIndex, fromId: string, toId: string): boolean {
  const to = index.steps.get(toId)
  const from = index.steps.get(fromId)
  if (!to || !from) return false
  return (
    (index.dependents.get(fromId) ?? []).length === 1 &&
    to.deps.length === 1 &&
    to.componentId === from.componentId
  )
}

/**
 * @param merge when false every step gets its own single-step chain, which is
 *   what the graph's "yhdistä ketjut" toggle switches to.
 */
export function buildChains(index: GraphIndex, merge = true): ChainIndex {
  const chainOf = new Map<string, string>()
  const chains: Chain[] = []

  for (const id of index.topoOrder) {
    // Only start a chain at a step nothing can hand off to.
    const step = index.steps.get(id)!
    const soleDep = step.deps.length === 1 ? step.deps[0] : null
    if (merge && soleDep && mergeable(index, soleDep, id)) continue

    const stepIds = [id]
    if (merge) {
      let cursor = id
      for (;;) {
        const next = (index.dependents.get(cursor) ?? [])[0]
        if (!next || !mergeable(index, cursor, next)) break
        stepIds.push(next)
        cursor = next
      }
    }

    for (const s of stepIds) chainOf.set(s, id)
    chains.push({
      id,
      stepIds,
      componentId: step.componentId,
      deps: [], // filled in below, once every step knows its chain
    })
  }

  const byId = new Map(chains.map((c) => [c.id, c]))
  for (const chain of chains) {
    // Interior steps depend only on their predecessor in the same chain, so
    // the whole chain's external dependencies are the first step's.
    const seen = new Set<string>()
    for (const dep of index.steps.get(chain.id)!.deps) {
      const owner = chainOf.get(dep)
      if (owner && owner !== chain.id) seen.add(owner)
    }
    chain.deps = [...seen]
  }

  return { chains, byId, chainOf }
}

/**
 * A card's own status, rolled up from its steps: whatever the cooks still have
 * to do with it as a unit.
 */
export function chainStatus(
  chain: Chain,
  statuses: Map<string, StepStatus>,
): StepStatus {
  const own = chain.stepIds.map((id) => statuses.get(id)!)
  if (own.every((s) => s === 'done')) return 'done'
  if (own.some((s) => s === 'active')) return 'active'
  return own.find((s) => s !== 'done') === 'ready' ? 'ready' : 'blocked'
}
