import type { Component, Course, Menu, Station, Step } from '../model/types.ts'
import { mergeMenus } from '../shared/menuDoc.ts'

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
  /** Position among siblings, and how many there are; bounds for Alt+↑/↓. */
  index: number
  siblingCount: number
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
    rows.push({
      key: rowKey('course', course.id),
      kind: 'course',
      id: course.id,
      depth: 0,
      title: course.name,
      index: courseIndex,
      siblingCount: courses.length,
    })

    const components = menu.components.filter((c) => c.courseId === course.id)
    components.forEach((component, componentIndex) => {
      rows.push({
        key: rowKey('component', component.id),
        kind: 'component',
        id: component.id,
        depth: 1,
        title: component.name,
        index: componentIndex,
        siblingCount: components.length,
      })

      const steps = menu.steps.filter((s) => s.componentId === component.id)
      steps.forEach((step, stepIndex) => {
        rows.push({
          key: rowKey('step', step.id),
          kind: 'step',
          id: step.id,
          depth: 2,
          title: step.title,
          index: stepIndex,
          siblingCount: steps.length,
        })
      })
    })
  })

  return rows
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
 * Note what is deliberately absent: there is no promote/demote between levels.
 *
 * A course, a component and a step are three different kinds of thing, not
 * three depths of one thing — a component is a noun ("Kantarellikeitto") and a
 * step is a verb ("Pilko sipuli"). Turning one into the other is a category
 * error, however natural it looks in an outliner, so rows are created and
 * deleted at the level they belong to and never converted between levels.
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
  const dependents = new Map<string, string[]>(menu.steps.map((s) => [s.id, []]))
  for (const step of menu.steps) {
    for (const dep of step.deps) dependents.get(dep)?.push(step.id)
  }

  const downstream = new Set<string>()
  const queue = [...(dependents.get(stepId) ?? [])]
  while (queue.length) {
    const next = queue.shift()!
    if (downstream.has(next)) continue
    downstream.add(next)
    queue.push(...(dependents.get(next) ?? []))
  }

  return menu.steps.filter((s) => s.id !== stepId && !downstream.has(s.id))
}
