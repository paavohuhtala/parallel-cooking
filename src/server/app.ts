import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import {
  CreateRoomSchema,
  RenameRoomSchema,
  type RoomSummary,
  type TemplateSummary,
} from '../shared/api.ts'
import { renderedSchema } from '../shared/menuDocs.ts'
import { MENU_TEMPLATES } from '../shared/templates.ts'
import { authMiddleware } from './auth.ts'
import { config } from './config.ts'
import { menuRoutes } from './menuRoutes.ts'
import { one } from './db.ts'
import { connectedCount, dropRoom } from './room.ts'
import {
  createRoomFromMenu,
  createRoomFromTemplate,
  deleteRoom,
  getRoomRecord,
  renameRoom,
} from './rooms.ts'

export const app = new Hono()

// Registered before every route, so nothing is reachable around it.
for (const middleware of authMiddleware()) app.use('*', middleware)

// The socket caps frames at 64 KB; REST had no limit at all, and a menu import
// is the first endpoint that takes a document rather than a short field.
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 512 * 1024,
    onError: (c) => c.json({ error: 'Pyyntö on liian suuri.' }, 413),
  }),
)

app.get('/healthz', (c) => {
  const rooms = one<{ n: number }>('SELECT COUNT(*) AS n FROM room')?.n ?? 0
  return c.json({ ok: true, rooms, uptime: Math.round(process.uptime()) })
})

/*
 * The menu format, for whoever is converting a recipe into one — usually an LLM
 * agent, which can be pointed straight at this URL. Rendered once at boot from
 * the same zod schema that validates an import, so it cannot describe a format
 * the server would then reject.
 */
const MENU_SCHEMA = renderedSchema()

app.get('/api/menus/schema.json', (c) => {
  c.header('content-type', 'application/schema+json; charset=utf-8')
  c.header('cache-control', 'public, max-age=300')
  return c.body(MENU_SCHEMA)
})

// Menu authoring, import and export. Mounted before the /api/* catch-all below.
app.route('/', menuRoutes)

app.get('/api/templates', (c) => {
  const summaries: TemplateSummary[] = MENU_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    ...(t.description === undefined ? {} : { description: t.description }),
    courseCount: t.menu.courses.length,
    stepCount: t.menu.steps.length,
  }))
  return c.json(summaries)
})

/**
 * The stored row plus the one field only the socket layer knows. Kept in one
 * place so every room response answers "is anybody in there" the same way.
 */
function roomSummary(id: string): RoomSummary | null {
  const room = getRoomRecord(id)
  return room && { ...room, online: connectedCount(id) }
}

app.post('/api/rooms', async (c) => {
  const body = CreateRoomSchema.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)

  const result =
    'templateId' in body.data
      ? createRoomFromTemplate(body.data.templateId, body.data.name)
      : createRoomFromMenu(body.data.fromMenuId, body.data.name)

  if (!result.ok) return c.json({ error: result.reason }, 400)
  return c.json(roomSummary(result.id), 201)
})

app.get('/api/rooms/:id', (c) => {
  const summary = roomSummary(c.req.param('id'))
  if (!summary) return c.json({ error: 'Keittiötä ei löytynyt.' }, 404)
  return c.json(summary)
})

app.patch('/api/rooms/:id', async (c) => {
  const body = RenameRoomSchema.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)
  if (!renameRoom(c.req.param('id'), body.data.name)) {
    return c.json({ error: 'Keittiötä ei löytynyt.' }, 404)
  }
  return c.json(roomSummary(c.req.param('id')))
})

/*
 * Deleting a kitchen is offered only while nobody is in it, and the check is
 * here rather than in the UI alone: the front page reads `online` once, and
 * somebody can walk in between that render and the click. Pulling the room out
 * from under an open socket would leave that client sending commands into a
 * room that no longer exists.
 *
 * The whole handler is synchronous — no body to read — so nothing can join
 * between the count and the delete.
 */
app.delete('/api/rooms/:id', (c) => {
  const id = c.req.param('id')
  if (connectedCount(id) > 0) {
    return c.json({ error: 'Keittiössä on kokkeja paikalla.' }, 409)
  }
  if (!deleteRoom(id)) return c.json({ error: 'Keittiötä ei löytynyt.' }, 404)
  dropRoom(id)
  return c.body(null, 204)
})

// An unmatched /api path must not fall through to the SPA and answer HTML 200.
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

/*
 * Static client. Vite fingerprints everything under /assets, so those can be
 * cached forever, while index.html must not be — it is what points at the
 * current bundle. The last route is the SPA fallback that makes /r/<id>
 * survive a reload.
 *
 * Under `dev:all` the client belongs to Vite, and `dist/` is only a stale
 * build, so a page load here is sent there rather than answered from it.
 */
const DIST = './dist'
const devClientUrl = config.devClientUrl

if (devClientUrl) {
  app.get('*', (c) => {
    const { pathname, search } = new URL(c.req.url)
    return c.redirect(`${devClientUrl}${pathname}${search}`, 307)
  })
} else {
  app.use(
    '/assets/*',
    serveStatic({
      root: DIST,
      onFound: (_path, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable'),
    }),
  )

  app.use(
    '*',
    serveStatic({
      root: DIST,
      onFound: (path, c) => {
        if (path.endsWith('.html')) c.header('Cache-Control', 'no-cache')
      },
    }),
  )

  app.get('*', serveStatic({ path: `${DIST}/index.html`, onFound: (_p, c) => c.header('Cache-Control', 'no-cache') }))
}
