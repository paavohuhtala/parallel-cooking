import type { Menu } from '../model/types.ts'
import type { OutlineItem } from './menuDraft.ts'

/*
 * The menu editor's dependency gutter: what to draw beside each outline row.
 *
 * Auto-chaining makes "waits for the step above it" the default, so that is the
 * one dependency drawn plainly — a straight trunk joining two adjacent nodes,
 * which is most of any recipe and should read as nothing much. Every other
 * dependency is an exception somebody chose, and gets a lane beside the trunk:
 * a step that waits for something further up the dish, or for nothing at all
 * (a break in the trunk), a dish waiting on another dish, a course on another
 * course.
 *
 * A line wears the colour of the dish it comes from, so one that crosses dishes
 * shows up in a colour foreign to where it lands. A line that runs against the
 * reading order — a step waiting for something listed *below* it, such as the
 * plates laid in "Tarjoilu" at the end of a course — is marked `up`.
 *
 * Rows are sliced rather than measured: each row gets the pieces of every line
 * crossing it, and draws them within its own box. So a title that wraps, or an
 * outline that reflows, needs nothing recomputed — the slices stretch with it.
 */

/** Which side of a node a lane attaches on: towards the part of it above or below. */
export type Side = 'above' | 'below'

export interface GutterLane {
  /** Row of the dependency the lane carries, the one end every branch shares. */
  source: number
  /** Rows waiting for `source`. */
  targets: number[]
  /** Colour slot of the source's dish; null when a collapsed row mixes dishes. */
  color: number | null
  /** Runs against the reading order: every target sits above its source. */
  up: boolean
  /** Distance from the trunk, from 1. */
  column: number
}

export interface LaneCell {
  /** Index into `Gutter.lanes`. */
  lane: number
  column: number
  color: number | null
  up: boolean
  /** The lane continues past this row's top edge / bottom edge. */
  above: boolean
  below: boolean
  /** This row's node attaches to the lane, on that side of the node. */
  branch: Side | null
}

export interface GutterRow {
  /**
   * A step, or a collapsed row standing in for the steps it hides — lines to
   * any of them end there rather than at nothing. Null on headings and tails.
   */
  node: { group: boolean; color: number | null } | null
  /** Joined to the adjacent row by the trunk: the default chain. */
  trunkIn: boolean
  trunkOut: boolean
  /**
   * An expanded dish heading carries its colour, so a line's colour has a name.
   * Not a node: nothing attaches to it while its steps are on show.
   */
  marker: number | null
  /** Sorted by column. */
  cells: LaneCell[]
}

export interface Gutter {
  rows: GutterRow[]
  lanes: GutterLane[]
  /** Columns, trunk included: the gutter is this many lanes wide. */
  columns: number
}

/** One gutter row per outline item, in the same order. */
export function outlineGutter(menu: Menu, items: readonly OutlineItem[]): Gutter {
  // Colour slots run through the dishes in the order the outline shows them, so
  // neighbouring dishes never share one.
  const courseOrder = new Map(
    [...menu.courses].sort((a, b) => a.order - b.order).map((c, i) => [c.id, i]),
  )
  const dishColor = new Map(
    [...menu.components]
      .sort((a, b) => (courseOrder.get(a.courseId) ?? 0) - (courseOrder.get(b.courseId) ?? 0))
      .map((c, i) => [c.id, i]),
  )
  const stepById = new Map(menu.steps.map((s) => [s.id, s]))
  const colorOf = (stepId: string) => dishColor.get(stepById.get(stepId)?.componentId ?? '') ?? null

  const stepsOf = (item: OutlineItem): string[] => {
    if (item.type === 'tail') return []
    const { kind, id } = item.row
    if (kind === 'step') return [id]
    if (!item.collapsed) return []
    const dishes =
      kind === 'component'
        ? new Set([id])
        : new Set(menu.components.filter((c) => c.courseId === id).map((c) => c.id))
    return menu.steps.filter((s) => dishes.has(s.componentId)).map((s) => s.id)
  }

  const rowOf = new Map<string, number>()
  const rows: GutterRow[] = items.map((item, i) => {
    const steps = stepsOf(item)
    steps.forEach((id) => rowOf.set(id, i))
    const colors = new Set(steps.map(colorOf))
    const expandedDish = item.type === 'row' && item.row.kind === 'component' && !item.collapsed
    return {
      node:
        steps.length === 0
          ? null
          : { group: item.type === 'row' && item.row.kind !== 'step', color: colors.size === 1 ? [...colors][0] : null },
      trunkIn: false,
      trunkOut: false,
      marker: expandedDish ? (dishColor.get(item.row.id) ?? null) : null,
      cells: [],
    }
  })

  /** A step row, of one dish, directly under another of the same dish. */
  const adjacentInDish = (from: number, to: number): boolean => {
    const [a, b] = [items[from], items[to]]
    return (
      to === from + 1 &&
      a.type === 'row' &&
      b.type === 'row' &&
      a.row.kind === 'step' &&
      b.row.kind === 'step' &&
      stepById.get(a.row.id)?.componentId === stepById.get(b.row.id)?.componentId
    )
  }

  // One lane per dependency and direction, however many steps wait for it: a
  // step used twice further down is one line with two branches, not two lines.
  const byKey = new Map<string, GutterLane>()
  for (const step of menu.steps) {
    const to = rowOf.get(step.id)
    if (to === undefined) continue
    for (const depId of step.deps) {
      const from = rowOf.get(depId)
      // Unknown, or both ends inside one collapsed row: nothing to draw.
      if (from === undefined || from === to) continue
      if (adjacentInDish(from, to)) {
        rows[from].trunkOut = true
        rows[to].trunkIn = true
        continue
      }
      const color = colorOf(depId)
      const up = from > to
      const key: string = `${from}:${up}:${color}`
      const lane: GutterLane = byKey.get(key) ?? { source: from, targets: [], color, up, column: 0 }
      byKey.set(key, lane)
      if (!lane.targets.includes(to)) lane.targets.push(to)
    }
  }

  const span = (lane: GutterLane) => {
    const ends = [lane.source, ...lane.targets]
    return { top: Math.min(...ends), bottom: Math.max(...ends) }
  }

  // Short lanes nearest the trunk, so a long one is not crossed by every short
  // one's branches on its way in. First fit: a lane takes the innermost column
  // free for its whole span. Ends count as occupied — two lanes meeting at one
  // node in the same column would read as one line passing through it.
  const lanes = [...byKey.values()]
  const order = lanes
    .map((lane, index) => ({ lane, index, ...span(lane) }))
    .sort(
      (a, b) =>
        a.bottom - a.top - (b.bottom - b.top) || a.top - b.top || a.lane.source - b.lane.source,
    )
  const occupied: { top: number; bottom: number }[][] = []
  for (const { lane, top, bottom } of order) {
    let column = 1
    while (occupied[column]?.some((o) => top <= o.bottom && o.top <= bottom)) column++
    ;(occupied[column] ??= []).push({ top, bottom })
    lane.column = column
  }

  lanes.forEach((lane, index) => {
    const { top, bottom } = span(lane)
    for (let row = top; row <= bottom; row++) {
      let branch: Side | null = null
      if (row === lane.source) branch = lane.up ? 'above' : 'below'
      else if (lane.targets.includes(row)) branch = lane.source < row ? 'above' : 'below'
      rows[row].cells.push({
        lane: index,
        column: lane.column,
        color: lane.color,
        up: lane.up,
        above: row > top,
        below: row < bottom,
        branch,
      })
    }
  })
  for (const row of rows) row.cells.sort((a, b) => a.column - b.column)

  return { rows, lanes, columns: 1 + Math.max(0, ...lanes.map((l) => l.column)) }
}
