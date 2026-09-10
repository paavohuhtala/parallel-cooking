import type { Component, Course, Menu, Station, Step } from '../model/types.ts'
import { mergeMenus } from '../shared/menuDoc.ts'
import { buildIndex, reachableFrom } from './graph.ts'

/*
 * The outliner's reducer. Pure, DOM-free and React-free, so every structural
 * rule below is a unit test rather than something you have to click to check.
 *
 * Two ideas carry most of the weight:
 *
 *  - **Auto-chaining.** A new step depends on the one above it in the same
 *    component, because that is how recipes read. Typing a dish top to bottom
 *    therefore produces a correct dependency chain with no dependency work at
 *    all, and you only touch the exceptions — the forks and the joins.
 *  - **A step that has been customised is never re-linked.** `onDefaultChain`
 *    is the whole of that rule: the moment you edit a step's dependencies by
 *    hand, reordering and deleting around it stop rewriting them.
 *
 * Every action also returns the row that should hold the cursor afterwards, so
 * "Enter puts me in the new step" is testable without a browser.
 */

export type RowKind = 'course' | 'component' | 'step'

export interface OutlineRow {
  /** `${kind}:${id}` — also the DOM id, and what `focus` names. */
  key: string
  kind: RowKind
  id: string
  depth: 0 | 1 | 2
  title: string
  /** Steps only: what the outline shows in the row's left slot. */
  station: Station | null
  /** Position among siblings, and how many there are; bounds for Alt+↑/↓. */
  index: number
  siblingCount: number
  /**
   * Rows directly under this one — dishes for a course, steps for a dish, and
   * always 0 for a step. What decides whether Backspace on an empty title may
   * delete the row: a keystroke never takes a subtree with it.
   */
  childCount: number
}

export const rowKey = (kind: RowKind, id: string): string => `${kind}:${id}`

/**
 * The tree as a flat list, in authoring order.
 *
 * Steps are listed in `menu.steps` declaration order rather than topological
 * order: the editor should show what the document says, so that moving a row
 * visibly moves it. (The recipe view sorts topologically instead — there,
 * dependency order is the useful one.)
 */
export function flattenMenu(menu: Menu): OutlineRow[] {
  const rows: OutlineRow[] = []
  const courses = [...menu.courses].sort((a, b) => a.order - b.order)

  courses.forEach((course, courseIndex) => {
    const components = menu.components.filter((c) => c.courseId === course.id)
    rows.push({
      key: rowKey('course', course.id),
      kind: 'course',
      id: course.id,
      depth: 0,
      title: course.name,
      station: null,
      index: courseIndex,
      siblingCount: courses.length,
      childCount: components.length,
    })

    components.forEach((component, componentIndex) => {
      const steps = menu.steps.filter((s) => s.componentId === component.id)
      rows.push({
        key: rowKey('component', component.id),
        kind: 'component',
        id: component.id,
        depth: 1,
        title: component.name,
        station: null,
        index: componentIndex,
        siblingCount: components.length,
        childCount: steps.length,
      })

      steps.forEach((step, stepIndex) => {
        rows.push({
          key: rowKey('step', step.id),
          kind: 'step',
          id: step.id,
          depth: 2,
          title: step.title,
          station: step.station,
          index: stepIndex,
          siblingCount: steps.length,
          childCount: 0,
        })
      })
    })
  })

  return rows
}

/* ------------------------------------------------------------ outline items */

/**
 * What the outline actually renders: the visible rows, plus the "+ Osa" and
 * "+ Vaihe" tail rows that end every list.
 *
 * The tails are always there rather than only when a parent is empty, so
 * there is no empty state to discover and one uniform way to add anything at
 * any level. They live here rather than in the view because "where can a child
 * be added" is a structural rule like the others.
 */
export type OutlineItem =
  | {
      type: 'row'
      key: string
      row: OutlineRow
      /** Course and component rows only; a step has nothing to collapse. */
      collapsed: boolean
      /** What a collapsed row is hiding, so collapsing never loses information. */
      hidden: { components: number; steps: number } | null
    }
  | {
      type: 'tail'
      key: string
      /** The kind this tail creates, not the kind of its parent. */
      childKind: RowKind
      /** `null` on the menu-level tail, which appends a course. */
      parentId: string | null
      parentName: string
      depth: 0 | 1 | 2
    }

export function outlineItems(menu: Menu, collapsed: ReadonlySet<string>): OutlineItem[] {
  const byKey = new Map(flattenMenu(menu).map((r) => [r.key, r]))
  const items: OutlineItem[] = []
  const courses = [...menu.courses].sort((a, b) => a.order - b.order)

  for (const course of courses) {
    const key = rowKey('course', course.id)
    const components = menu.components.filter((c) => c.courseId === course.id)
    const componentIds = new Set(components.map((c) => c.id))
    const isCollapsed = collapsed.has(key)
    items.push({
      type: 'row',
      key,
      row: byKey.get(key)!,
      collapsed: isCollapsed,
      hidden: isCollapsed
        ? {
            components: components.length,
            steps: menu.steps.filter((s) => componentIds.has(s.componentId)).length,
          }
        : null,
    })
    if (isCollapsed) continue

    for (const component of components) {
      const componentKey = rowKey('component', component.id)
      const steps = menu.steps.filter((s) => s.componentId === component.id)
      const componentCollapsed = collapsed.has(componentKey)
      items.push({
        type: 'row',
        key: componentKey,
        row: byKey.get(componentKey)!,
        collapsed: componentCollapsed,
        hidden: componentCollapsed ? { components: 0, steps: steps.length } : null,
      })
      if (componentCollapsed) continue

      for (const step of steps) {
        const stepKey = rowKey('step', step.id)
        items.push({ type: 'row', key: stepKey, row: byKey.get(stepKey)!, collapsed: false, hidden: null })
      }
      items.push({
        type: 'tail',
        key: `tail:step:${component.id}`,
        childKind: 'step',
        parentId: component.id,
        parentName: component.name,
        depth: 2,
      })
    }

    items.push({
      type: 'tail',
      key: `tail:component:${course.id}`,
      childKind: 'component',
      parentId: course.id,
      parentName: course.name,
      depth: 1,
    })
  }

  items.push({
    type: 'tail',
    key: 'tail:course',
    childKind: 'course',
    parentId: null,
    parentName: menu.name,
    depth: 0,
  })
  return items
}

/**
 * The rows a collapsed ancestor is hiding `key` behind, outermost last.
 *
 * Jumping to a problem has to be able to open the outline back up, or the
 * cursor lands on a row nobody can see.
 */
export function ancestorKeys(menu: Menu, key: string): string[] {
  const at = key.indexOf(':')
  const kind = key.slice(0, at)
  const id = key.slice(at + 1)

  if (kind === 'step') {
    const step = menu.steps.find((s) => s.id === id)
    const component = step && menu.components.find((c) => c.id === step.componentId)
    return component ? [rowKey('component', component.id), rowKey('course', component.courseId)] : []
  }
  if (kind === 'component') {
    const component = menu.components.find((c) => c.id === id)
    return component ? [rowKey('course', component.courseId)] : []
  }
  return []
}

/* --------------------------------------------------------------------- ids */

/**
 * `step-3`, `osa-2`, and so on: the smallest free number for that kind.
 *
 * Deliberately not random and not derived from the title. An id derived from
 * the title would have to change as you type, under steps that already depend
 * on it; randomness would need `crypto`, and would make these tests unreadable.
 * Readable ids are restored on demand by "Siisti tunnisteet" at export time.
 */
function freshId(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const candidate = `${prefix}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

const allIds = (menu: Menu): Set<string> =>
  new Set([
    ...menu.courses.map((c) => c.id),
    ...menu.components.map((c) => c.id),
    ...menu.steps.map((s) => s.id),
  ])

/* ------------------------------------------------------------ auto-chaining */

/** True while this step's dependencies are still exactly what auto-chaining made. */
const onDefaultChain = (step: Step, previousId: string | null): boolean =>
  previousId === null
    ? step.deps.length === 0
    : step.deps.length === 1 && step.deps[0] === previousId

/** Which steps of a component are still on the default chain, before a change. */
function defaultChained(menu: Menu, componentId: string): Set<string> {
  const own = menu.steps.filter((s) => s.componentId === componentId)
  const set = new Set<string>()
  own.forEach((step, i) => {
    if (onDefaultChain(step, i === 0 ? null : own[i - 1].id)) set.add(step.id)
  })
  return set
}

/**
 * Rebuild the default chain for the steps that were still on it, leaving any
 * hand-edited dependencies exactly as they are.
 */
function relink(steps: Step[], componentId: string, wasDefault: ReadonlySet<string>): Step[] {
  const own = steps.filter((s) => s.componentId === componentId)
  const rewritten = new Map<string, string[]>()
  own.forEach((step, i) => {
    if (!wasDefault.has(step.id)) return
    const previous = i === 0 ? null : own[i - 1].id
    rewritten.set(step.id, previous === null ? [] : [previous])
  })
  return steps.map((s) => (rewritten.has(s.id) ? { ...s, deps: rewritten.get(s.id)! } : s))
}

/**
 * Remove steps from the graph without breaking it: anything that depended on a
 * removed step inherits that step's own dependencies. Deleting a step in the
 * middle of a chain heals the chain rather than splitting the dish in two.
 */
function spliceOut(steps: Step[], removed: ReadonlySet<string>): Step[] {
  const depsOf = new Map(steps.map((s) => [s.id, s.deps]))
  const resolve = (id: string, seen: Set<string>): string[] => {
    if (seen.has(id)) return []
    seen.add(id)
    return (depsOf.get(id) ?? []).flatMap((d) => (removed.has(d) ? resolve(d, seen) : [d]))
  }

  return steps
    .filter((s) => !removed.has(s.id))
    .map((step) => {
      if (!step.deps.some((d) => removed.has(d))) return step
      const deps = [...new Set(step.deps.flatMap((d) => (removed.has(d) ? resolve(d, new Set()) : [d])))]
      return { ...step, deps: deps.filter((d) => d !== step.id) }
    })
}

/* ----------------------------------------------------------------- actions */

export type MenuAction =
  | { type: 'rename_menu'; value: string }
  | { type: 'rename'; kind: RowKind; id: string; value: string }
  | { type: 'set_note'; kind: 'course' | 'component'; id: string; value: string }
  | { type: 'set_detail'; id: string; value: string }
  | { type: 'set_station'; id: string; station: Station }
  | { type: 'toggle_hold'; id: string }
  | { type: 'toggle_dep'; id: string; depId: string }
  | { type: 'toggle_use'; id: string; ingredient: string }
  | { type: 'add_ingredient'; componentId: string; value: string; alsoUse?: string }
  | { type: 'remove_ingredient'; componentId: string; value: string }
  /** Enter: a new sibling directly below this row. */
  | { type: 'insert_after'; kind: RowKind; id: string }
  /**
   * The tail rows, and Shift+Enter: append a child to the end of this row's
   * list. This is the only way a course with no components, or a component
   * with no steps, can ever gain one.
   */
  | { type: 'insert_child'; kind: 'course' | 'component'; id: string }
  /** The tail row under the whole outline: a course at the end of the menu. */
  | { type: 'add_course' }
  | { type: 'delete_row'; kind: RowKind; id: string }
  /** Alt+↑/↓ within siblings. */
  | { type: 'move'; kind: RowKind; id: string; delta: -1 | 1 }
  /** Append another menu's courses — one converted recipe at a time. */
  | { type: 'merge'; incoming: Menu }

export interface DraftResult {
  menu: Menu
  /** The row that should hold the cursor, as an `OutlineRow.key`. */
  focus: string | null
}

/**
 * Rows are created, moved and deleted at the level they belong to.
 *
 * The three levels are three different kinds of thing rather than three depths
 * of one thing — a component is a noun ("Kantarellikeitto"), a step is a verb
 * ("Pilko sipuli") — so an outliner's usual promote/demote between levels would
 * be a category error here however natural the gesture looks.
 */
export function applyDraftAction(menu: Menu, action: MenuAction): DraftResult {
  const keep = (next: Menu, focus: string | null = null): DraftResult => ({ menu: next, focus })

  switch (action.type) {
    case 'rename_menu':
      return keep({ ...menu, name: action.value })

    case 'rename': {
      if (action.kind === 'course') {
        return keep({
          ...menu,
          courses: menu.courses.map((c) =>
            c.id === action.id ? { ...c, name: action.value } : c,
          ),
        })
      }
      if (action.kind === 'component') {
        return keep({
          ...menu,
          components: menu.components.map((c) =>
            c.id === action.id ? { ...c, name: action.value } : c,
          ),
        })
      }
      return keep({
        ...menu,
        steps: menu.steps.map((s) => (s.id === action.id ? { ...s, title: action.value } : s)),
      })
    }

    case 'set_note': {
      const patch = <T extends { id: string }>(list: T[]) =>
        list.map((x) =>
          x.id === action.id
            ? { ...x, ...(action.value ? { note: action.value } : { note: undefined }) }
            : x,
        )
      return keep(
        action.kind === 'course'
          ? { ...menu, courses: patch(menu.courses) as Course[] }
          : { ...menu, components: patch(menu.components) as Component[] },
      )
    }

    case 'set_detail':
      return keep({
        ...menu,
        steps: menu.steps.map((s) =>
          s.id === action.id ? { ...s, detail: action.value || undefined } : s,
        ),
      })

    case 'set_station':
      return keep({
        ...menu,
        steps: menu.steps.map((s) =>
          s.id === action.id ? { ...s, station: action.station } : s,
        ),
      })

    case 'toggle_hold':
      return keep({
        ...menu,
        steps: menu.steps.map((s) =>
          s.id === action.id ? { ...s, holdPoint: s.holdPoint ? undefined : true } : s,
        ),
      })

    case 'toggle_dep':
      return keep({
        ...menu,
        steps: menu.steps.map((s) =>
          s.id === action.id
            ? {
                ...s,
                deps: s.deps.includes(action.depId)
                  ? s.deps.filter((d) => d !== action.depId)
                  : [...s.deps, action.depId],
              }
            : s,
        ),
      })

    case 'toggle_use':
      return keep({
        ...menu,
        steps: menu.steps.map((s) => {
          if (s.id !== action.id) return s
          const uses = s.uses ?? []
          const next = uses.includes(action.ingredient)
            ? uses.filter((u) => u !== action.ingredient)
            : [...uses, action.ingredient]
          return { ...s, uses: next.length ? next : undefined }
        }),
      })

    case 'add_ingredient': {
      const value = action.value.trim()
      if (!value) return keep(menu)
      const components = menu.components.map((c) =>
        c.id === action.componentId && !c.ingredients.includes(value)
          ? { ...c, ingredients: [...c.ingredients, value] }
          : c,
      )
      const steps = action.alsoUse
        ? menu.steps.map((s) =>
            s.id === action.alsoUse ? { ...s, uses: [...(s.uses ?? []), value] } : s,
          )
        : menu.steps
      return keep({ ...menu, components, steps })
    }

    case 'remove_ingredient':
      return keep({
        ...menu,
        components: menu.components.map((c) =>
          c.id === action.componentId
            ? { ...c, ingredients: c.ingredients.filter((i) => i !== action.value) }
            : c,
        ),
        // An ingredient nobody lists is not an ingredient a step can use.
        steps: menu.steps.map((s) => {
          if (s.componentId !== action.componentId || !s.uses?.includes(action.value)) return s
          const uses = s.uses.filter((u) => u !== action.value)
          return { ...s, uses: uses.length ? uses : undefined }
        }),
      })

    case 'insert_after':
      return insertAfter(menu, action.kind, action.id)

    case 'insert_child':
      return insertChild(menu, action.kind, action.id)

    case 'add_course': {
      const course: Course = { id: freshId('ruokalaji', allIds(menu)), order: 0, name: '' }
      const courses = [...menu.courses, course].map((c, i) => ({ ...c, order: i + 1 }))
      return keep({ ...menu, courses }, rowKey('course', course.id))
    }

    case 'delete_row':
      return deleteRow(menu, action.kind, action.id)

    case 'move':
      return moveRow(menu, action.kind, action.id, action.delta)

    case 'merge': {
      const merged = mergeMenus(menu, action.incoming)
      const firstNew = merged.menu.courses[menu.courses.length]
      return keep(merged.menu, firstNew ? rowKey('course', firstNew.id) : null)
    }

  }
}

/* --------------------------------------------------------------- structure */

function insertAfter(menu: Menu, kind: RowKind, id: string): DraftResult {
  const taken = allIds(menu)

  if (kind === 'course') {
    const at = menu.courses.findIndex((c) => c.id === id)
    if (at === -1) return { menu, focus: null }
    const course: Course = { id: freshId('ruokalaji', taken), order: 0, name: '' }
    const courses = [...menu.courses]
    courses.splice(at + 1, 0, course)
    return {
      menu: { ...menu, courses: courses.map((c, i) => ({ ...c, order: i + 1 })) },
      focus: rowKey('course', course.id),
    }
  }

  if (kind === 'component') {
    const source = menu.components.find((c) => c.id === id)
    if (!source) return { menu, focus: null }
    const at = menu.components.findIndex((c) => c.id === id)
    const component: Component = {
      id: freshId('osa', taken),
      courseId: source.courseId,
      name: '',
      ingredients: [],
    }
    const components = [...menu.components]
    components.splice(at + 1, 0, component)
    return { menu: { ...menu, components }, focus: rowKey('component', component.id) }
  }

  const source = menu.steps.find((s) => s.id === id)
  if (!source) return { menu, focus: null }
  const at = menu.steps.findIndex((s) => s.id === id)
  const step: Step = {
    id: freshId('vaihe', taken),
    componentId: source.componentId,
    title: '',
    station: 'muu',
    // Auto-chain: the new step waits on the one it was typed under.
    deps: [source.id],
  }
  const steps = [...menu.steps]
  steps.splice(at + 1, 0, step)

  // Whatever followed used to wait on `source`; if it never said otherwise, it
  // now waits on the step just inserted between them.
  const relinked = steps.map((s) =>
    s.componentId === source.componentId && s.id !== step.id && onDefaultChain(s, source.id)
      ? { ...s, deps: [step.id] }
      : s,
  )
  return { menu: { ...menu, steps: relinked }, focus: rowKey('step', step.id) }
}

/**
 * Append a child at the end of `id`'s list.
 *
 * With children already there this is exactly "Enter on the last one", so it
 * auto-chains like any other typed step; the interesting case is the empty
 * parent, which `insert_after` cannot reach at all because it derives the new
 * row's parent from a sibling that does not exist.
 */
function insertChild(menu: Menu, kind: 'course' | 'component', id: string): DraftResult {
  const taken = allIds(menu)

  if (kind === 'course') {
    if (!menu.courses.some((c) => c.id === id)) return { menu, focus: null }
    const own = menu.components.filter((c) => c.courseId === id)
    if (own.length > 0) return insertAfter(menu, 'component', own[own.length - 1].id)
    const component: Component = {
      id: freshId('osa', taken),
      courseId: id,
      name: '',
      ingredients: [],
    }
    // Position in the flat array is cosmetic: the outline groups components by
    // course, and the export nests them.
    return {
      menu: { ...menu, components: [...menu.components, component] },
      focus: rowKey('component', component.id),
    }
  }

  if (!menu.components.some((c) => c.id === id)) return { menu, focus: null }
  const own = menu.steps.filter((s) => s.componentId === id)
  if (own.length > 0) return insertAfter(menu, 'step', own[own.length - 1].id)
  const step: Step = {
    id: freshId('vaihe', taken),
    componentId: id,
    title: '',
    station: 'muu',
    // First in its dish, so it waits for nothing.
    deps: [],
  }
  return { menu: { ...menu, steps: [...menu.steps, step] }, focus: rowKey('step', step.id) }
}

/** The row to land on once `row` is gone: the one above it, else the one below. */
function neighbourOf(menu: Menu, kind: RowKind, id: string): string | null {
  const rows = flattenMenu(menu)
  const at = rows.findIndex((r) => r.key === rowKey(kind, id))
  if (at === -1) return null
  return rows[at - 1]?.key ?? rows[at + 1]?.key ?? null
}

function deleteRow(menu: Menu, kind: RowKind, id: string): DraftResult {
  const focus = neighbourOf(menu, kind, id)

  if (kind === 'step') {
    if (!menu.steps.some((s) => s.id === id)) return { menu, focus: null }
    return { menu: { ...menu, steps: spliceOut(menu.steps, new Set([id])) }, focus }
  }

  if (kind === 'component') {
    if (!menu.components.some((c) => c.id === id)) return { menu, focus: null }
    const doomed = new Set(menu.steps.filter((s) => s.componentId === id).map((s) => s.id))
    return {
      menu: {
        ...menu,
        components: menu.components.filter((c) => c.id !== id),
        steps: spliceOut(menu.steps, doomed),
      },
      focus,
    }
  }

  if (!menu.courses.some((c) => c.id === id)) return { menu, focus: null }
  const components = menu.components.filter((c) => c.courseId === id).map((c) => c.id)
  const doomed = new Set(
    menu.steps.filter((s) => components.includes(s.componentId)).map((s) => s.id),
  )
  return {
    menu: {
      ...menu,
      courses: menu.courses
        .filter((c) => c.id !== id)
        .map((c, i) => ({ ...c, order: i + 1 })),
      components: menu.components.filter((c) => c.courseId !== id),
      steps: spliceOut(menu.steps, doomed),
    },
    focus,
  }
}

/** Swap a row with its neighbour among its own siblings, and nowhere else. */
function moveRow(menu: Menu, kind: RowKind, id: string, delta: -1 | 1): DraftResult {
  const focus = rowKey(kind, id)

  if (kind === 'course') {
    const sorted = [...menu.courses].sort((a, b) => a.order - b.order)
    const at = sorted.findIndex((c) => c.id === id)
    const to = at + delta
    if (at === -1 || to < 0 || to >= sorted.length) return { menu, focus }
    const [moved] = sorted.splice(at, 1)
    sorted.splice(to, 0, moved)
    return {
      menu: { ...menu, courses: sorted.map((c, i) => ({ ...c, order: i + 1 })) },
      focus,
    }
  }

  if (kind === 'component') {
    const source = menu.components.find((c) => c.id === id)
    if (!source) return { menu, focus }
    const siblings = menu.components.filter((c) => c.courseId === source.courseId)
    const at = siblings.findIndex((c) => c.id === id)
    const to = at + delta
    if (to < 0 || to >= siblings.length) return { menu, focus }
    const reordered = [...siblings]
    const [moved] = reordered.splice(at, 1)
    reordered.splice(to, 0, moved)
    // Rebuild the flat array, keeping every other course's components in place.
    let next = 0
    const components = menu.components.map((c) =>
      c.courseId === source.courseId ? reordered[next++] : c,
    )
    return { menu: { ...menu, components }, focus }
  }

  const source = menu.steps.find((s) => s.id === id)
  if (!source) return { menu, focus }
  const siblings = menu.steps.filter((s) => s.componentId === source.componentId)
  const at = siblings.findIndex((s) => s.id === id)
  const to = at + delta
  if (to < 0 || to >= siblings.length) return { menu, focus }

  const wasDefault = defaultChained(menu, source.componentId)
  const reordered = [...siblings]
  const [moved] = reordered.splice(at, 1)
  reordered.splice(to, 0, moved)
  let next = 0
  const steps = menu.steps.map((s) => (s.componentId === source.componentId ? reordered[next++] : s))

  return { menu: { ...menu, steps: relink(steps, source.componentId, wasDefault) }, focus }
}

/* -------------------------------------------------------------------- deps */

/**
 * Steps that may be added as a dependency of `stepId`: everything except itself
 * and anything downstream of it. Offering a cycle and then refusing it is worse
 * than not offering it.
 */
export function dependencyCandidates(menu: Menu, stepId: string): Step[] {
  const downstream = reachableFrom(buildIndex(menu), stepId)
  return menu.steps.filter((s) => s.id !== stepId && !downstream.has(s.id))
}
