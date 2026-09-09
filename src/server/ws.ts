import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { z } from 'zod'
import { ClientMessageSchema } from '../shared/protocol.ts'
import {
  claim,
  helloFor,
  join,
  leave,
  loadRoom,
  send,
  snapshotFor,
  submit,
  type Client,
  type LiveRoom,
} from './room.ts'

const PING_INTERVAL_MS = 30_000

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })

/** Lets the liveness sweep find the `Client` behind a raw socket. */
const clients = new WeakMap<WebSocket, Client>()

function onConnection(socket: WebSocket, room: LiveRoom): void {
  const client = join(room, socket)
  clients.set(socket, client)
  send(socket, helloFor(room, client.id))

  socket.on('pong', () => {
    client.alive = true
  })

  socket.on('message', (raw) => {
    let json: unknown
    try {
      json = JSON.parse(raw.toString())
    } catch {
      send(socket, { type: 'error', code: 'protocol', message: 'Malformed JSON.' })
      return
    }

    const msg = ClientMessageSchema.safeParse(json)
    if (!msg.success) {
      // Not fatal: a client one version ahead should be told, not disconnected.
      send(socket, { type: 'error', code: 'protocol', message: z.prettifyError(msg.error) })
      return
    }

    if (msg.data.type === 'resync') {
      send(socket, snapshotFor(room))
      return
    }

    if (msg.data.type === 'presence') {
      claim(room, client, msg.data.cookId)
      return
    }

    try {
      submit(room, client, msg.data.env)
    } catch (err) {
      console.error('[ws] submit failed', err)
      send(socket, { type: 'error', code: 'internal', message: 'Komento epäonnistui.' })
    }
  })

  socket.on('close', () => leave(room, client))
  socket.on('error', () => leave(room, client))
}

/** Rejects an upgrade before the WebSocket handshake, so the browser sees a real status. */
function refuse(socket: Duplex, status: number, reason: string, extra = ''): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n${extra}Connection: close\r\n\r\n`)
  socket.destroy()
}

export interface UpgradeGuard {
  (req: IncomingMessage): boolean
}

/**
 * Structural, because `@hono/node-server` returns a union that includes an
 * HTTP/2 server. The upgrade event is the only thing we need from it.
 */
export interface UpgradableServer {
  on(
    event: 'upgrade',
    listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown
}

export function attachWebSocket(server: UpgradableServer, authorized: UpgradeGuard): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/ws') return refuse(socket, 404, 'Not Found')

    if (!authorized(req)) {
      return refuse(
        socket,
        401,
        'Unauthorized',
        'WWW-Authenticate: Basic realm="parallel-cooking", charset="UTF-8"\r\n',
      )
    }

    const roomId = url.searchParams.get('room')
    const room = roomId ? loadRoom(roomId) : null
    if (!room) {
      // Accept the socket anyway, so the client can render "no such kitchen"
      // rather than guessing from a failed handshake.
      return wss.handleUpgrade(req, socket, head, (ws) => {
        send(ws, { type: 'error', code: 'room_not_found', message: 'Keittiötä ei löytynyt.' })
        ws.close(4004, 'room_not_found')
      })
    }

    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, room))
  })

  // Half-open TCP connections look alive to the OS but never deliver a frame.
  // A missed pong between sweeps is what actually detects them.
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      const client = clients.get(ws)
      if (!client) continue
      if (!client.alive) {
        ws.terminate()
        continue
      }
      client.alive = false
      ws.ping()
    }
  }, PING_INTERVAL_MS)
  ping.unref()
}

export const closeAllSockets = (): void => {
  for (const ws of wss.clients) ws.close(1001, 'server shutting down')
}
