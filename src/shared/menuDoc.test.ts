import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Menu } from '../model/types.ts'
import { MENU } from '../data/menu.ts'
import { buildIndex } from '../state/graph.ts'
import {
  errorsOf,
  mergeMenus,
  normalizeMenu,
  slugify,
  toExportDoc,
  uniqueId,
  validateMenu,
  type LooseMenu,
} from './menuDoc.ts'

/** The same two-step dish, written nested and written flat. */
const NESTED: LooseMenu = {
  name: 'Illallinen',
  courses: [
    {
      name: 'Alkupala',
      components: [
        {
          name: 'Kantarellikeitto',
          ingredients: ['voita'],
          steps: [
            { title: 'Puhdista kantarellit' },
            { title: 'Paahda sienet', station: 'liesi', deps: ['Puhdista kantarellit'] },
          ],
        },
      ],
    },
  ],
}

const FLAT: LooseMenu = {
  name: 'Illallinen',
  courses: [{ id: 'alkupala', order: 1, name: 'Alkupala' }],
  components: [
    {
      id: 'kantarellikeitto',
      courseId: 'alkupala',
      name: 'Kantarellikeitto',
      ingredients: ['voita'],
    },
  ],
  steps: [
    { id: 'puhdista-kantarellit', componentId: 'kantarellikeitto', title: 'Puhdista kantarellit' },
    {
      id: 'paahda-sienet',
      componentId: 'kantarellikeitto',
      title: 'Paahda sienet',
      station: 'liesi',
      deps: ['puhdista-kantarellit'],
    },
  ],
}

test('a nested document and its flat equivalent normalize to the same menu', () => {
  assert.deepEqual(normalizeMenu(NESTED).menu, normalizeMenu(FLAT).menu)
})

test('dependencies written as titles resolve to step ids', () => {
  const { menu } = normalizeMenu(NESTED)
  const roast = menu.steps.find((s) => s.title === 'Paahda sienet')!
  assert.deepEqual(roast.deps, ['puhdista-kantarellit'])
  assert.deepEqual(buildIndex(menu).problems, [])
})

test('a title matching two steps is left unresolved and reported, not guessed', () => {
  const { menu, notes } = normalizeMenu({
    name: 'M',
    courses: [
      {
        name: 'Kurssi',
        components: [
          {
            name: 'Osa',
            steps: [
              { id: 'a', title: 'Pilko' },
              { id: 'b', title: 'Pilko' },
              { id: 'c', title: 'Paista', deps: ['Pilko'] },
            ],
          },
        ],
      },
    ],
  })
  assert.deepEqual(menu.steps.find((s) => s.id === 'c')!.deps, ['Pilko'])
  assert.match(notes.join(' '), /osuu useaan vaiheeseen/)
  // It survives as a dangling reference, so the author is told rather than
  // silently given a coin-flip between two steps with the same name.
  assert.ok(errorsOf(validateMenu(menu)).some((p) => p.code === 'unknown_dep'))
})

test('Finnish letters slugify to ascii, and colliding slugs get a suffix', () => {
  assert.equal(slugify('Kuori ja pilko sipuli'), 'kuori-ja-pilko-sipuli')
  assert.equal(slugify('Ähtäri & Öljy'), 'ahtari-oljy')
  assert.equal(slugify('!!!'), '')
  assert.equal(uniqueId('a', new Set(['a', 'a-2'])), 'a-3')
})

test('an id declared late is never stolen by an earlier generated one', () => {
  // Without reserving explicit ids first, the course name would slugify to
  // "paista" and push the step that declares that id outright to "paista-2".
  const { menu } = normalizeMenu({
    name: 'M',
    courses: [
      {
        name: 'Paista',
        components: [{ name: 'Osa', steps: [{ id: 'paista', title: 'Mikä tahansa' }] }],
      },
    ],
  })
  assert.equal(menu.steps[0].id, 'paista')
  assert.equal(menu.courses[0].id, 'paista-2')
})

test('station defaults to muu, and an unknown one is replaced and reported', () => {
  const { menu, notes } = normalizeMenu({
    name: 'M',
    courses: [
      {
        name: 'K',
        components: [
          { name: 'O', steps: [{ title: 'A' }, { title: 'B', station: 'mikroaaltouuni' }] },
        ],
      },
    ],
  })
  assert.equal(menu.steps[0].station, 'muu')
  assert.equal(menu.steps[1].station, 'muu')
  assert.match(notes.join(' '), /tuntematon piste/)
})

test('course order fills in by position when omitted', () => {
  const { menu } = normalizeMenu({
    name: 'M',
    courses: [{ name: 'Eka' }, { name: 'Toka' }, { name: 'Kolmas', order: 9 }],
  })
  assert.deepEqual(
    menu.courses.map((c) => c.order),
    [1, 2, 9],
  )
})

test('a document carrying both nested and flat arrays prefers nested and says so', () => {
  const { menu, notes } = normalizeMenu({
    ...NESTED,
    components: [{ id: 'ignored', courseId: 'x', name: 'Sivuutettu' }],
  })
  assert.ok(!menu.components.some((c) => c.id === 'ignored'))
  assert.match(notes.join(' '), /sisäkkäiset/)
})

test('canonicalising the shipped menu is idempotent, so import and export round-trip', () => {
  const exported = toExportDoc(MENU)
  assert.deepEqual(normalizeMenu(exported).menu, exported)
  assert.deepEqual(toExportDoc(normalizeMenu(exported).menu), exported)
  // Byte for byte, because `hashMenu` on the server hashes JSON.stringify.
  assert.equal(JSON.stringify(normalizeMenu(exported).menu), JSON.stringify(exported))
})

test('the shipped menu has nothing wrong with it', () => {
  assert.deepEqual(errorsOf(validateMenu(MENU)), [])
})

test('validateMenu catches duplicate ids, orphans, self-deps and cycles', () => {
  const problems = validateMenu({
    name: 'M',
    courses: [{ id: 'c', order: 1, name: 'K' }],
    components: [
      { id: 'k', courseId: 'c', name: 'Osa', ingredients: [] },
      { id: 'k', courseId: 'nope', name: 'Kaksoisosa', ingredients: [] },
    ],
    steps: [
      { id: 'a', componentId: 'k', title: 'A', station: 'muu', deps: ['a'] },
      { id: 'b', componentId: 'puuttuu', title: 'B', station: 'muu', deps: [] },
      { id: 'x', componentId: 'k', title: 'X', station: 'muu', deps: ['y'] },
      { id: 'y', componentId: 'k', title: 'Y', station: 'muu', deps: ['x'] },
    ],
  })
  const codes = new Set(problems.map((p) => p.code))
  for (const expected of ['duplicate_id', 'orphan_component', 'orphan_step', 'self_dep', 'cycle']) {
    assert.ok(codes.has(expected as never), `expected ${expected}, got ${[...codes].join(', ')}`)
  }
})

test('a step using an ingredient its component does not list is a warning, not an error', () => {
  const problems = validateMenu({
    name: 'M',
    courses: [{ id: 'c', order: 1, name: 'K' }],
    components: [{ id: 'k', courseId: 'c', name: 'Osa', ingredients: ['voita'] }],
    steps: [{ id: 'a', componentId: 'k', title: 'A', station: 'muu', deps: [], uses: ['suolaa'] }],
  })
  const use = problems.find((p) => p.code === 'unknown_use')
  assert.ok(use)
  assert.equal(use.severity, 'warning')
  assert.deepEqual(errorsOf(problems), [])
})

test('duplicate step ids are reported once, against the row that declares them', () => {
  const menu: Menu = {
    name: 'M',
    courses: [{ id: 'c', order: 1, name: 'K' }],
    components: [{ id: 'k', courseId: 'c', name: 'Osa', ingredients: [] }],
    steps: [
      { id: 'a', componentId: 'k', title: 'Eka', station: 'muu', deps: [] },
      { id: 'a', componentId: 'k', title: 'Toka', station: 'muu', deps: [] },
    ],
  }
  // buildIndex used to collapse these into one silently, losing a step.
  assert.match(buildIndex(menu).problems.join(' '), /Sama vaihetunnus/)
  const duplicates = validateMenu(menu).filter((p) => p.code === 'duplicate_id')
  assert.equal(duplicates.length, 1)
  assert.deepEqual(duplicates[0].target, { kind: 'step', id: 'a' })
})

/** Two recipes converted separately, as an LLM produces them: one course each. */
const soloMenu = (courseName: string, dish: string, steps: string[]) =>
  normalizeMenu({
    name: courseName,
    courses: [
      {
        name: courseName,
        components: [
          {
            name: dish,
            ingredients: ['suolaa'],
            steps: steps.map((title, i) => ({
              title,
              ...(i === 0 ? {} : { deps: [steps[i - 1]] }),
            })),
          },
        ],
      },
    ],
  }).menu

test('two separately converted recipes merge into one menu, courses in order', () => {
  const first = soloMenu('Alkupala', 'Keitto', ['Pilko', 'Keitä'])
  const second = soloMenu('Pääruoka', 'Paisti', ['Mausta', 'Paista'])

  const { menu } = mergeMenus(first, second)
  assert.deepEqual(menu.courses.map((c) => c.name), ['Alkupala', 'Pääruoka'])
  assert.deepEqual(menu.courses.map((c) => c.order), [1, 2])
  assert.equal(menu.name, 'Alkupala') // the target keeps its own name
  assert.equal(menu.steps.length, 4)
  assert.deepEqual(errorsOf(validateMenu(menu)), [])
})

test('merging re-keys colliding ids and rewires the incoming dependencies', () => {
  // Both documents were authored alone, so both call their dish "osa-1" and
  // their steps the same slugs.
  const first = soloMenu('Alkupala', 'Osa', ['Sama', 'Toinen'])
  const second = soloMenu('Pääruoka', 'Osa', ['Sama', 'Toinen'])
  assert.deepEqual(first.steps.map((s) => s.id), second.steps.map((s) => s.id))

  const { menu, notes } = mergeMenus(first, second)
  assert.equal(new Set(menu.steps.map((s) => s.id)).size, 4, 'ids must all be distinct')
  assert.match(notes.join(' '), /nimettiin uudelleen/)

  // The second course's chain still points inside the second course, not at the
  // identically-named step of the first.
  const secondCourse = menu.courses[1]
  const own = menu.components.filter((c) => c.courseId === secondCourse.id).map((c) => c.id)
  const ownSteps = menu.steps.filter((s) => own.includes(s.componentId))
  assert.equal(ownSteps.length, 2)
  assert.deepEqual(ownSteps[1].deps, [ownSteps[0].id])
  assert.deepEqual(errorsOf(validateMenu(menu)), [])
})

test('merging a multi-course document appends all of its courses', () => {
  const target = soloMenu('Alkupala', 'Keitto', ['Pilko'])
  const incoming = normalizeMenu({
    name: 'Loput',
    courses: [
      { name: 'Pääruoka', components: [{ name: 'A', steps: [{ title: 'Yksi' }] }] },
      { name: 'Jälkiruoka', components: [{ name: 'B', steps: [{ title: 'Kaksi' }] }] },
    ],
  }).menu

  const { menu } = mergeMenus(target, incoming)
  assert.deepEqual(menu.courses.map((c) => c.name), ['Alkupala', 'Pääruoka', 'Jälkiruoka'])
  assert.deepEqual(menu.courses.map((c) => c.order), [1, 2, 3])
  assert.deepEqual(errorsOf(validateMenu(menu)), [])
})

test('merging into an empty menu is just the incoming menu', () => {
  const empty: Menu = { name: 'Tyhjä', courses: [], components: [], steps: [] }
  const incoming = soloMenu('Alkupala', 'Keitto', ['Pilko', 'Keitä'])
  const { menu } = mergeMenus(empty, incoming)
  assert.equal(menu.name, 'Tyhjä')
  assert.deepEqual(menu.steps.map((s) => s.title), ['Pilko', 'Keitä'])
  assert.deepEqual(errorsOf(validateMenu(menu)), [])
})
