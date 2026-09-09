import { createHash } from 'node:crypto'
import type { KitchenState, Menu } from '../model/types.ts'
import { MENU_TEMPLATES, type MenuTemplate } from '../shared/templates.ts'
import { config } from './config.ts'
import { all, newId, one, run, transact, type MenuRow, type RoomRow } from './db.ts'

export const hashMenu = (menu: Menu): string =>
  createHash('sha256').update(JSON.stringify(menu)).digest('hex')

export function getMenu(id: string): MenuRow | null {
  return one<MenuRow>('SELECT * FROM menu WHERE id = ?', id)
}

/** Copies a code template into a menu row this room owns outright. */
export function createMenuFromTemplate(template: MenuTemplate): string {
  const id = newId()
  const now = Date.now()
  const doc = JSON.stringify(template.menu)
  run(
    `INSERT INTO menu (id, name, description, doc, doc_hash, template_id, follows_template, is_library, version, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 0, 1, ?, ?)`,
    id,
    template.menu.name,
    doc,
    hashMenu(template.menu),
    template.id,
    config.followTemplate ? 1 : 0,
    now,
    now,
  )
  return id
}

/**
 * Duplicates an existing menu, keeping its provenance. Used by "new room, same
 * menu" and by starting a kitchen from the library.
 *
 * `isLibrary` defaults to false, which is the guarantee that matters: a kitchen
 * started from a library menu gets its *own* copy, so editing the library entry
 * tomorrow cannot rewrite a dinner that is already being cooked.
 */
export function copyMenu(
  sourceId: string,
  { isLibrary = false, name }: { isLibrary?: boolean; name?: string } = {},
): string {
  const source = getMenu(sourceId)
  if (!source) throw new Error(`No such menu: ${sourceId}`)
  const id = newId()
  const now = Date.now()

  // Renaming has to reach *inside* the document, not just the row. The editor
  // saves the whole document back, name included, so a row named differently
  // from its own doc would quietly revert on the first edit.
  const renamed = renameDoc(source.doc, name)

  run(
    `INSERT INTO menu (id, name, description, doc, doc_hash, template_id, follows_template, is_library, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id, renamed.name, source.description, renamed.doc, renamed.hash,
    // A library menu must never follow a code template, or the next dev restart
    // would rewrite what the user just authored.
    isLibrary ? null : source.template_id,
    isLibrary ? 0 : source.follows_template,
    isLibrary ? 1 : 0,
    now, now,
  )
  return id
}

/** A menu authored or imported in the app, owned by nobody until a kitchen copies it. */
export function createLibraryMenu(menu: Menu, name?: string, description?: string): string {
  const id = newId()
  const now = Date.now()
  // The document owns the name; the column is a denormalised copy for listing.
  const named = name?.trim() ? { ...menu, name: name.trim() } : menu
  run(
    `INSERT INTO menu (id, name, description, doc, doc_hash, template_id, follows_template, is_library, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 0, 1, 1, ?, ?)`,
    id, named.name, description ?? null,
    JSON.stringify(named), hashMenu(named), now, now,
  )
  return id
}

/** A stored document with its `name` replaced, ready to insert. */
function renameDoc(doc: string, name?: string): { name: string; doc: string; hash: string } {
  const parsed = JSON.parse(doc) as Menu
  if (!name?.trim() || name.trim() === parsed.name) {
    return { name: parsed.name, doc, hash: hashMenu(parsed) }
  }
  const next = { ...parsed, name: name.trim() }
  return { name: next.name, doc: JSON.stringify(next), hash: hashMenu(next) }
}

export function listLibraryMenus(): MenuRow[] {
  return all<MenuRow>('SELECT * FROM menu WHERE is_library = 1 ORDER BY updated_at DESC')
}

/** Library entries only; a room's own copy is not the user's to delete. */
export function deleteLibraryMenu(id: string): boolean {
  return run('DELETE FROM menu WHERE id = ? AND is_library = 1', id).changes > 0
}

export interface MenuWriteRoom {
  roomId: string
  /** Set when the edit dropped steps this room had progress recorded against. */
  pruned: { state: KitchenState; version: number } | null
}

export type UpdateMenuResult =
  | { ok: true; version: number; rooms: MenuWriteRoom[] }
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'conflict'; current: { menu: Menu; version: number } }

/**
 * The only writer of an authored menu.
 *
 * `expectedVersion` makes a concurrent edit a visible 409 instead of a silent
 * clobber — the whole document is replaced, so last-write-wins would quietly
 * discard the other person's work.
 *
 * Clearing `follows_template` *and* `template_id` is what stops the next dev
 * restart reverting the edit through `refreshFollowedMenus()`, which selects on
 * both columns.
 */
export function updateMenu(id: string, next: Menu, expectedVersion: number): UpdateMenuResult {
  return transact(() => {
    // Re-read inside the transaction: checking the version before BEGIN would
    // leave a window for another writer to land in between.
    const row = getMenu(id)
    if (!row) return { ok: false, code: 'not_found' }
    if (row.version !== expectedVersion) {
      return {
        ok: false,
        code: 'conflict',
        current: { menu: JSON.parse(row.doc) as Menu, version: row.version },
      }
    }

    const now = Date.now()
    run(
      `UPDATE menu SET name = ?, doc = ?, doc_hash = ?, version = version + 1, updated_at = ?,
                       follows_template = 0, template_id = NULL
       WHERE id = ?`,
      next.name, JSON.stringify(next), hashMenu(next), now, id,
    )

    const rooms = all<RoomRow>('SELECT * FROM room WHERE menu_id = ?', id).map((room) => {
      const pruned = pruneState(JSON.parse(room.state) as KitchenState, next)
      if (!pruned) return { roomId: room.id, pruned: null }
      const version = room.version + 1
      run(
        'UPDATE room SET state = ?, version = ?, updated_at = ? WHERE id = ?',
        JSON.stringify(pruned), version, now, room.id,
      )
      return { roomId: room.id, pruned: { state: pruned, version } }
    })

    return { ok: true, version: row.version + 1, rooms }
  })
}

/** Drops records for steps the menu no longer contains. */
function pruneState(state: KitchenState, menu: Menu): KitchenState | null {
  const live = new Set(menu.steps.map((s) => s.id))
  const kept = Object.entries(state.steps).filter(([id]) => live.has(id))
  if (kept.length === Object.keys(state.steps).length) return null
  return { ...state, steps: Object.fromEntries(kept) }
}

export interface RefreshedRoom {
  roomId: string
  menuId: string
}

/**
 * The local-iteration loop. Any menu still following its code template is
 * brought back in line with it on boot, and rooms using that menu lose records
 * for steps that no longer exist. Disabled in production, where a redeploy must
 * not rewrite a dinner in progress.
 *
 * Returns the rooms whose state changed, so live sockets can be told.
 */
export function refreshFollowedMenus(): RefreshedRoom[] {
  if (!config.followTemplate) return []

  const menus = all<MenuRow>(
    'SELECT * FROM menu WHERE follows_template = 1 AND template_id IS NOT NULL',
  )

  const touched: RefreshedRoom[] = []

  for (const row of menus) {
    const template = MENU_TEMPLATES.find((t) => t.id === row.template_id)
    if (!template) {
      console.warn(`[menus] menu ${row.id} follows unknown template ${row.template_id}`)
      continue
    }
    const hash = hashMenu(template.menu)
    if (hash === row.doc_hash) continue

    transact(() => {
      const now = Date.now()
      run(
        `UPDATE menu SET name = ?, doc = ?, doc_hash = ?, version = version + 1, updated_at = ?
         WHERE id = ?`,
        template.menu.name, JSON.stringify(template.menu), hash, now, row.id,
      )

      const rooms = all<RoomRow>('SELECT * FROM room WHERE menu_id = ?', row.id)
      for (const room of rooms) {
        const pruned = pruneState(JSON.parse(room.state) as KitchenState, template.menu)
        if (pruned) {
          run(
            'UPDATE room SET state = ?, version = version + 1, updated_at = ? WHERE id = ?',
            JSON.stringify(pruned), now, room.id,
          )
        }
        touched.push({ roomId: room.id, menuId: row.id })
      }
    })

    console.log(`[menus] menu ${row.id} refreshed from template ${template.id}`)
  }

  return touched
}
