/*
 * Regenerates the checked-in artifacts an LLM agent reads:
 *
 *   docs/menu.schema.json  — JSON Schema, from the zod source of truth
 *   docs/menu-prompt.md    — the conversion prompt, from src/shared/menuPrompt.ts
 *
 * Run with `pnpm gen:schema`. `src/shared/menuSchema.test.ts` asserts the
 * checked-in files match what this would write, so the documentation cannot
 * drift away from the validator that actually runs.
 *
 * Written with writeFileSync rather than shell redirection on purpose: npm and
 * pnpm run scripts through cmd.exe on Windows, where `>` produces UTF-16.
 */
import { writeFileSync } from 'node:fs'
import { renderedPrompt, renderedSchema, promptFile, schemaFile } from '../src/shared/menuDocs.ts'

writeFileSync(schemaFile(), renderedSchema(), 'utf8')
writeFileSync(promptFile(), renderedPrompt(), 'utf8')
console.log('[gen:schema] docs/menu.schema.json and docs/menu-prompt.md written')
