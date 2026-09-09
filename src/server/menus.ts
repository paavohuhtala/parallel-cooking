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
    `INSERT INTO menu (id, name, doc, doc_hash, template_id, follows_template, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
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

/** Duplicates an existing menu, keeping its provenance. Used by "new room, same menu". */
export function copyMenu(sourceId: string): string {
  const source = getMenu(sourceId)
  if (!source) throw new Error(`No such menu: ${sourceId}`)
  const id = newId()
  const now = Date.now()
  run(
    `INSERT INTO menu (id, name, doc, doc_hash, template_id, follows_template, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id, source.name, source.doc, source.doc_hash, source.template_id, source.follows_template, now, now,
  )
  return id
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
