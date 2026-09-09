import type { Component, Course, Menu, Station, Step } from '../model/types.ts'
import { buildIndex } from '../state/graph.ts'

/*
 * The semantics of a menu document: turning a loosely-authored import into a
 * canonical `Menu`, and saying what is wrong with one.
 *
 * Deliberately free of zod. Shape validation belongs to `menuSchema.ts`, which
 * the client may only reach through `import type`; everything here is plain
 * TypeScript so the editor can validate a draft live, on every keystroke,
 * without a round trip and without pulling zod into the bundle.
 */

export const STATION_IDS: Station[] = ['liesi', 'uuni', 'grilli', 'muu']

const isStation = (value: unknown): value is Station =>
  typeof value === 'string' && (STATION_IDS as string[]).includes(value)

/** Longest slug we will generate; long enough to stay readable, short enough to type. */
const SLUG_MAX = 40

/**
 * A stable, url-ish id from a Finnish title. Decomposes so that the combining
 * marks on ä/ö/å can be stripped, which keeps `Ä` and `A` from colliding into
 * two different opaque ids.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
}

/** `base`, or the first free `base-2`, `base-3`, … Mutates nothing. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/* ------------------------------------------------------------------ problems */

export type MenuProblemCode =
  | 'duplicate_id'
  | 'orphan_component'
  | 'orphan_step'
  | 'unknown_dep'
  | 'self_dep'
  | 'cycle'
  | 'empty_menu'
  | 'empty_course'
  | 'empty_component'
  | 'unknown_use'

export interface MenuProblem {
  code: MenuProblemCode
  severity: 'error' | 'warning'
  /** Finnish, ready to render. */
  message: string
  target?: { kind: 'course' | 'component' | 'step'; id: string }
}

/**
 * Everything wrong with a menu, structured enough for the editor to jump focus
 * to the offending row and prose enough to drop straight into a banner.
 *
 * `error` blocks saving; `warning` is worth showing but describes a menu that
 * still works.
 */
export function validateMenu(menu: Menu): MenuProblem[] {
  const problems: MenuProblem[] = []
  const add = (
    code: MenuProblemCode,
    severity: 'error' | 'warning',
    message: string,
    target?: MenuProblem['target'],
  ) => problems.push(target ? { code, severity, message, target } : { code, severity, message })

  const courseIds = new Set<string>()
  const componentIds = new Set<string>()
  const stepIds = new Set<string>()

  for (const [kind, list, seen] of [
    ['course', menu.courses, courseIds],
    ['component', menu.components, componentIds],
    ['step', menu.steps, stepIds],
  ] as const) {
    for (const entry of list) {
      if (seen.has(entry.id)) {
        add('duplicate_id', 'error', `Tunnus "${entry.id}" on käytössä useammin kuin kerran.`, {
          kind,
          id: entry.id,
        })
      }
      seen.add(entry.id)
    }
  }

  if (menu.steps.length === 0) {
    add('empty_menu', 'error', 'Menussa ei ole yhtään vaihetta.')
  }

  for (const component of menu.components) {
    if (!courseIds.has(component.courseId)) {
      add(
        'orphan_component',
        'error',
        `Osa "${component.name}" viittaa tuntemattomaan ruokalajiin "${component.courseId}".`,
        { kind: 'component', id: component.id },
      )
    }
  }

  const usesByComponent = new Map<string, Set<string>>(
    menu.components.map((c) => [c.id, new Set(c.ingredients)]),
  )

  for (const step of menu.steps) {
    if (!componentIds.has(step.componentId)) {
      add(
        'orphan_step',
        'error',
        `Vaihe "${step.title}" viittaa tuntemattomaan osaan "${step.componentId}".`,
        { kind: 'step', id: step.id },
      )
    }
    if (step.deps.includes(step.id)) {
      add('self_dep', 'error', `Vaihe "${step.title}" riippuu itsestään.`, {
        kind: 'step',
        id: step.id,
      })
    }
    for (const use of step.uses ?? []) {
      if (!usesByComponent.get(step.componentId)?.has(use)) {
        add(
          'unknown_use',
          'warning',
          `Vaihe "${step.title}" käyttää ainesta "${use}", jota ei ole osan ainesluettelossa.`,
          { kind: 'step', id: step.id },
        )
      }
    }
  }

  // Dangling references and cycles are already computed — and phrased — by the
  // index every view builds anyway, so reuse it rather than re-walking the DAG.
  for (const message of buildIndex(menu).problems) {
    const cycle = message.startsWith('Riippuvuuksissa')
    const duplicate = message.startsWith('Sama vaihetunnus')
    if (duplicate) continue // already reported above, with a target
    add(cycle ? 'cycle' : 'unknown_dep', 'error', message)
  }

  for (const course of menu.courses) {
    const components = menu.components.filter((c) => c.courseId === course.id)
    if (components.length === 0) {
      add('empty_course', 'warning', `Ruokalajissa "${course.name}" ei ole yhtään osaa.`, {
        kind: 'course',
        id: course.id,
      })
    }
  }
  for (const component of menu.components) {
    if (!menu.steps.some((s) => s.componentId === component.id)) {
      add('empty_component', 'warning', `Osassa "${component.name}" ei ole yhtään vaihetta.`, {
        kind: 'component',
        id: component.id,
      })
    }
  }

  return problems
}

export const errorsOf = (problems: MenuProblem[]): MenuProblem[] =>
  problems.filter((p) => p.severity === 'error')

/* ---------------------------------------------------------------- normalize */

/** The loose shape an import may arrive in; see `menuSchema.ts` for the checked version. */
export interface LooseStep {
  id?: string
  componentId?: string
  title: string
  detail?: string
  station?: string
  /** Step ids *or* step titles. */
  deps?: string[]
  uses?: string[]
  holdPoint?: boolean
}

export interface LooseComponent {
  id?: string
  courseId?: string
  name: string
  ingredients?: string[]
  note?: string
  /** Nested form. */
  steps?: LooseStep[]
}

export interface LooseCourse {
  id?: string
  order?: number
  name: string
  note?: string
  /** Nested form. */
  components?: LooseComponent[]
}

export interface LooseMenu {
  name: string
  courses: LooseCourse[]
  /** Flat form; ignored when any course carries nested components. */
  components?: LooseComponent[]
  steps?: LooseStep[]
}

export interface NormalizeResult {
  menu: Menu
  /** Things quietly filled in or fixed up, worth telling the author about. */
  notes: string[]
}

/**
 * Turn a loosely-authored document into a canonical `Menu`.
 *
 * Accepts the nested shape (courses containing components containing steps) and
 * the flat one, fills in ids, `order` and `station`, and resolves dependencies
 * written as step *titles* into step ids — which is the difference between an
 * LLM emitting a correct menu first try and it having to keep a private id
 * table consistent across three separate arrays.
 *
 * Structural nonsense is not repaired: an unresolvable dependency survives
 * verbatim so `validateMenu` can report it against a real row.
 */
export function normalizeMenu(doc: LooseMenu): NormalizeResult {
  const notes: string[] = []
  const nested = doc.courses.some((c) => c.components !== undefined)
  if (nested && ((doc.components?.length ?? 0) > 0 || (doc.steps?.length ?? 0) > 0)) {
    notes.push(
      'Dokumentissa oli sekä sisäkkäiset että litteät taulukot; sisäkkäiset otettiin käyttöön.',
    )
  }

  // Reserve every explicitly declared id before generating any, or a generated
  // id for the first course can steal an id that the fortieth step declares —
  // and which one won would depend on the order things appear in the document.
  const taken = new Set<string>()
  const declaredComponents = nested
    ? doc.courses.flatMap((c) => c.components ?? [])
    : (doc.components ?? [])
  const declaredSteps = nested
    ? doc.courses.flatMap((c) => (c.components ?? []).flatMap((k) => k.steps ?? []))
    : (doc.steps ?? [])
  for (const entry of [...doc.courses, ...declaredComponents, ...declaredSteps]) {
    if (entry.id) taken.add(entry.id)
  }

  const claim = (explicit: string | undefined, from: string, fallback: string): string => {
    if (explicit) return explicit
    const id = uniqueId(slugify(from) || fallback, taken)
    taken.add(id)
    return id
  }

  const courses: Course[] = doc.courses.map((course, i) => ({
    id: claim(course.id, course.name, `ruokalaji-${i + 1}`),
    order: course.order ?? i + 1,
    name: course.name,
    ...(course.note === undefined ? {} : { note: course.note }),
  }))

  const components: Component[] = []
  const steps: Step[] = []

  const takeComponent = (loose: LooseComponent, courseId: string, i: number): string => {
    const id = claim(loose.id, loose.name, `osa-${i + 1}`)
    components.push({
      id,
      courseId,
      name: loose.name,
      ingredients: [...(loose.ingredients ?? [])],
      ...(loose.note === undefined ? {} : { note: loose.note }),
    })
    return id
  }

  const takeStep = (loose: LooseStep, componentId: string, i: number): void => {
    if (loose.station !== undefined && !isStation(loose.station)) {
      notes.push(`Vaiheen "${loose.title}" tuntematon piste "${loose.station}" korvattiin: muu.`)
    }
    steps.push({
      id: claim(loose.id, loose.title, `vaihe-${i + 1}`),
      componentId,
      title: loose.title,
      ...(loose.detail === undefined ? {} : { detail: loose.detail }),
      station: isStation(loose.station) ? loose.station : 'muu',
      deps: [...(loose.deps ?? [])],
      ...(loose.uses === undefined ? {} : { uses: [...loose.uses] }),
      ...(loose.holdPoint === undefined ? {} : { holdPoint: loose.holdPoint }),
    })
  }

  if (nested) {
    doc.courses.forEach((course, ci) => {
      const courseId = courses[ci].id
      const own = course.components ?? []
      own.forEach((component, ki) => {
        const componentId = takeComponent(component, courseId, ki)
        const ownSteps = component.steps ?? []
        ownSteps.forEach((step, si) => takeStep(step, componentId, si))
      })
    })
  } else {
    const fallbackCourse = courses[0]?.id ?? ''
    const looseComponents = doc.components ?? []
    looseComponents.forEach((component, ki) =>
      takeComponent(component, component.courseId ?? fallbackCourse, ki),
    )
    const fallbackComponent = components[0]?.id ?? ''
    const looseSteps = doc.steps ?? []
    looseSteps.forEach((step, si) => takeStep(step, step.componentId ?? fallbackComponent, si))
  }

  resolveDeps(steps, notes)

  return { menu: { name: doc.name, courses, components, steps }, notes }
}

/**
 * Rewrite dependencies written as titles into ids, in place. Runs only once
 * every step exists, because a step may name one declared after it.
 */
function resolveDeps(steps: Step[], notes: string[]): void {
  const byId = new Set(steps.map((s) => s.id))
  const byTitle = new Map<string, string[]>()
  for (const step of steps) {
    const key = step.title.trim().toLowerCase()
    byTitle.set(key, [...(byTitle.get(key) ?? []), step.id])
  }

  for (const step of steps) {
    const resolved: string[] = []
    for (const dep of step.deps) {
      if (byId.has(dep)) {
        if (dep !== step.id) resolved.push(dep)
        continue
      }
      const matches = byTitle.get(dep.trim().toLowerCase()) ?? []
      if (matches.length === 1) {
        if (matches[0] !== step.id) resolved.push(matches[0])
      } else {
        if (matches.length > 1) {
          notes.push(`Riippuvuus "${dep}" osuu useaan vaiheeseen, joten sitä ei ratkaistu.`)
        }
        resolved.push(dep)
      }
    }
    step.deps = [...new Set(resolved)]
  }
}

/**
 * The canonical form: courses by `order`, components and steps grouped under
 * their parent, optional keys omitted rather than set to `undefined`, and a
 * fixed key order throughout.
 *
 * All three matter more than they look. `hashMenu` on the server hashes
 * `JSON.stringify(menu)`, and `exactOptionalPropertyTypes` is off — so a stray
 * `{ detail: undefined }` would change a menu's hash without changing the menu.
 */
export function toExportDoc(menu: Menu): Menu {
  const order = new Map(menu.courses.map((c, i) => [c.id, i]))
  const courses = [...menu.courses].sort(
    (a, b) => a.order - b.order || order.get(a.id)! - order.get(b.id)!,
  )

  const grouped = courses.flatMap((course) =>
    menu.components.filter((c) => c.courseId === course.id),
  )
  const orphanComponents = menu.components.filter(
    (c) => !courses.some((course) => course.id === c.courseId),
  )
  const components = [...grouped, ...orphanComponents]

  const groupedSteps = components.flatMap((component) =>
    menu.steps.filter((s) => s.componentId === component.id),
  )
  const orphanSteps = menu.steps.filter(
    (s) => !components.some((c) => c.id === s.componentId),
  )

  return {
    name: menu.name,
    courses: courses.map((c) => ({
      id: c.id,
      order: c.order,
      name: c.name,
      ...(c.note === undefined ? {} : { note: c.note }),
    })),
    components: components.map((c) => ({
      id: c.id,
      courseId: c.courseId,
      name: c.name,
      ingredients: [...c.ingredients],
      ...(c.note === undefined ? {} : { note: c.note }),
    })),
    steps: [...groupedSteps, ...orphanSteps].map((s) => ({
      id: s.id,
      componentId: s.componentId,
      title: s.title,
      ...(s.detail === undefined ? {} : { detail: s.detail }),
      station: s.station,
      deps: [...s.deps],
      ...(s.uses === undefined ? {} : { uses: [...s.uses] }),
      ...(s.holdPoint === undefined ? {} : { holdPoint: s.holdPoint }),
    })),
  }
}
