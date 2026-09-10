import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Menu } from '../model/types.ts'
import {
  applyHistory,
  canRedo,
  canUndo,
  initialHistory,
  HISTORY_LIMIT,
  type DraftHistory,
} from './draftHistory.ts'
import type { MenuAction } from './menuDraft.ts'

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

const edit = (history: DraftHistory, ...actions: MenuAction[]): DraftHistory =>
  actions.reduce((h, action) => applyHistory(h, { type: 'apply', action }).state, history)

const undo = (history: DraftHistory): DraftHistory => applyHistory(history, { type: 'undo' }).state
const redo = (history: DraftHistory): DraftHistory => applyHistory(history, { type: 'redo' }).state

const titles = (menu: Menu) => menu.steps.map((s) => s.title)
const type = (id: string, text: string): MenuAction[] =>
  [...text].map((_, i) => ({ type: 'rename', kind: 'step', id, value: text.slice(0, i + 1) }))

test('undo puts back a deleted step, and redo takes it away again', () => {
  const start = initialHistory(base())
  const deleted = edit(start, { type: 'delete_row', kind: 'step', id: 'b' })
  assert.deepEqual(titles(deleted.menu), ['A', 'C'])

  const back = undo(deleted)
  assert.deepEqual(titles(back.menu), ['A', 'B', 'C'])
  // The chain is restored with it, not just the row.
  assert.deepEqual(back.menu.steps.find((s) => s.id === 'c')!.deps, ['b'])

  assert.deepEqual(titles(redo(back).menu), ['A', 'C'])
})

test('undo puts back a course with everything that was under it', () => {
  const gone = edit(initialHistory(base()), { type: 'delete_row', kind: 'course', id: 'c1' })
  assert.deepEqual(gone.menu.courses, [])
  assert.deepEqual(gone.menu.steps, [])

  const back = undo(gone).menu
  assert.deepEqual(back.courses.length, 1)
  assert.deepEqual(back.components.length, 1)
  assert.deepEqual(titles(back), ['A', 'B', 'C'])
})

test('a run of typing in one field is a single undo step', () => {
  const typed = edit(initialHistory(base()), ...type('a', 'Pilko sipuli'))
  assert.deepEqual(titles(typed.menu), ['Pilko sipuli', 'B', 'C'])
  assert.equal(typed.past.length, 1)
  assert.deepEqual(titles(undo(typed).menu), ['A', 'B', 'C'])
})

test('typing in a second field starts a second step, so undo walks back field by field', () => {
  const typed = edit(initialHistory(base()), ...type('a', 'Eka'), ...type('b', 'Toka'))
  assert.deepEqual(titles(typed.menu), ['Eka', 'Toka', 'C'])

  const once = undo(typed)
  assert.deepEqual(titles(once.menu), ['Eka', 'B', 'C'])
  assert.deepEqual(titles(undo(once).menu), ['A', 'B', 'C'])
})

test('a structural action between two runs of typing is never coalesced into them', () => {
  const history = edit(
    initialHistory(base()),
    ...type('a', 'Eka'),
    { type: 'move', kind: 'step', id: 'c', delta: -1 },
    ...type('a', 'Ekax'),
  )
  // Three steps back: the second run, the move, the first run.
  assert.equal(history.past.length, 3)
  const afterMove = undo(history)
  assert.deepEqual(titles(afterMove.menu), ['Eka', 'C', 'B'])
  assert.deepEqual(titles(undo(afterMove).menu), ['Eka', 'B', 'C'])
})

test('an action that changes nothing costs no undo step', () => {
  // A move past the end of a list returns the menu it was given.
  const history = edit(initialHistory(base()), { type: 'move', kind: 'step', id: 'a', delta: -1 })
  assert.equal(history.past.length, 0)
  assert.equal(canUndo(history), false)
})

test('editing after an undo abandons the redo branch', () => {
  const history = edit(initialHistory(base()), { type: 'delete_row', kind: 'step', id: 'b' })
  const back = undo(history)
  assert.equal(canRedo(back), true)

  const diverged = edit(back, { type: 'delete_row', kind: 'step', id: 'c' })
  assert.equal(canRedo(diverged), false)
  assert.deepEqual(titles(diverged.menu), ['A', 'B'])
})

test('undo and redo on an empty stack are no-ops rather than errors', () => {
  const start = initialHistory(base())
  assert.equal(undo(start), start)
  assert.equal(redo(start), start)
  assert.equal(canUndo(start), false)
  assert.equal(canRedo(start), false)
})

test('a save can be undone past, and closes any run of typing', () => {
  const typed = edit(initialHistory(base()), ...type('a', 'Eka'))
  const stored = applyHistory(typed, { type: 'replace', menu: typed.menu }).state
  assert.equal(stored.group, null)

  // Typing again after the save is its own step, not a continuation of the run
  // that the save closed.
  const after = edit(stored, ...type('a', 'Toka'))
  assert.equal(after.past.length, 2)
  assert.deepEqual(titles(undo(after).menu), ['Eka', 'B', 'C'])
})

test('the stack drops its oldest entry rather than refusing a new one', () => {
  let history = initialHistory(base())
  for (let n = 0; n < HISTORY_LIMIT + 10; n++) {
    history = edit(history, { type: 'insert_after', kind: 'step', id: 'a' })
  }
  assert.equal(history.past.length, HISTORY_LIMIT)

  // Undoing everything the stack still holds never lands on a broken document.
  let unwound = history
  while (canUndo(unwound)) unwound = undo(unwound)
  assert.equal(unwound.menu.steps.length, 3 + 10)
})

test('merging a recipe is one step, so the wrong one can be taken back whole', () => {
  const incoming: Menu = {
    name: 'Pääruoka',
    courses: [{ id: 'x1', order: 1, name: 'Pääruoka' }],
    components: [{ id: 'x2', courseId: 'x1', name: 'Kala', ingredients: [] }],
    steps: [{ id: 'x3', componentId: 'x2', title: 'Paista kala', station: 'liesi', deps: [] }],
  }
  const merged = edit(initialHistory(base()), { type: 'merge', incoming })
  assert.equal(merged.menu.courses.length, 2)
  assert.equal(merged.past.length, 1)

  const back = undo(merged).menu
  assert.equal(back.courses.length, 1)
  assert.deepEqual(titles(back), ['A', 'B', 'C'])
})
