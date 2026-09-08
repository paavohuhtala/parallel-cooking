export const NODE_W = 220
const H_GAP = 60
const V_GAP = 20
const PAD = 28

/** Input to the layout: an id, what it waits for, and how tall it draws. */
export interface LayoutInput {
  id: string
  deps: string[]
  height: number
}

export interface LaidOutNode {
  id: string
  layer: number
  x: number
  y: number
  height: number
}

export interface LaidOutEdge {
  from: string
  to: string
  path: string
}

export interface Layout {
  nodes: LaidOutNode[]
  edges: LaidOutEdge[]
  positions: Map<string, LaidOutNode>
  width: number
  height: number
}

/**
 * Layered left-to-right layout: layer = longest dependency chain to the node,
 * then a few barycenter sweeps to pull connected nodes onto similar rows and
 * keep the edge crossings down. Deterministic, so the picture doesn't jump
 * around between renders.
 */
export function layoutGraph(input: LayoutInput[], groupOf?: Map<string, number>): Layout {
  const byId = new Map(input.map((n) => [n.id, n]))
  const dependents = new Map<string, string[]>(input.map((n) => [n.id, []]))
  for (const node of input) {
    for (const dep of node.deps) dependents.get(dep)?.push(node.id)
  }

  const indegree = new Map(
    input.map((n) => [n.id, n.deps.filter((d) => byId.has(d)).length]),
  )
  const queue = input.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
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

  const layer = new Map<string, number>()
  for (const id of topoOrder) {
    const depth = byId
      .get(id)!
      .deps.reduce((max, d) => Math.max(max, (layer.get(d) ?? -1) + 1), 0)
    layer.set(id, depth)
  }

  const maxLayer = Math.max(0, ...layer.values())
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const id of topoOrder) layers[layer.get(id)!].push(id)

  // Seed each layer grouped by dish so related work starts out adjacent.
  for (const column of layers) {
    column.sort(
      (a, b) => (groupOf?.get(a) ?? 0) - (groupOf?.get(b) ?? 0) || a.localeCompare(b),
    )
  }

  const rowOf = new Map<string, number>()
  const reindex = () => {
    for (const column of layers) column.forEach((id, i) => rowOf.set(id, i))
  }
  reindex()

  const barycenter = (id: string, neighbours: string[]) => {
    if (!neighbours.length) return rowOf.get(id)!
    return neighbours.reduce((acc, n) => acc + (rowOf.get(n) ?? 0), 0) / neighbours.length
  }

  for (let pass = 0; pass < 6; pass++) {
    const downward = pass % 2 === 0
    const columns = downward ? layers : [...layers].reverse()
    for (const column of columns) {
      const key = new Map(
        column.map((id) => [
          id,
          barycenter(id, downward ? byId.get(id)!.deps : (dependents.get(id) ?? [])),
        ]),
      )
      column.sort((a, b) => key.get(a)! - key.get(b)! || rowOf.get(a)! - rowOf.get(b)!)
    }
    reindex()
  }

  // Columns hold cards of different heights, so stack each one and centre the
  // short columns against the tallest.
  const columnHeight = (column: string[]) =>
    column.reduce((sum, id) => sum + byId.get(id)!.height, 0) +
    Math.max(0, column.length - 1) * V_GAP
  const tallest = Math.max(0, ...layers.map(columnHeight))

  const nodes: LaidOutNode[] = []
  for (const [layerIndex, column] of layers.entries()) {
    let y = PAD + (tallest - columnHeight(column)) / 2
    for (const id of column) {
      const height = byId.get(id)!.height
      nodes.push({ id, layer: layerIndex, x: PAD + layerIndex * (NODE_W + H_GAP), y, height })
      y += height + V_GAP
    }
  }

  const positions = new Map(nodes.map((n) => [n.id, n]))
  const edges: LaidOutEdge[] = []
  for (const node of input) {
    const to = positions.get(node.id)
    if (!to) continue
    for (const depId of node.deps) {
      const from = positions.get(depId)
      if (!from) continue
      const x1 = from.x + NODE_W
      const y1 = from.y + from.height / 2
      const x2 = to.x
      const y2 = to.y + to.height / 2
      const bend = Math.max(28, (x2 - x1) / 2)
      edges.push({
        from: depId,
        to: node.id,
        path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
      })
    }
  }

  return {
    nodes,
    edges,
    positions,
    width: PAD * 2 + (maxLayer + 1) * NODE_W + maxLayer * H_GAP,
    height: PAD * 2 + tallest,
  }
}
