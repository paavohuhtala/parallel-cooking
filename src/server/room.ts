import type { WebSocket } from 'ws'
import type { KitchenState, Menu } from '../model/types.ts'
import { applyCommand } from '../shared/apply.ts'
import type { Envelope, Origin, ServerMessage } from '../shared/protocol.ts'
import { PROTOCOL_VERSION } from '../shared/constants.ts'
import { buildIndex, type GraphIndex } from '../state/graph.ts'
import { newId, one, run, transact, type MenuRow, type RoomRow } from './db.ts'
import { touchRoom } from './rooms.ts'

export interface Client {
  id: string
  socket: WebSocket
  alive: boolean
  /** Which cook this connection says it is, if it has said. */
  cookId: string | null
}

/**
 * A room's authoritative copy, held in memory. There is exactly one server
 * process (SQLite is single-writer and the fan-out is in-process), so this is
 * the truth and the database is a write-through log behind it.
 */
export interface LiveRoom {
  id: string
  name: string
  menu: Menu
  menuVersion: number
  index: GraphIndex
  state: KitchenState
  version: number
  clients: Set<Client>
  evictAt: NodeJS.Timeout | null
  /**
   * Command ids already applied, newest last. Clients replay their pending
   * queue after a reconnect, and while `applyCommand` is idempotent in terms of
   * state, re-applying would still inflate the version and add a duplicate log
   * row. Bounded, so a long-lived room does not grow without limit.
   */
  applied: Set<string>
}

const APPLIED_MEMORY = 500

const live = new Map<string, LiveRoom>()

/** Grace before an empty room leaves memory, so a reconnect doesn't thrash it. */
const EVICT_AFTER_MS = 30_000

export function loadRoom(roomId: string): LiveRoom | null {
  const cached = live.get(roomId)
  if (cached) return cached

  const room = one<RoomRow>('SELECT * FROM room WHERE id = ?', roomId)
  if (!room) return null
  const menuRow = one<MenuRow>('SELECT * FROM menu WHERE id = ?', room.menu_id)
  if (!menuRow) return null

  const menu = JSON.parse(menuRow.doc) as Menu
  const entry: LiveRoom = {
    id: room.id,
    name: room.name,
    menu,
    menuVersion: menuRow.version,
    index: buildIndex(menu),
    state: JSON.parse(room.state) as KitchenState,
    version: room.version,
    clients: new Set(),
    evictAt: null,
    applied: new Set(),
  }
  live.set(room.id, entry)
  return entry
}

/**
 * A menu row was rewritten. Refresh the copy this room is cooking from and tell
 * everyone connected.
 *
 * Must be called synchronously after the write that produced it — an `await` in
 * between would let a socket command apply against the pre-prune state and be
 * persisted on top of it.
 *
 * The menu goes out *before* the snapshot: the client rebuilds its index when it
 * sees a menu, and a render landing between the two must not evaluate a step
 * against an index that no longer describes it.
 */
export function menuChanged(
  roomId: string,
  menu: Menu,
  menuVersion: number,
  pruned: { state: KitchenState; version: number } | null,
): void {
  const room = live.get(roomId)
  // Not in memory: nobody is connected, and `loadRoom` will read it fresh.
  if (!room) return

  room.menu = menu
  room.menuVersion = menuVersion
  room.index = buildIndex(menu)
  broadcast(room, { type: 'menu', menu, menuVersion })

  if (!pruned) return
  room.state = pruned.state
  room.version = pruned.version
  broadcast(room, { type: 'snapshot', version: pruned.version, state: pruned.state, origin: null })
}

export const send = (socket: WebSocket, msg: ServerMessage): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
}

function broadcast(room: LiveRoom, msg: ServerMessage): void {
  const payload = JSON.stringify(msg)
  for (const client of room.clients) {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(payload)
  }
}

/**
 * Cooks somebody is currently connected as. Two clients on the same cook
 * collapse into one entry — sharing a cook between a phone and a laptop is a
 * normal way to work, so it is not something to report or prevent.
 */
function presenceOf(room: LiveRoom): string[] {
  const ids = new Set<string>()
  for (const client of room.clients) if (client.cookId) ids.add(client.cookId)
  return [...ids]
}

/** Presence lives only in memory, so it is broadcast rather than persisted. */
function broadcastPresence(room: LiveRoom): void {
  broadcast(room, { type: 'presence', cookIds: presenceOf(room) })
}

/** Called when a client says who it is; a reconnect re-announces on `hello`. */
export function claim(room: LiveRoom, client: Client, cookId: string | null): void {
  if (client.cookId === cookId) return
  client.cookId = cookId
  broadcastPresence(room)
}

export function helloFor(room: LiveRoom, clientId: string): ServerMessage {
  return {
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    clientId,
    room: { id: room.id, name: room.name },
    menu: room.menu,
    menuVersion: room.menuVersion,
    state: room.state,
    version: room.version,
    presence: presenceOf(room),
  }
}

export function join(room: LiveRoom, socket: WebSocket): Client {
  if (room.evictAt) {
    clearTimeout(room.evictAt)
    room.evictAt = null
  }
  const client: Client = { id: newId(), socket, alive: true, cookId: null }
  room.clients.add(client)
  touchRoom(room.id)
  return client
}

export function leave(room: LiveRoom, client: Client): void {
  if (!room.clients.delete(client)) return // `close` and `error` can both fire.
  if (client.cookId) broadcastPresence(room)
  if (room.clients.size > 0 || room.evictAt) return
  room.evictAt = setTimeout(() => {
    // Re-check: a client may have arrived while the timer was pending.
    if (room.clients.size === 0) live.delete(room.id)
  }, EVICT_AFTER_MS)
  room.evictAt.unref()
}

/**
 * The authoritative write. The client's `at` is discarded in favour of the
 * server's clock, so a skewed browser can never persist a wrong timestamp —
 * its optimistic copy is simply corrected by the snapshot that comes back.
 */
export function submit(room: LiveRoom, client: Client, incoming: Envelope): void {
  const env: Envelope = { ...incoming, at: Date.now() }

  if (room.applied.has(env.id)) {
    // A replay. Acknowledge with the current state so the sender clears the
    // command from its pending queue, but change nothing and tell nobody else.
    send(client.socket, {
      type: 'snapshot',
      version: room.version,
      state: room.state,
      origin: { clientId: client.id, commandId: env.id },
    })
    return
  }

  const result = applyCommand(room.index, room.state, env)

  if (!result.ok) {
    send(client.socket, {
      type: 'rejected',
      commandId: env.id,
      ...(result.stepId === undefined ? {} : { stepId: result.stepId }),
      reason: result.reason,
    })
    return
  }

  const version = room.version + 1
  transact(() => {
    run(
      'UPDATE room SET state = ?, version = ?, updated_at = ?, last_seen_at = ? WHERE id = ?',
      JSON.stringify(result.state), version, env.at, env.at, room.id,
    )
    run(
      `INSERT INTO command_log (room_id, version, client_id, command_id, cmd, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      room.id, version, client.id, env.id, JSON.stringify(env.cmd), env.at,
    )
  })

  room.state = result.state
  room.version = version
  room.applied.add(env.id)
  if (room.applied.size > APPLIED_MEMORY) {
    const oldest = room.applied.values().next()
    if (!oldest.done) room.applied.delete(oldest.value)
  }

  const origin: Origin = { clientId: client.id, commandId: env.id }
  broadcast(room, { type: 'snapshot', version, state: room.state, origin })
}

export function snapshotFor(room: LiveRoom): ServerMessage {
  return { type: 'snapshot', version: room.version, state: room.state, origin: null }
}

export const liveRoomCount = (): number => live.size
export const liveClientCount = (): number =>
  [...live.values()].reduce((n, r) => n + r.clients.size, 0)
