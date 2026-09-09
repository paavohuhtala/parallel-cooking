import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { KitchenState } from '../model/types.ts'
import { MENU } from '../data/menu.ts'
import { buildIndex } from '../state/graph.ts'
import { applyCommand, initialState, type ApplyResult } from './apply.ts'
import type { Command } from './protocol.ts'

const index = buildIndex(MENU)

let seq = 0
const env = (cmd: Command, at = 1_000) => ({
  id: `00000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`,
  at,
  cmd,
})

const run = (state: KitchenState, cmd: Command, at?: number): ApplyResult =>
  applyCommand(index, state, env(cmd, at))

/** Applies a chain, asserting each step succeeds. */
function apply(state: KitchenState, ...cmds: Command[]): KitchenState {
  for (const cmd of cmds) {
    const r = run(state, cmd)
    assert.equal(r.ok, true, `expected ${cmd.type} to apply: ${r.ok ? '' : r.reason}`)
    if (r.ok) state = r.state
  }
  return state
}

const COOK_A = initialState().cooks[0].id
const COOK_B = initialState().cooks[1].id

test('a step with unmet dependencies cannot start', () => {
  const r = run(initialState(), { type: 'set_step_state', stepId: 'soup-roast', next: 'active', cookId: COOK_A })
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.reason, /^Odottaa:/)
})

test('finishing a dependency unblocks the next step', () => {
  const state = apply(
    initialState(),
    { type: 'set_step_state', stepId: 'soup-mushrooms', next: 'done', cookId: COOK_A },
    { type: 'set_step_state', stepId: 'soup-roast', next: 'active', cookId: COOK_A },
  )
  assert.equal(state.steps['soup-roast'].state, 'active')
})

test('a done step cannot be undone while something downstream has started', () => {
  const state = apply(
    initialState(),
    { type: 'set_step_state', stepId: 'soup-mushrooms', next: 'done', cookId: COOK_A },
    { type: 'set_step_state', stepId: 'soup-roast', next: 'active', cookId: COOK_A },
  )
  const r = run(state, { type: 'set_step_state', stepId: 'soup-mushrooms', next: 'todo' })
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.reason, /^Kumoa ensin:/)
})

test('timestamps come from the envelope, not the clock', () => {
  let state = apply(initialState())
  const start = run(state, { type: 'set_step_state', stepId: 'bru-oil', next: 'active', cookId: COOK_A }, 5_000)
  assert.equal(start.ok, true)
  state = start.ok ? start.state : state
  assert.equal(state.steps['bru-oil'].startedAt, 5_000)

  // Re-entering `active` keeps the original start.
  const again = run(state, { type: 'set_step_state', stepId: 'bru-oil', next: 'active', cookId: COOK_A }, 9_000)
  state = again.ok ? again.state : state
  assert.equal(state.steps['bru-oil'].startedAt, 5_000)

  const done = run(state, { type: 'set_step_state', stepId: 'bru-oil', next: 'done', cookId: COOK_A }, 9_000)
  state = done.ok ? done.state : state
  assert.equal(state.steps['bru-oil'].completedAt, 9_000)
  assert.equal(state.steps['bru-oil'].startedAt, 5_000)
})

test('a second cook cannot claim a step that is already active', () => {
  const state = apply(initialState(), {
    type: 'set_step_state', stepId: 'soup-onions', next: 'active', cookId: COOK_A,
  })
  const r = run(state, { type: 'set_step_state', stepId: 'soup-onions', next: 'active', cookId: COOK_B })
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.reason, /aloitti tämän jo/)

  // The holder re-sending their own claim is a no-op, not a conflict — this is
  // what makes replaying the pending queue after a reconnect safe.
  const again = run(state, { type: 'set_step_state', stepId: 'soup-onions', next: 'active', cookId: COOK_A })
  assert.equal(again.ok, true)
})

test('explicit reassignment of an active step is allowed', () => {
  const state = apply(
    initialState(),
    { type: 'set_step_state', stepId: 'soup-onions', next: 'active', cookId: COOK_A },
    { type: 'assign', stepId: 'soup-onions', cookId: COOK_B },
  )
  assert.equal(state.steps['soup-onions'].cookId, COOK_B)
})

test('add_cook is idempotent', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const once = apply(initialState(), { type: 'add_cook', cookId: id })
  const twice = apply(once, { type: 'add_cook', cookId: id })
  assert.equal(twice.cooks.length, 3)
  assert.deepEqual(twice.cooks, once.cooks)
})

test('removing a cook unassigns their steps', () => {
  const state = apply(
    initialState(),
    { type: 'set_step_state', stepId: 'soup-onions', next: 'active', cookId: COOK_A },
    { type: 'remove_cook', cookId: COOK_A },
  )
  assert.equal(state.cooks.length, 1)
  assert.equal(state.steps['soup-onions'].cookId, null)
  assert.equal(state.steps['soup-onions'].state, 'active')
})

test('the last cook cannot be removed', () => {
  const state = apply(initialState(), { type: 'remove_cook', cookId: COOK_A })
  const r = run(state, { type: 'remove_cook', cookId: COOK_B })
  assert.equal(r.ok, false)
})

test('unknown steps and cooks are rejected', () => {
  assert.equal(run(initialState(), { type: 'set_step_state', stepId: 'nope', next: 'done' }).ok, false)
  assert.equal(run(initialState(), { type: 'assign', stepId: 'bru-oil', cookId: 'nobody' }).ok, false)
})

test('renaming a cook that no longer exists is a no-op', () => {
  const state = initialState()
  const r = run(state, { type: 'rename_cook', cookId: 'ghost', name: 'Haamu' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.ok ? r.state : null, state)
})
