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

test('promoting a step turns it into a dish and takes the steps below it along', () => {
  const { menu, focus } = applyDraftAction(base(), { type: 'promote_step', id: 'b' })
  const created = menu.components.find((c) => c.id !== 'k1')!
  assert.equal(created.name, 'B')
  assert.equal(focus, rowKey('component', created.id))
  // A stays behind; C moves under the new dish and starts it.
  assert.deepEqual(
    menu.steps.filter((s) => s.componentId === 'k1').map((s) => s.id),
    ['a'],
  )
  assert.deepEqual(
    menu.steps.filter((s) => s.componentId === created.id).map((s) => s.id),
    ['c'],
  )
  // B stopped being work and became a heading, so C inherits what B was waiting
  // for rather than losing the ordering the author typed. The dependency now
  // crosses dishes, which is ordinary.
  assert.deepEqual(depsOf(menu, 'c'), ['a'])
  assert.deepEqual(buildIndex(menu).problems, [])
})

test('demoting a dish folds it back into the one above, as a step', () => {
  const promoted = applyDraftAction(base(), { type: 'promote_step', id: 'b' }).menu
  const created = promoted.components.find((c) => c.id !== 'k1')!
  const { menu } = applyDraftAction(promoted, { type: 'demote_component', id: created.id })

  assert.deepEqual(menu.components.map((c) => c.id), ['k1'])
  const titles = menu.steps.filter((s) => s.componentId === 'k1').map((s) => s.title)
  assert.deepEqual(titles, ['A', 'B', 'C'])
  assert.deepEqual(buildIndex(menu).problems, [])
})

test('a dish with nothing above it cannot be demoted', () => {
  const menu = run(base(), { type: 'demote_component', id: 'k1' })
  assert.deepEqual(menu.components.map((c) => c.id), ['k1'])
  assert.deepEqual(stepIds(menu), ['a', 'b', 'c'])
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
    { type: 'promote_step', id: 'b' },
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

test('a new course is appended with the next order number', () => {
  const { menu } = applyDraftAction(base(), { type: 'insert_after', kind: 'course', id: 'c1' })
  assert.deepEqual(menu.courses.map((c) => c.order), [1, 2])
})
