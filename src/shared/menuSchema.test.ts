import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { MENU } from '../data/menu.ts'
import { promptFile, renderedPrompt, renderedSchema, schemaFile } from './menuDocs.ts'
import { errorsOf, normalizeMenu, toExportDoc, validateMenu } from './menuDoc.ts'
import { MenuDocSchema } from './menuSchema.ts'

/*
 * The documentation an LLM agent reads is generated from the validator that
 * actually runs, so these two assertions are the whole anti-drift story. A zod
 * upgrade that changes the emitted JSON Schema will fail here by design — the
 * fix is to regenerate, not to loosen the test.
 */

test('docs/menu.schema.json is up to date — run `pnpm gen:schema`', () => {
  assert.equal(readFileSync(schemaFile(), 'utf8'), renderedSchema())
})

test('docs/menu-prompt.md is up to date — run `pnpm gen:schema`', () => {
  assert.equal(readFileSync(promptFile(), 'utf8'), renderedPrompt())
})

test('the shipped menu validates against the published schema', () => {
  const result = MenuDocSchema.safeParse(toExportDoc(MENU))
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues))
})

test('the schema accepts a minimal nested document with deps by title', () => {
  const result = MenuDocSchema.safeParse({
    name: 'Illallinen',
    courses: [
      {
        name: 'Alkupala',
        components: [
          {
            name: 'Keitto',
            ingredients: ['voita'],
            steps: [
              { title: 'Puhdista sienet' },
              { title: 'Paahda sienet', station: 'liesi', deps: ['Puhdista sienet'] },
            ],
          },
        ],
      },
    ],
  })
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues))
  // …and what the schema produces is what the normalizer consumes.
  if (result.success) {
    const { menu } = normalizeMenu(result.data)
    assert.deepEqual(menu.steps.map((s) => s.id), ['puhdista-sienet', 'paahda-sienet'])
    assert.deepEqual(menu.steps[1].deps, ['puhdista-sienet'])
  }
})

test('an unknown station is rejected rather than quietly downgraded', () => {
  const result = MenuDocSchema.safeParse({
    name: 'M',
    courses: [{ name: 'K', components: [{ name: 'O', steps: [{ title: 'A', station: 'sous-vide' }] }] }],
  })
  assert.equal(result.success, false)
})

test('a menu with no courses is rejected', () => {
  assert.equal(MenuDocSchema.safeParse({ name: 'M', courses: [] }).success, false)
})

test('every JSON example in docs/menu-format.md is a valid menu', () => {
  const doc = readFileSync(
    fileURLToPath(new URL('../../docs/menu-format.md', import.meta.url)),
    'utf8',
  )
  const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1])
  assert.ok(blocks.length >= 2, `expected the nested and flat examples, found ${blocks.length}`)

  for (const [i, block] of blocks.entries()) {
    const parsed = MenuDocSchema.safeParse(JSON.parse(block))
    assert.equal(
      parsed.success,
      true,
      `example ${i + 1}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`,
    )
    if (!parsed.success) continue
    // Shape is not enough: the prose promises deps-by-title resolve and that
    // these documents describe a real graph.
    const { menu } = normalizeMenu(parsed.data)
    assert.deepEqual(errorsOf(validateMenu(menu)), [], `example ${i + 1} has semantic errors`)
  }
})
