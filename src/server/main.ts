import { serve } from '@hono/node-server'
import { app } from './app.ts'
import { upgradeAuthorized } from './auth.ts'
import { config } from './config.ts'
import { db } from './db.ts'
import { refreshFollowedMenus } from './menus.ts'
import { attachWebSocket, closeAllSockets } from './ws.ts'

// Runs before anything can connect, so no room is live yet and nothing needs
// broadcasting: clients reconnecting after the restart pick the new menu up in
// their `hello`.
const refreshed = refreshFollowedMenus()
if (refreshed.length) console.log(`[menus] ${refreshed.length} room(s) updated from templates`)

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`)
  if (!config.auth) console.log('[server] basic auth disabled (no BASIC_AUTH_USER/PASS)')
})

attachWebSocket(server, upgradeAuthorized)

let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[server] ${signal}, shutting down`)
  const hard = setTimeout(() => process.exit(1), 10_000)
  hard.unref()
  // Closing sockets explicitly makes clients reconnect immediately instead of
  // waiting out their own timeout.
  closeAllSockets()
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
