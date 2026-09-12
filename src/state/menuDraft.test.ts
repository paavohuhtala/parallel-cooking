import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Menu } from '../model/types.ts'
import { buildIndex } from './graph.ts'
import {
  applyDraftAction,
  dependencyCandidates,
  flattenMenu,
  rowKey,
  type MenuAction,
} from './menuDraft.ts'

/** One course, one dish, three steps in a straight auto-chained line. */
const base = (): Menu => ({
  name: 'Illallinen',
  courses: [{ id: 'c1', order: 1, name: 'Alkupala' }],
  components: [{ id: 'k1', courseId: 'c1', name: 'Keitto', ingredients: ['voita'] }],
  steps: [
    { id: 'a', componentId: 'k1', title: 'A', station: 'muu', deps: [] },
    { id: 'b', componentId: 'k1', title: 'B', station: 'muu', deps: ['a'] },
    { id: 'c', componentId: 'k1', title: 'C', station: 'muu', deps: ['b'] },
  ],
})

const run = (menu: Menu, ...actions: MenuAction[]): Menu =>
  actions.reduce((m, action) => applyDraftAction(m, action).menu, menu)

const stepIds = (menu: Menu) => menu.steps.map((s) => s.id)
const depsOf = (menu: Menu, id: string) => menu.steps.find((s) => s.id === id)!.deps

test('a new step waits on the one it was typed under', () => {
  const { menu, focus } = applyDraftAction(base(), { type: 'insert_after', kind: 'step', id: 'c' })
  const added = menu.steps[menu.steps.length - 1]
  assert.deepEqual(added.deps, ['c'])
  assert.equal(focus, rowKey('step', added.id))
  assert.equal(added.station, 'muu')
})

test('inserting mid-chain relinks the step below, so the chain stays a chain', () => {
  const { menu } = applyDraftAction(base(), { type: 'insert_after', kind: 'step', id: 'a' })
  const added = menu.steps.find((s) => !['a', 'b', 'c'].includes(s.id))!
  assert.deepEqual(added.deps, ['a'])
  assert.deepEqual(depsOf(menu, 'b'), [added.id])
  assert.deepEqual(buildIndex(menu).problems, [])
})

test('a step whose dependencies were edited by hand is never relinked', () => {
  // B now waits on A *and* something else, so it is no longer on the default chain.
  const custom = run(base(), { type: 'toggle_dep', id: 'b', depId: 'c' })
  const { menu } = applyDraftAction(custom, { type: 'insert_after', kind: 'step', id: 'a' })
  assert.deepEqual(depsOf(menu, 'b'), ['a', 'c'])
})

/* ------------------------------------------------------- the step above one */

test('a preceding step takes the place of the one it was added above', () => {
  const { menu, focus } = applyDraftAction(base(), { type: 'insert_before', kind: 'step', id: 'b' })
  const added = menu.steps.find((s) => !['a', 'b', 'c'].includes(s.id))!
  assert.deepEqual(stepIds(menu), ['a', added.id, 'b', 'c'])
  assert.deepEqual(added.deps, ['a'])
  assert.deepEqual(depsOf(menu, 'b'), [added.id])
  assert.equal(focus, rowKey('step', added.id))
  assert.deepEqual(buildIndex(menu).problems, [])
})

test('a step added above the first one waits for nothing, and the first now waits on it', () => {
  const { menu } = applyDraftAction(base(), { type: 'insert_before', kind: 'step', id: 'a' })
  const added = menu.steps[0]
  assert.deepEqual(stepIds(menu), [added.id, 'a', 'b', 'c'])
  assert.deepEqual(added.deps, [])
  assert.deepEqual(depsOf(menu, 'a'), [added.id])
  assert.deepEqual(buildIndex(menu).problems, [])
})

test('a hand-edited step is not relinked by inserting above it either', () => {
  // B waits on A *and* C, so it is no longer on the default chain.
  const custom = run(base(), { type: 'toggle_dep', id: 'b', depId: 'c' })
  const { menu } = applyDraftAction(custom, { type: 'insert_before', kind: 'step', id: 'b' })
  const added = menu.steps.find((s) => !['a', 'b', 'c'].includes(s.id))!
  assert.deepEqual(depsOf(menu, 'b'), ['a', 'c'])
  assert.deepEqual(added.deps, ['a'])
})

test('a preceding dish and course land above the row they were added from', () => {
  const withDish = applyDraftAction(base(), { type: 'insert_before', kind: 'component', id: 'k1' }).menu
  assert.equal(withDish.components[0].courseId, 'c1')
  assert.deepEqual(withDish.components.map((c) => c.name), ['', 'Keitto'])

  const { menu, focus } = applyDraftAction(base(), { type: 'insert_before', kind: 'course', id: 'c1' })
  assert.deepEqual(menu.courses.map((c) => c.name), ['', 'Alkupala'])
  assert.deepEqual(menu.courses.map((c) => c.order), [1, 2])
  assert.equal(focus, rowKey('course', menu.courses[0].id))
})

test('deleting a step heals the chain rather than splitting the dish', () => {
  const menu = run(base(), { type: 'delete_row', kind: 'step', id: 'b' })
  assert.deepEqual(stepIds(menu), ['a', 'c'])
  assert.deepEqual(depsOf(menu, 'c'), ['a'])
  assert.deepEqual(buildIndex(menu).problems, [])
})

test('deleting several steps in a row still leaves one connected chain', () => {
  const menu = run(
    base(),
    { type: 'delete_row', kind: 'step', id: 'b' },
    { type: 'delete_row', kind: 'step', id: 'a' },
  )
  assert.deepEqual(stepIds(menu), ['c'])
  assert.deepEqual(depsOf(menu, 'c'), [])
})

test('deleting a step focuses the row above it', () => {
  const { focus } = applyDraftAction(base(), { type: 'delete_row', kind: 'step', id: 'b' })
  assert.equal(focus, rowKey('step', 'a'))
})

test('moving a step rebuilds the default chain in the new order', () => {
  const menu = run(base(), { type: 'move', kind: 'step', id: 'c', delta: -1 })
  assert.deepEqual(stepIds(menu), ['a', 'c', 'b'])
  assert.deepEqual(depsOf(menu, 'c'), ['a'])
  assert.deepEqual(depsOf(menu, 'b'), ['c'])
  assert.deepEqual(buildIndex(menu).problems, [])
})

test('moving past the end of the list does nothing', () => {
  const menu = run(base(), { type: 'move', kind: 'step', id: 'a', delta: -1 })
  assert.deepEqual(stepIds(menu), ['a', 'b', 'c'])
})

test('a cross-component dependency survives reordering', () => {
  const menu: Menu = {
    ...base(),
    components: [
      ...base().components,
      { id: 'k2', courseId: 'c1', name: 'Tarjoilu', ingredients: [] },
    ],
    steps: [
      ...base().steps,
      { id: 'plate', componentId: 'k2', title: 'Kata', station: 'muu', deps: [] },
    ],
  }
  // C waits on the soup chain and on the table being laid.
  const custom = run(menu, { type: 'toggle_dep', id: 'c', depId: 'plate' })
  const moved = run(custom, { type: 'move', kind: 'step', id: 'a', delta: 1 })
  assert.deepEqual(depsOf(moved, 'c'), ['b', 'plate'])
})

test('deleting a dish removes its steps and heals what depended on them', () => {
  const withService: Menu = {
    ...base(),
    components: [
      ...base().components,
      { id: 'k2', courseId: 'c1', name: 'Tarjoilu', ingredients: [] },
    ],
    steps: [
      ...base().steps,
      { id: 'send', componentId: 'k2', title: 'Vie pöytään', station: 'muu', deps: ['c'] },
    ],
  }
  const menu = run(withService, { type: 'delete_row', kind: 'component', id: 'k1' })
  assert.deepEqual(stepIds(menu), ['send'])
  assert.deepEqual(depsOf(menu, 'send'), [])
  assert.deepEqual(buildIndex(menu).problems, [])
})

test('deleting a course takes its dishes and steps with it, and renumbers the rest', () => {
  const two: Menu = {
    ...base(),
    courses: [
      { id: 'c1', order: 1, name: 'Alkupala' },
      { id: 'c2', order: 2, name: 'Pääruoka' },
    ],
  }
  const menu = run(two, { type: 'delete_row', kind: 'course', id: 'c1' })
  assert.deepEqual(menu.courses, [{ id: 'c2', order: 1, name: 'Pääruoka' }])
  assert.deepEqual(menu.components, [])
  assert.deepEqual(menu.steps, [])
})

test('an ingredient can be added and used by one step in a single action', () => {
  const menu = run(base(), {
    type: 'add_ingredient',
    componentId: 'k1',
    value: 'sipuli',
    alsoUse: 'b',
  })
  assert.deepEqual(menu.components[0].ingredients, ['voita', 'sipuli'])
  assert.deepEqual(menu.steps.find((s) => s.id === 'b')!.uses, ['sipuli'])
})

test('removing an ingredient also stops the steps that were using it', () => {
  const used = run(base(), { type: 'toggle_use', id: 'a', ingredient: 'voita' })
  assert.deepEqual(used.steps[0].uses, ['voita'])
  const menu = run(used, { type: 'remove_ingredient', componentId: 'k1', value: 'voita' })
  assert.deepEqual(menu.components[0].ingredients, [])
  assert.equal(menu.steps[0].uses, undefined)
})

test('renaming an ingredient renames it in place and in the steps that use it', () => {
  const two = run(base(), { type: 'add_ingredient', componentId: 'k1', value: 'sipuli' })
  const used = run(two, { type: 'toggle_use', id: 'a', ingredient: 'voita' })
  const menu = run(used, { type: 'rename_ingredient', componentId: 'k1', from: 'voita', to: ' voi ' })
  assert.deepEqual(menu.components[0].ingredients, ['voi', 'sipuli'])
  assert.deepEqual(menu.steps[0].uses, ['voi'])
})

test("renaming an ingredient leaves another dish's namesake alone", () => {
  const menu: Menu = {
    ...base(),
    components: [
      ...base().components,
      { id: 'k2', courseId: 'c1', name: 'Leipä', ingredients: ['voita'] },
    ],
    steps: [
      ...base().steps,
      { id: 'd', componentId: 'k2', title: 'D', station: 'muu', deps: [], uses: ['voita'] },
    ],
  }
  const renamed = run(menu, { type: 'rename_ingredient', componentId: 'k1', from: 'voita', to: 'voi' })
  assert.deepEqual(renamed.components[1].ingredients, ['voita'])
  assert.deepEqual(renamed.steps.find((s) => s.id === 'd')!.uses, ['voita'])
})

test('renaming an ingredient onto one the dish already lists merges the two', () => {
  const menu: Menu = {
    ...base(),
    components: [{ ...base().components[0], ingredients: ['voi', 'suola', 'voita'] }],
    steps: base().steps.map((s) =>
      s.id === 'a' ? { ...s, uses: ['voi', 'voita'] } : s.id === 'b' ? { ...s, uses: ['voita'] } : s,
    ),
  }
  const merged = run(menu, { type: 'rename_ingredient', componentId: 'k1', from: 'voita', to: 'voi' })
  assert.deepEqual(merged.components[0].ingredients, ['voi', 'suola'])
  assert.deepEqual(merged.steps[0].uses, ['voi'])
  assert.deepEqual(merged.steps[1].uses, ['voi'])
})

test('a rename to nothing, to itself, or of an unknown ingredient changes nothing', () => {
  // The same object back, which is what keeps it from costing an undo step.
  const menu = base()
  for (const [from, to] of [['voita', '  '], ['voita', 'voita'], ['suola', 'sokeri']] as const) {
    assert.equal(run(menu, { type: 'rename_ingredient', componentId: 'k1', from, to }), menu)
  }
})

test('a dependency picker never offers a step that would close a cycle', () => {
  const offered = dependencyCandidates(base(), 'a').map((s) => s.id)
  // B and C are downstream of A, and A is not offered itself.
  assert.deepEqual(offered, [])
  assert.deepEqual(dependencyCandidates(base(), 'c').map((s) => s.id), ['a', 'b'])
})

test('every action leaves the focused row present in the outline', () => {
  const menu = base()
  const actions: MenuAction[] = [
    { type: 'insert_after', kind: 'step', id: 'b' },
    { type: 'insert_after', kind: 'component', id: 'k1' },
    { type: 'insert_after', kind: 'course', id: 'c1' },
    { type: 'delete_row', kind: 'step', id: 'b' },
    { type: 'move', kind: 'step', id: 'c', delta: -1 },
  ]
  for (const action of actions) {
    const result = applyDraftAction(menu, action)
    if (result.focus === null) continue
    const keys = flattenMenu(result.menu).map((r) => r.key)
    assert.ok(keys.includes(result.focus), `${action.type} focused a row that is not there`)
  }
})

test('the outline lists rows in authoring order, course then dish then steps', () => {
  const rows = flattenMenu(base())
  assert.deepEqual(
    rows.map((r) => `${r.depth}:${r.title}`),
    ['0:Alkupala', '1:Keitto', '2:A', '2:B', '2:C'],
  )
  assert.equal(rows[2].siblingCount, 3)
  assert.equal(rows[4].index, 2)
})

test('a row knows how many rows are directly under it', () => {
  // What the editor asks before letting Backspace on an empty title delete the
  // row: a keystroke may take a leaf, never a subtree.
  const rows = flattenMenu(base())
  assert.deepEqual(
    rows.map((r) => [r.kind, r.childCount]),
    [
      ['course', 1],
      ['component', 3],
      ['step', 0],
      ['step', 0],
      ['step', 0],
    ],
  )

  const emptied = run(base(), { type: 'delete_row', kind: 'step', id: 'a' }, { type: 'delete_row', kind: 'step', id: 'b' }, { type: 'delete_row', kind: 'step', id: 'c' })
  assert.equal(flattenMenu(emptied)[1].childCount, 0)
})

test('a row counts everything under it, which is what deleting it takes', () => {
  // A second dish in the course, so the course's count has to add across dishes
  // rather than repeat the first one's.
  const two: Menu = {
    ...base(),
    components: [...base().components, { id: 'k2', courseId: 'c1', name: 'Leipä', ingredients: [] }],
    steps: [...base().steps, { id: 'd', componentId: 'k2', title: 'D', station: 'muu', deps: [] }],
  }
  assert.deepEqual(
    flattenMenu(two).map((r) => [r.title, r.contents]),
    [
      ['Alkupala', { components: 2, steps: 4 }],
      ['Keitto', { components: 0, steps: 3 }],
      ['A', { components: 0, steps: 0 }],
      ['B', { components: 0, steps: 0 }],
      ['C', { components: 0, steps: 0 }],
      ['Leipä', { components: 0, steps: 1 }],
      ['D', { components: 0, steps: 0 }],
    ],
  )
})

test('a new course is appended with the next order number', () => {
  const { menu } = applyDraftAction(base(), { type: 'insert_after', kind: 'course', id: 'c1' })
  assert.deepEqual(menu.courses.map((c) => c.order), [1, 2])
})

test('merging a converted recipe appends its course and focuses it', () => {
  const incoming: Menu = {
    name: 'Pääruoka',
    courses: [{ id: 'c1', order: 1, name: 'Pääruoka' }],
    components: [{ id: 'k1', courseId: 'c1', name: 'Paisti', ingredients: [] }],
    steps: [{ id: 'a', componentId: 'k1', title: 'Paista', station: 'uuni', deps: [] }],
  }
  // Every id collides with the base menu; the merge has to re-key them.
  const { menu, focus } = applyDraftAction(base(), { type: 'merge', incoming })

  assert.deepEqual(menu.courses.map((c) => c.name), ['Alkupala', 'Pääruoka'])
  assert.deepEqual(menu.courses.map((c) => c.order), [1, 2])
  assert.equal(menu.name, 'Illallinen')
  assert.equal(new Set(menu.steps.map((s) => s.id)).size, menu.steps.length)
  assert.equal(focus, rowKey('course', menu.courses[1].id))
  assert.deepEqual(buildIndex(menu).problems, [])
})

/* ------------------------------------------------ the tail rows: first child */

test('an empty course can be given its first dish', () => {
  const empty: Menu = { name: 'Tyhjä', courses: [{ id: 'c1', order: 1, name: 'K' }], components: [], steps: [] }
  const { menu, focus } = applyDraftAction(empty, { type: 'insert_child', kind: 'course', id: 'c1' })
  assert.equal(menu.components.length, 1)
  assert.equal(menu.components[0].courseId, 'c1')
  assert.deepEqual(menu.components[0].ingredients, [])
  assert.equal(focus, rowKey('component', menu.components[0].id))
})

test('an empty dish can be given its first step, which waits for nothing', () => {
  const empty: Menu = {
    name: 'Tyhjä',
    courses: [{ id: 'c1', order: 1, name: 'K' }],
    components: [{ id: 'k1', courseId: 'c1', name: 'Osa', ingredients: [] }],
    steps: [],
  }
  const { menu, focus } = applyDraftAction(empty, { type: 'insert_child', kind: 'component', id: 'k1' })
  assert.equal(menu.steps.length, 1)
  assert.equal(menu.steps[0].componentId, 'k1')
  assert.deepEqual(menu.steps[0].deps, [])
  assert.equal(menu.steps[0].station, 'muu')
  assert.equal(focus, rowKey('step', menu.steps[0].id))
})

test('a first step in a second dish is not chained to the first dish', () => {
  const two = run(base(), { type: 'insert_after', kind: 'component', id: 'k1' })
  const second = two.components[1].id
  const { menu } = applyDraftAction(two, { type: 'insert_child', kind: 'component', id: second })
  const added = menu.steps.find((s) => s.componentId === second)!
  assert.deepEqual(added.deps, [])
  assert.deepEqual(buildIndex(menu).problems, [])
})

test('adding to a dish that already has steps appends and auto-chains', () => {
  // The tail row is "Enter on the last step", so it must chain like one.
  const { menu, focus } = applyDraftAction(base(), { type: 'insert_child', kind: 'component', id: 'k1' })
  const added = menu.steps[menu.steps.length - 1]
  assert.deepEqual(added.deps, ['c'])
  assert.equal(focus, rowKey('step', added.id))
})

test('adding to a course that already has dishes appends a sibling at the end', () => {
  const { menu, focus } = applyDraftAction(base(), { type: 'insert_child', kind: 'course', id: 'c1' })
  assert.equal(menu.components.length, 2)
  assert.equal(menu.components[1].courseId, 'c1')
  assert.equal(focus, rowKey('component', menu.components[1].id))
})

test('a course can be added to a menu that has none left', () => {
  const bare = run(base(), { type: 'delete_row', kind: 'course', id: 'c1' })
  assert.deepEqual(bare.courses, [])
  const { menu, focus } = applyDraftAction(bare, { type: 'add_course' })
  assert.deepEqual(menu.courses.map((c) => c.order), [1])
  assert.equal(focus, rowKey('course', menu.courses[0].id))
})

test('a whole menu can be built from nothing but the tail rows', () => {
  let menu: Menu = { name: 'Alusta', courses: [], components: [], steps: [] }
  const step = (action: MenuAction) => {
    const result = applyDraftAction(menu, action)
    menu = result.menu
    return result.focus
  }

  step({ type: 'add_course' })
  const courseId = menu.courses[0].id
  step({ type: 'rename', kind: 'course', id: courseId, value: 'Alkupala' })
  step({ type: 'insert_child', kind: 'course', id: courseId })
  const componentId = menu.components[0].id
  step({ type: 'rename', kind: 'component', id: componentId, value: 'Keitto' })
  step({ type: 'insert_child', kind: 'component', id: componentId })
  step({ type: 'rename', kind: 'step', id: menu.steps[0].id, value: 'Pilko' })
  step({ type: 'insert_child', kind: 'component', id: componentId })
  step({ type: 'rename', kind: 'step', id: menu.steps[1].id, value: 'Keitä' })

  assert.deepEqual(
    flattenMenu(menu).map((r) => `${r.depth}:${r.title}`),
    ['0:Alkupala', '1:Keitto', '2:Pilko', '2:Keitä'],
  )
  // Typed top to bottom, so the chain is there without any dependency work.
  assert.deepEqual(depsOf(menu, menu.steps[1].id), [menu.steps[0].id])
  assert.deepEqual(buildIndex(menu).problems, [])
})
