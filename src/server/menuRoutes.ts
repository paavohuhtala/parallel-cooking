import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import type { Menu } from '../model/types.ts'
import type {
  MenuDetail,
  MenuImportResponse,
  MenuSummary,
  MenuWriteResponse,
} from '../shared/api.ts'
import { errorsOf, normalizeMenu, toExportDoc, validateMenu } from '../shared/menuDoc.ts'
import { ImportMenuSchema, UpdateMenuSchema } from '../shared/menuSchema.ts'
import { templateById } from '../shared/templates.ts'
import type { MenuRow } from './db.ts'
import {
  copyMenu,
  createLibraryMenu,
  deleteLibraryMenu,
  getMenu,
  listLibraryMenus,
  updateMenu,
} from './menus.ts'
import { menuChanged } from './room.ts'
import { getRoomRow } from './rooms.ts'

/*
 * Menu authoring, import and export.
 *
 * Menu writes go over REST rather than through `applyCommand`, deliberately.
 * `applyCommand` takes an index *derived from the menu*, and the client replays
 * its pending queue against one — so a mutable menu inside that queue would mean
 * replaying early commands against an index built from a later menu. Menus
 * instead carry their own version, and a write broadcasts the already-defined
 * `{type:'menu'}` message.
 */

export const menuRoutes = new Hono()

const summaryOf = (row: MenuRow): MenuSummary => {
  const menu = JSON.parse(row.doc) as Menu
  return {
    id: row.id,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    courseCount: menu.courses.length,
    componentCount: menu.components.length,
    stepCount: menu.steps.length,
    version: row.version,
    updatedAt: row.updated_at,
  }
}

const detailOf = (row: MenuRow): MenuDetail => ({
  ...summaryOf(row),
  menu: JSON.parse(row.doc) as Menu,
  followsTemplate: row.follows_template === 1,
})

menuRoutes.get('/api/menus', (c) => c.json(listLibraryMenus().map(summaryOf)))

menuRoutes.get('/api/menus/:id', (c) => {
  const row = getMenu(c.req.param('id'))
  if (!row) return c.json({ error: 'Menua ei löytynyt.' }, 404)
  return c.json(detailOf(row))
})

/**
 * Import, and the import preview. `dryRun` validates and reports without
 * writing, which is what the dialog shows before you commit to it.
 */
menuRoutes.post('/api/menus/import', async (c) => {
  const body = ImportMenuSchema.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)

  const { menu, notes } = normalizeMenu(body.data.doc)
  const problems = validateMenu(menu)
  const response: MenuImportResponse = { menu: toExportDoc(menu), problems, notes }

  if (errorsOf(problems).length > 0) return c.json(response, 422)
  if (body.data.dryRun) return c.json(response)

  const id = createLibraryMenu(response.menu, body.data.name)
  return c.json({ ...response, id }, 201)
})

menuRoutes.post('/api/menus', async (c) => {
  const body = await c.req.json().catch(() => null)
  // Order matters: a union takes the first branch that parses, and zod strips
  // unknown keys — so the bare `{ name }` branch would otherwise swallow a
  // `{ templateId, name }` request and silently create an empty menu.
  const parsed = z
    .union([
      z.object({ name: z.string().trim().max(120).optional(), templateId: z.string().min(1) }),
      z.object({ name: z.string().trim().max(120).optional(), fromMenuId: z.string().min(1) }),
      z.object({ name: z.string().trim().min(1).max(120) }),
    ])
    .safeParse(body)
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)

  if ('templateId' in parsed.data) {
    const template = templateById(parsed.data.templateId)
    if (!template) return c.json({ error: 'Tuntematon menupohja.' }, 400)
    const id = createLibraryMenu(toExportDoc(template.menu), parsed.data.name, template.description)
    return c.json(detailOf(getMenu(id)!), 201)
  }

  if ('fromMenuId' in parsed.data) {
    if (!getMenu(parsed.data.fromMenuId)) return c.json({ error: 'Menua ei löytynyt.' }, 404)
    const id = copyMenu(parsed.data.fromMenuId, true)
    return c.json(detailOf(getMenu(id)!), 201)
  }

  // A blank menu still has to be a legal one, so it starts with a course and a
  // dish to type into rather than an empty screen with no affordance.
  const id = createLibraryMenu(
    toExportDoc({
      name: parsed.data.name,
      courses: [{ id: 'ruokalaji-1', order: 1, name: 'Ruokalaji 1' }],
      components: [{ id: 'osa-1', courseId: 'ruokalaji-1', name: 'Osa 1', ingredients: [] }],
      steps: [],
    }),
    parsed.data.name,
  )
  return c.json(detailOf(getMenu(id)!), 201)
})

menuRoutes.delete('/api/menus/:id', (c) => {
  if (!deleteLibraryMenu(c.req.param('id'))) {
    return c.json({ error: 'Menua ei löytynyt.' }, 404)
  }
  return c.body(null, 204)
})

menuRoutes.put('/api/menus/:id', async (c) => saveMenu(c, c.req.param('id')))

/**
 * Edit the copy a room is cooking from. The room id is the capability the client
 * already holds, so menu ids never have to appear in the room UI.
 */
menuRoutes.put('/api/rooms/:id/menu', async (c) => {
  const room = getRoomRow(c.req.param('id'))
  if (!room) return c.json({ error: 'Keittiötä ei löytynyt.' }, 404)
  return saveMenu(c, room.menu_id)
})

menuRoutes.get('/api/rooms/:id/menu', (c) => {
  const room = getRoomRow(c.req.param('id'))
  if (!room) return c.json({ error: 'Keittiötä ei löytynyt.' }, 404)
  const row = getMenu(room.menu_id)
  if (!row) return c.json({ error: 'Menua ei löytynyt.' }, 404)
  return c.json(detailOf(row))
})

/**
 * The one write path. Normalises, refuses a semantically broken menu, then
 * persists and broadcasts.
 *
 * The write and the broadcast are one synchronous block on purpose: an `await`
 * between them would let a socket command apply against the state that pruning
 * is about to replace.
 */
async function saveMenu(c: Context, menuId: string): Promise<Response> {
  const body = UpdateMenuSchema.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)

  const { menu, notes } = normalizeMenu(body.data.menu)
  const problems = validateMenu(menu)
  if (errorsOf(problems).length > 0) {
    return c.json({ error: errorsOf(problems)[0].message, problems, notes }, 422)
  }

  const canonical = toExportDoc(menu)
  const result = updateMenu(menuId, canonical, body.data.expectedVersion)
  if (!result.ok) {
    if (result.code === 'not_found') return c.json({ error: 'Menua ei löytynyt.' }, 404)
    return c.json(
      {
        error: 'Joku muu ehti muokata menua. Lataa uusin versio ja yritä uudelleen.',
        current: result.current,
      },
      409,
    )
  }

  for (const room of result.rooms) {
    menuChanged(room.roomId, canonical, result.version, room.pruned)
  }

  const response: MenuWriteResponse = {
    version: result.version,
    prunedRooms: result.rooms.filter((r) => r.pruned).map((r) => r.roomId),
  }
  return c.json(response)
}
