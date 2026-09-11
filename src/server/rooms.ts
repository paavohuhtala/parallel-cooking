import type { Menu } from '../model/types.ts'
import { initialState } from '../shared/apply.ts'
import type { RoomSummary } from '../shared/api.ts'
import { templateById } from '../shared/templates.ts'
import { newId, one, run, transact, type RoomRow } from './db.ts'
import { copyMenu, createMenuFromTemplate, getMenu } from './menus.ts'

export function getRoomRow(id: string): RoomRow | null {
  return one<RoomRow>('SELECT * FROM room WHERE id = ?', id)
}

/**
 * A room summary minus `online`: presence lives on the socket layer, so the
 * route is what puts the two halves together.
 */
export type RoomRecord = Omit<RoomSummary, 'online'>

export function getRoomRecord(id: string): RoomRecord | null {
  const row = one<{
    id: string
    name: string
    version: number
    created_at: number
    menu_name: string
  }>(
    `SELECT r.id, r.name, r.version, r.created_at, m.name AS menu_name
     FROM room r JOIN menu m ON m.id = r.menu_id WHERE r.id = ?`,
    id,
  )
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    menuName: row.menu_name,
    version: row.version,
    createdAt: row.created_at,
  }
}

function insertRoom(menuId: string, name: string): string {
  const id = newId()
  const now = Date.now()
  run(
    `INSERT INTO room (id, name, menu_id, state, version, created_at, updated_at, last_seen_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
    id, name, menuId, JSON.stringify(initialState()), now, now, now,
  )
  return id
}

export type CreateResult = { ok: true; id: string } | { ok: false; reason: string }

export function createRoomFromTemplate(templateId: string, name?: string): CreateResult {
  const template = templateById(templateId)
  if (!template) return { ok: false, reason: 'Tuntematon menupohja.' }
  const id = transact(() => {
    const menuId = createMenuFromTemplate(template)
    return insertRoom(menuId, name?.trim() || template.menu.name)
  })
  return { ok: true, id }
}

/**
 * "Start a kitchen from this menu." The library entry is *copied*, so editing it
 * later never touches a dinner already in progress.
 */
export function createRoomFromMenu(fromMenuId: string, name?: string): CreateResult {
  const source = getMenu(fromMenuId)
  if (!source) return { ok: false, reason: 'Menua ei löytynyt.' }
  const id = transact(() => {
    const menuId = copyMenu(fromMenuId)
    const menu = JSON.parse(source.doc) as Menu
    return insertRoom(menuId, name?.trim() || menu.name)
  })
  return { ok: true, id }
}

export function renameRoom(id: string, name: string): boolean {
  const result = run('UPDATE room SET name = ?, updated_at = ? WHERE id = ?', name, Date.now(), id)
  return result.changes > 0
}

/**
 * Removes a kitchen for good: the audit trail, the row, and the private copy of
 * the menu it was cooking from. The library entry that copy came from is left
 * alone — it is a different thing on a different shelf, and deleting one is
 * what the menu list is for.
 *
 * Whether anybody is *in* the kitchen is not decided here; the route checks
 * that against the socket layer.
 */
export function deleteRoom(id: string): boolean {
  const room = getRoomRow(id)
  if (!room) return false
  transact(() => {
    run('DELETE FROM command_log WHERE room_id = ?', id)
    run('DELETE FROM room WHERE id = ?', id)
    // `is_library = 0` is the guard that keeps a shelved menu out of this: a
    // room only ever cooks from a copy it owns.
    run('DELETE FROM menu WHERE id = ? AND is_library = 0', room.menu_id)
  })
  return true
}

export function touchRoom(id: string): void {
  run('UPDATE room SET last_seen_at = ? WHERE id = ?', Date.now(), id)
}
