import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Menu, Step } from '../model/types.ts'
import { outlineGutter, type Gutter } from './lanes.ts'
import { outlineItems } from './menuDraft.ts'

/*
 * Outline rows for a two-dish course, as the editor lists them:
 *
 *    0  course c1
 *    1    dish soup
 *    2      s1
 *    3      s2
 *    4      s3
 *    5      + Vaihe
 *    6    dish bread
 *    7      b1
 *    8      b2
 *    9      + Vaihe
 *   10    + Osa
 *   11  + Ruokalaji
 */
const step = (id: string, componentId: string, deps: string[] = []): Step => ({
  id,
  componentId,
  title: id,
  station: 'muu',
  deps,
})

const menu = (steps: Step[]): Menu => ({
  name: 'Illallinen',
  courses: [{ id: 'c1', order: 1, name: 'Alkupala' }],
  components: [
    { id: 'soup', courseId: 'c1', name: 'Keitto', ingredients: [] },
    { id: 'bread', courseId: 'c1', name: 'Leipä', ingredients: [] },
  ],
  steps,
})

const gutter = (steps: Step[], collapsed: string[] = []): Gutter => {
  const m = menu(steps)
  return outlineGutter(m, outlineItems(m, new Set(collapsed)))
}

/** A lane as `source→targets`, by row, for compact assertions. */
const laneSummary = (g: Gutter) =>
  g.lanes.map((l) => `${l.source}→${l.targets.join(',')}${l.up ? ' up' : ''} @${l.column}`)

test('the default chain is all trunk and takes one column', () => {
  const g = gutter([
    step('s1', 'soup'),
    step('s2', 'soup', ['s1']),
    step('s3', 'soup', ['s2']),
    step('b1', 'bread'),
    step('b2', 'bread', ['b1']),
  ])
  assert.deepEqual(g.lanes, [])
  assert.equal(g.columns, 1)
  assert.deepEqual(
    [2, 3, 4].map((r) => [g.rows[r].trunkIn, g.rows[r].trunkOut]),
    [
      [false, true],
      [true, true],
      [true, false],
    ],
  )
})

test('a step that waits for nothing breaks the trunk', () => {
  const g = gutter([step('s1', 'soup'), step('s2', 'soup'), step('s3', 'soup', ['s2'])])
  assert.equal(g.rows[2].trunkOut, false)
  assert.equal(g.rows[3].trunkIn, false)
  assert.equal(g.rows[3].trunkOut, true)
  assert.deepEqual(g.lanes, [])
})

test('the trunk never crosses into the next dish', () => {
  // b1 is the next step in the document, but a tail row and a dish heading
  // stand between them: waiting on another dish is always an exception.
  const g = gutter([step('s1', 'soup'), step('b1', 'bread', ['s1'])])
  assert.equal(g.rows[2].trunkOut, false)
  assert.deepEqual(laneSummary(g), ['2→5 @1'])
})

test('a dependency further up gets a lane from its source to its target', () => {
  const g = gutter([step('s1', 'soup'), step('s2', 'soup'), step('s3', 'soup', ['s1', 's2'])])
  assert.deepEqual(laneSummary(g), ['2→4 @1'])
  assert.equal(g.columns, 2)
  const [source, passing, target] = [2, 3, 4].map((r) => g.rows[r].cells[0])
  assert.deepEqual(
    [source.above, source.below, source.branch],
    [false, true, 'below'],
    'leaves its source downwards',
  )
  assert.deepEqual([passing.above, passing.below, passing.branch], [true, true, null])
  assert.deepEqual([target.above, target.below, target.branch], [true, false, 'above'])
  // s2 → s3 is still the plain chain beside it.
  assert.equal(g.rows[4].trunkIn, true)
})

test('one dependency used twice is one lane with two branches', () => {
  const g = gutter([
    step('s1', 'soup'),
    step('s2', 'soup'),
    step('s3', 'soup', ['s2', 's1']),
    step('b1', 'bread', ['s1']),
  ])
  assert.deepEqual(laneSummary(g), ['2→4,7 @1'])
  // The middle target branches off and the lane carries on past it.
  const tap = g.rows[4].cells[0]
  assert.deepEqual([tap.above, tap.below, tap.branch], [true, true, 'above'])
  // Headings and tails in between just let it pass.
  assert.deepEqual(
    [5, 6].map((r) => g.rows[r].cells.map((c) => [c.above, c.below, c.branch])),
    [[[true, true, null]], [[true, true, null]]],
  )
})

test('a line takes the colour of the dish it comes from', () => {
  // 0 course, 1 soup, 2 s1, 3 + Vaihe, 4 bread, 5 b1, …
  const g = gutter([step('s1', 'soup'), step('b1', 'bread', ['s1'])])
  assert.equal(g.lanes[0].color, 0, 'soup is the first dish')
  assert.equal(g.rows[5].node?.color, 1, 'the node keeps its own dish colour')
  assert.deepEqual(
    g.rows.flatMap((r, i) => (r.marker === null ? [] : [[i, r.marker]])),
    [
      [1, 0],
      [4, 1],
    ],
  )
})

test('waiting for something listed below runs up, attaching from below', () => {
  // The plates are laid in the last dish of a course and needed in the first.
  // 0 course, 1 soup, 2 s1, 3 s2, 4 + Vaihe, 5 bread, 6 b1, …
  const g = gutter([step('s1', 'soup', ['b1']), step('s2', 'soup', ['s1']), step('b1', 'bread')])
  assert.deepEqual(laneSummary(g), ['6→2 up @1'])
  assert.equal(g.lanes[0].color, 1, "bread's colour, where the line comes from")
  const [target, source] = [g.rows[2].cells[0], g.rows[6].cells[0]]
  assert.deepEqual([target.above, target.below, target.branch], [false, true, 'below'])
  assert.deepEqual([source.above, source.below, source.branch], [true, false, 'above'])
})

test('shorter lanes sit nearer the trunk, and lanes that touch never share a column', () => {
  const g = gutter([
    step('s1', 'soup'),
    step('s2', 'soup'),
    step('s3', 'soup', ['s1']),
    step('b1', 'bread', ['s3', 's2']),
  ])
  // s1→s3 is the shortest; s2→b1 overlaps it; s3→b1 starts where s1→s3 ends.
  assert.deepEqual(laneSummary(g).sort(), ['2→4 @1', '3→7 @3', '4→7 @2'])
  assert.equal(g.columns, 4)
})

test('a collapsed dish stands in for its steps', () => {
  const g = gutter(
    [step('s1', 'soup'), step('s2', 'soup', ['s1']), step('b1', 'bread', ['s2'])],
    ['component:soup'],
  )
  // 0 course, 1 soup (collapsed), 2 bread, 3 b1, …
  assert.deepEqual(g.rows[1].node, { group: true, color: 0 })
  assert.equal(g.rows[1].marker, null, 'a collapsed dish is a node, not a heading')
  assert.deepEqual(laneSummary(g), ['1→3 @1'])
})

test('a collapsed course mixes dishes and keeps only lines leaving it', () => {
  const m: Menu = {
    ...menu([step('s1', 'soup'), step('b1', 'bread', ['s1']), step('m1', 'main', ['b1'])]),
    courses: [
      { id: 'c1', order: 1, name: 'Alkupala' },
      { id: 'c2', order: 2, name: 'Pääruoka' },
    ],
  }
  m.components.push({ id: 'main', courseId: 'c2', name: 'Liha', ingredients: [] })
  const g = outlineGutter(m, outlineItems(m, new Set(['course:c1'])))
  // 0 c1 (collapsed), 1 c2, 2 main, 3 m1, …
  assert.deepEqual(g.rows[0].node, { group: true, color: null })
  assert.deepEqual(laneSummary(g), ['0→3 @1'])
  assert.equal(g.lanes[0].color, 1, "the bread step's colour, not the course's")
})
