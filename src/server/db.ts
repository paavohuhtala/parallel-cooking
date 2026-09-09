import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.ts'
import { migrate } from './migrations.ts'

mkdirSync(config.dataDir, { recursive: true })

export const db = new DatabaseSync(path.join(config.dataDir, 'app.db'))

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
`)

const applied = migrate(db)
if (applied > 0) console.log(`[db] applied ${applied} migration(s)`)

/** 11 URL-safe characters, 64 bits. Short enough to share, unguessable enough behind basic auth. */
export const newId = (): string => randomBytes(8).toString('base64url')

type Param = string | number | bigint | null | Uint8Array

/*
 * `node:sqlite` hands back `Record<string, SQLOutputValue>`. These three
 * wrappers are where that becomes a row type, so the assertion lives in one
 * place instead of at every call site.
 */

export function one<T>(sql: string, ...params: Param[]): T | null {
  return (db.prepare(sql).get(...params) as T | undefined) ?? null
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[]
}

export function run(sql: string, ...params: Param[]): { changes: number | bigint } {
  return db.prepare(sql).run(...params)
}

/** Runs `fn` in an immediate transaction, rolling back if it throws. */
export function transact<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export interface MenuRow {
  id: string
  name: string
  doc: string
  doc_hash: string
  template_id: string | null
  follows_template: number
  /** 1 when this is a library menu rather than the private copy a room cooks from. */
  is_library: number
  description: string | null
  version: number
  created_at: number
  updated_at: number
}

export interface RoomRow {
  id: string
  name: string
  menu_id: string
  state: string
  version: number
  created_at: number
  updated_at: number
  last_seen_at: number
}
