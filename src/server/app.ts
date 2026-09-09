import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { z } from 'zod'
import { CreateRoomSchema, RenameRoomSchema, type TemplateSummary } from '../shared/api.ts'
import { MENU_TEMPLATES } from '../shared/templates.ts'
import { authMiddleware } from './auth.ts'
import { one } from './db.ts'
import {
  createRoomFromRoom,
  createRoomFromTemplate,
  getRoomSummary,
  renameRoom,
} from './rooms.ts'

export const app = new Hono()

// Registered before every route, so nothing is reachable around it.
for (const middleware of authMiddleware()) app.use('*', middleware)

app.get('/healthz', (c) => {
  const rooms = one<{ n: number }>('SELECT COUNT(*) AS n FROM room')?.n ?? 0
  return c.json({ ok: true, rooms, uptime: Math.round(process.uptime()) })
})

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

app.post('/api/rooms', async (c) => {
  const body = CreateRoomSchema.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)

  const result =
    'templateId' in body.data
      ? createRoomFromTemplate(body.data.templateId, body.data.name)
      : createRoomFromRoom(body.data.fromRoomId, body.data.name)

  if (!result.ok) return c.json({ error: result.reason }, 400)
  return c.json(getRoomSummary(result.id), 201)
})

app.get('/api/rooms/:id', (c) => {
  const summary = getRoomSummary(c.req.param('id'))
  if (!summary) return c.json({ error: 'Keittiötä ei löytynyt.' }, 404)
  return c.json(summary)
})

app.patch('/api/rooms/:id', async (c) => {
  const body = RenameRoomSchema.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)
  if (!renameRoom(c.req.param('id'), body.data.name)) {
    return c.json({ error: 'Keittiötä ei löytynyt.' }, 404)
  }
  return c.json(getRoomSummary(c.req.param('id')))
})

// An unmatched /api path must not fall through to the SPA and answer HTML 200.
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

/*
 * Static client. Vite fingerprints everything under /assets, so those can be
 * cached forever, while index.html must not be — it is what points at the
 * current bundle. The last route is the SPA fallback that makes /r/<id>
 * survive a reload.
 */
const DIST = './dist'

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
