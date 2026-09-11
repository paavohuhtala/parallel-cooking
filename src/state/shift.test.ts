import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { KitchenState, Menu, Step, StepRecord } from '../model/types.ts'
import { buildIndex } from './graph.ts'
import {
  activeFor,
  justUnblocked,
  oneStepAway,
  rankReady,
  WEIGHT,
  type ShiftPick,
} from './shift.ts'

/*
 * Two dishes in one course. `soup` is a straight line of four; `bread` is a
 * straight line of three that nothing in `soup` waits for. That is enough to
 * put two dishes' worth of work in `ready` at the same moment, which is the
 * situation the whole module exists for.
 */
const STEPS: Step[] = [
  { id: 's1', componentId: 'soup', title: 'Pilko sipuli', station: 'muu', deps: [] },
  { id: 's2', componentId: 'soup', title: 'Kuullota', station: 'liesi', deps: ['s1'] },
  { id: 's3', componentId: 'soup', title: 'Lisää liemi', station: 'liesi', deps: ['s2'] },
  { id: 's4', componentId: 'soup', title: 'Soseuta', station: 'liesi', deps: ['s3'] },
  { id: 'b1', componentId: 'bread', title: 'Siivuta leipä', station: 'muu', deps: [] },
  { id: 'b2', componentId: 'bread', title: 'Kuumenna uuni', station: 'uuni', deps: ['b1'] },
  { id: 'b3', componentId: 'bread', title: 'Paahda', station: 'uuni', deps: ['b2'] },
]

/** A menu around whatever steps it is given; components follow the ids used. */
const build = (steps: Step[]): Menu => ({
  name: 'Illallinen',
  courses: [{ id: 'c1', order: 1, name: 'Alkupala' }],
  components: [...new Set(steps.map((s) => s.componentId))].map((id) => ({
    id,
    courseId: 'c1',
    name: id,
    ingredients: [],
  })),
  steps,
})

/** The two-dish fixture, with named steps optionally amended. */
const menu = (over: Partial<Step>[] = []): Menu =>
  build(STEPS.map((s) => ({ ...s, ...over.find((o) => o.id === s.id) })))

const kitchen = (steps: Record<string, Partial<StepRecord>> = {}): KitchenState => ({
  cooks: [
    { id: 'anna', name: 'Anna', color: '#b5533f' },
    { id: 'pekka', name: 'Pekka', color: '#3f7bb5' },
  ],
  steps: Object.fromEntries(
    Object.entries(steps).map(([id, r]) => [id, { state: 'todo', cookId: null, ...r }]),
  ),
})

const ids = (picks: ShiftPick[]) => picks.map((p) => p.step.id)
const scoreOf = (picks: ShiftPick[], id: string) => picks.find((p) => p.step.id === id)!.score

test('with nothing going, the longest remaining chain leads', () => {
  const m = menu()
  const picks = rankReady(m, buildIndex(m), kitchen(), 'anna')

  // s1 opens four steps, b1 opens three; everything else is still blocked.
  assert.deepEqual(ids(picks), ['s1', 'b1'])
  assert.deepEqual(picks[0].reason, { kind: 'chain', opens: 3 })
  assert.deepEqual(picks[1].reason, { kind: 'chain', opens: 2 })
})

test('the dish you are already in beats a longer chain elsewhere', () => {
  // The bread forks after slicing, so Anna can have one branch going while the
  // other sits ready in the same dish. A straight line could not show this.
  const m = build([
    { id: 's1', componentId: 'soup', title: 'Pilko sipuli', station: 'muu', deps: [] },
    { id: 's2', componentId: 'soup', title: 'Kuullota', station: 'liesi', deps: ['s1'] },
    { id: 's3', componentId: 'soup', title: 'Lisää liemi', station: 'liesi', deps: ['s2'] },
    { id: 's4', componentId: 'soup', title: 'Soseuta', station: 'liesi', deps: ['s3'] },
    { id: 'b1', componentId: 'bread', title: 'Siivuta leipä', station: 'muu', deps: [] },
    { id: 'b2', componentId: 'bread', title: 'Kuumenna uuni', station: 'uuni', deps: ['b1'] },
    { id: 'b3', componentId: 'bread', title: 'Tee öljy', station: 'uuni', deps: ['b1'] },
  ])
  // Anna is on the bread; the soup's next step has the longer chain by far.
  const state = kitchen({
    b1: { state: 'done', cookId: 'anna' },
    b2: { state: 'active', cookId: 'anna' },
  })
  const picks = rankReady(m, buildIndex(m), state, 'anna')

  assert.deepEqual(ids(picks), ['b3', 's1'])
  assert.deepEqual(picks[0].reason, { kind: 'continues', componentId: 'bread' })

  // And it is the continuity bonus doing it, not an accident of chain lengths:
  // b3 opens nothing at all, s1 opens three.
  assert.equal(scoreOf(picks, 'b3'), WEIGHT.chain * 1 + WEIGHT.continues + WEIGHT.station)
  assert.equal(scoreOf(picks, 's1'), WEIGHT.chain * 4)
})

test('the dish you finished last still counts, but the station does not', () => {
  const m = menu()
  const state = kitchen({
    b1: { state: 'done', cookId: 'anna', completedAt: 200 },
    s1: { state: 'done', cookId: 'anna', completedAt: 100 },
  })
  const picks = rankReady(m, buildIndex(m), state, 'anna')

  // Both s2 and b2 are ready. b2 wins on the bread's continuity even though
  // s2 sits on a chain three steps long — but b2 gets no station bonus, since
  // Anna is not standing at the oven, only lately near it.
  assert.deepEqual(ids(picks), ['b2', 's2'])
  assert.deepEqual(picks[0].reason, { kind: 'continues', componentId: 'bread' })
  assert.equal(scoreOf(picks, 'b2'), WEIGHT.chain * 2 + WEIGHT.continues)
})

test('sharing the "muu" bucket is not sharing a station', () => {
  // Anna is chopping (muu); so is b1. That is not standing in the same place —
  // `muu` is what a step gets when no contended equipment is involved.
  const m = menu()
  const state = kitchen({ s1: { state: 'active', cookId: 'anna' } })
  const picks = rankReady(m, buildIndex(m), state, 'anna')

  assert.equal(scoreOf(picks, 'b1'), WEIGHT.chain * 3)
  assert.deepEqual(picks.find((p) => p.step.id === 'b1')!.reason, { kind: 'chain', opens: 2 })
})

test('a hold point sinks, and says so', () => {
  const m = menu([{ id: 'b1', holdPoint: true }])
  const picks = rankReady(m, buildIndex(m), kitchen(), 'anna')

  assert.deepEqual(ids(picks), ['s1', 'b1'])
  assert.deepEqual(picks[1].reason, { kind: 'hold' })
  assert.equal(scoreOf(picks, 'b1'), WEIGHT.chain * 3 + WEIGHT.hold)
})

test("another cook's work is listed but never offered", () => {
  const m = menu()
  // Pekka's name is on the step with by far the longest chain.
  const state = kitchen({ s1: { cookId: 'pekka' } })
  const picks = rankReady(m, buildIndex(m), state, 'anna')

  assert.deepEqual(ids(picks), ['b1', 's1'])
  assert.equal(picks[0].offered, true)
  assert.equal(picks[1].offered, false)
})

test('your own name on a step is a reason, and it outranks a bare chain', () => {
  const m = menu()
  const state = kitchen({ b1: { cookId: 'anna' } })
  const picks = rankReady(m, buildIndex(m), state, 'anna')

  // b1 (chain 3, + assigned) edges out s1 (chain 4) — 37 to 16.
  assert.deepEqual(ids(picks), ['b1', 's1'])
  assert.deepEqual(picks[0].reason, { kind: 'assigned' })
  assert.equal(picks[0].offered, true)
})

test('equal scores break on dependency order, so the list is stable', () => {
  // Two dishes of identical shape: nothing but the topo order separates them.
  const m = build([
    { id: 'x1', componentId: 'x', title: 'X1', station: 'muu', deps: [] },
    { id: 'y1', componentId: 'y', title: 'Y1', station: 'muu', deps: [] },
  ])
  const picks = rankReady(m, buildIndex(m), kitchen(), 'anna')

  assert.equal(scoreOf(picks, 'x1'), scoreOf(picks, 'y1'))
  assert.deepEqual(ids(picks), ['x1', 'y1'])
})

test('nobody is offered anything when nobody has said who they are', () => {
  const m = menu()
  const state = kitchen({ s1: { cookId: 'anna' } })
  const picks = rankReady(m, buildIndex(m), state, null)

  // With no `me`, an assigned step belongs to somebody else by definition.
  assert.equal(picks.find((p) => p.step.id === 's1')!.offered, false)
  assert.deepEqual(picks[0].reason, { kind: 'chain', opens: 2 })
})

test('active work is this cook\'s own, in dependency order', () => {
  const m = menu()
  const index = buildIndex(m)
  const state = kitchen({
    s1: { state: 'done', cookId: 'anna' },
    s2: { state: 'active', cookId: 'anna' },
    b1: { state: 'active', cookId: 'anna' },
    b2: { state: 'active', cookId: 'pekka' },
  })

  assert.deepEqual(
    activeFor(m, index, state, 'anna').map((s) => s.id),
    ['b1', 's2'],
  )
  assert.deepEqual(activeFor(m, index, state, null), [])
})

test('one step away means every blocker is already under way', () => {
  const m = menu()
  const index = buildIndex(m)
  const state = kitchen({
    s1: { state: 'active', cookId: 'pekka' },
    b1: { state: 'done', cookId: 'anna' },
    b2: { state: 'active', cookId: 'anna' },
  })
  const waiting = oneStepAway(m, index, state)

  // s2 waits on an active s1; b3 waits on an active b2. s3 waits on s2, which
  // has not started, so it is two steps away and not listed.
  assert.deepEqual(
    waiting.map((w) => [w.step.id, w.blockers.map((b) => b.id)]),
    [
      ['s2', ['s1']],
      ['b3', ['b2']],
    ],
  )
})

test('a step behind one active and one untouched dependency is not one step away', () => {
  const m = menu([{ id: 'b3', deps: ['b2', 's1'] }])
  const state = kitchen({ b1: { state: 'done' }, b2: { state: 'active', cookId: 'anna' } })
  const waiting = oneStepAway(m, buildIndex(m), state)

  assert.deepEqual(waiting.map((w) => w.step.id), [])
})

test('finishing a step reports what it opened, and only what it opened', () => {
  const m = menu([{ id: 'b2', deps: ['b1', 's1'] }])
  const index = buildIndex(m)

  // Both s2 and b2 hang off s1, but b2 also waits on b1: finishing s1 alone
  // frees one of them and must not claim the other.
  assert.deepEqual(
    justUnblocked(index, kitchen({ s1: { state: 'done' } }), 's1').map((s) => s.id),
    ['s2'],
  )

  const both = kitchen({ s1: { state: 'done' }, b1: { state: 'done' } })
  assert.deepEqual(
    justUnblocked(index, both, 's1').map((s) => s.id),
    ['s2', 'b2'],
  )
})
