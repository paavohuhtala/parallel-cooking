import type { Menu } from '../model/types.ts'
import { initialState } from '../shared/apply.ts'
import type { RoomSummary } from '../shared/api.ts'
import { templateById } from '../shared/templates.ts'
import { newId, one, run, transact, type RoomRow } from './db.ts'
import { copyMenu, createMenuFromTemplate, getMenu } from './menus.ts'

export function getRoomRow(id: string): RoomRow | null {
  return one<RoomRow>('SELECT * FROM room WHERE id = ?', id)
}

export function getRoomSummary(id: string): RoomSummary | null {
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

/** "Uusi keittiö tällä menulla" — the replacement for resetting a room. */
export function createRoomFromRoom(fromRoomId: string, name?: string): CreateResult {
  const source = getRoomRow(fromRoomId)
  if (!source) return { ok: false, reason: 'Lähdekeittiötä ei löytynyt.' }
  const sourceMenu = getMenu(source.menu_id)
  if (!sourceMenu) return { ok: false, reason: 'Lähdekeittiön menua ei löytynyt.' }
  const id = transact(() => {
    const menuId = copyMenu(source.menu_id)
    const menu = JSON.parse(sourceMenu.doc) as Menu
    return insertRoom(menuId, name?.trim() || menu.name)
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

export function touchRoom(id: string): void {
  run('UPDATE room SET last_seen_at = ? WHERE id = ?', Date.now(), id)
}
