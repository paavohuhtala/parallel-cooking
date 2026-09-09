import type { KitchenState, Menu } from '../model/types.ts'
import { applyCommand, initialState } from '../shared/apply.ts'
import type { Command, Envelope, ServerMessage } from '../shared/protocol.ts'
import { buildIndex, type GraphIndex } from './graph.ts'

export type Connection = 'connecting' | 'online' | 'offline'

export interface Rejection {
  /** Null when the command was not about a particular step. */
  stepId: string | null
  reason: string
  at: number
}

export interface SessionSnapshot {
  ready: boolean
  room: { id: string; name: string } | null
  menu: Menu | null
  index: GraphIndex | null
  /** Confirmed state with the pending queue replayed on top. */
  state: KitchenState
  version: number
  connection: Connection
  rejection: Rejection | null
  /** Set when the room does not exist; no reconnect is attempted. */
  fatal: string | null
}

const RECONNECT_MIN_MS = 250
const RECONNECT_MAX_MS = 5_000
/** Pending commands older than this are dropped rather than replayed. */
const REPLAY_WINDOW_MS = 30_000
const REJECTION_TTL_MS = 8_000
/** React 19 StrictMode mounts, unmounts and remounts; don't churn a socket over it. */
const RELEASE_GRACE_MS = 100

function socketUrl(roomId: string): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}/ws?room=${encodeURIComponent(roomId)}`
}

/**
 * One room's client-side session: the socket, the confirmed state, and the
 * queue of commands sent but not yet acknowledged.
 *
 * Optimism is a replay, not an inverse: the visible state is always
 * `pending.reduce(applyCommand, confirmed)`. Rolling a command back is dropping
 * it from the queue and recomputing, which is why the reducer had to be pure
 * and shared with the server.
 */
export class Session {
  private socket: WebSocket | null = null
  private confirmed: KitchenState = initialState()
  private version = 0
  private pending: Envelope[] = []
  private menu: Menu | null = null
  private index: GraphIndex | null = null
  private room: { id: string; name: string } | null = null
  private connection: Connection = 'connecting'
  private rejection: Rejection | null = null
  private rejectionTimer: ReturnType<typeof setTimeout> | null = null
  private fatal: string | null = null

  private listeners = new Set<() => void>()
  private refs = 0
  private releaseTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private snapshot: SessionSnapshot
  readonly roomId: string

  constructor(roomId: string) {
    this.roomId = roomId
    this.snapshot = this.build()
  }

  // --- subscription -------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.acquire()
    return () => {
      this.listeners.delete(listener)
      this.release()
    }
  }

  getSnapshot = (): SessionSnapshot => this.snapshot

  private acquire(): void {
    this.refs++
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer)
      this.releaseTimer = null
    }
    if (!this.socket && !this.fatal) this.connect()
  }

  private release(): void {
    this.refs--
    if (this.refs > 0 || this.releaseTimer) return
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null
      if (this.refs === 0) this.teardown()
    }, RELEASE_GRACE_MS)
  }

  private teardown(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    socket?.close(1000, 'left')
    sessions.delete(this.roomId)
  }

  // --- state --------------------------------------------------------------

  private optimistic(): KitchenState {
    if (!this.index || this.pending.length === 0) return this.confirmed
    const index = this.index
    return this.pending.reduce((state, env) => {
      const result = applyCommand(index, state, env)
      return result.ok ? result.state : state
    }, this.confirmed)
  }

  private build(): SessionSnapshot {
    return {
      ready: this.menu !== null && this.room !== null,
      room: this.room,
      menu: this.menu,
      index: this.index,
      state: this.optimistic(),
      version: this.version,
      connection: this.connection,
      rejection: this.rejection,
      fatal: this.fatal,
    }
  }

  private emit(): void {
    this.snapshot = this.build()
    for (const listener of this.listeners) listener()
  }

  private setRejection(rejection: Rejection | null): void {
    this.rejection = rejection
    if (this.rejectionTimer) clearTimeout(this.rejectionTimer)
    this.rejectionTimer = null
    if (rejection) {
      this.rejectionTimer = setTimeout(() => {
        this.rejection = null
        this.emit()
      }, REJECTION_TTL_MS)
    }
  }

  dismissRejection = (): void => {
    this.setRejection(null)
    this.emit()
  }

  /** Records a refusal the client worked out for itself, without sending anything. */
  reject = (stepId: string | null, reason: string): void => {
    this.setRejection({ stepId, reason, at: Date.now() })
    this.emit()
  }

  // --- sending ------------------------------------------------------------

  /**
   * Applies `cmd` optimistically and queues it for the server. Returns false if
   * the command is already illegal locally, in which case nothing is sent — the
   * server would only reject it, and the round trip would make the UI flicker.
   */
  send = (cmd: Command): boolean => {
    if (!this.index) return false
    const env: Envelope = { id: crypto.randomUUID(), at: Date.now(), cmd }
    const result = applyCommand(this.index, this.optimistic(), env)
    if (!result.ok) {
      this.setRejection({ stepId: result.stepId ?? null, reason: result.reason, at: env.at })
      this.emit()
      return false
    }
    this.pending.push(env)
    this.setRejection(null)
    this.emit()
    this.write({ type: 'command', env })
    return true
  }

  /** The state a caller should reason about: confirmed plus everything in flight. */
  current = (): KitchenState => this.snapshot.state
  currentIndex = (): GraphIndex | null => this.index

  private write(msg: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg))
  }

  // --- transport ----------------------------------------------------------

  private connect(): void {
    if (this.socket || this.fatal) return
    this.connection = this.menu ? this.connection : 'connecting'
    const socket = new WebSocket(socketUrl(this.roomId))
    this.socket = socket

    socket.onmessage = (event) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage
      } catch {
        return
      }
      this.handle(msg)
    }

    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.fatal) return
      this.connection = 'offline'
      this.emit()
      this.scheduleReconnect()
    }

    socket.onerror = () => socket.close()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.refs === 0 || this.fatal) return
    const base = Math.min(RECONNECT_MIN_MS * 2 ** this.attempt, RECONNECT_MAX_MS)
    const delay = base / 2 + Math.random() * (base / 2)
    this.attempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'hello': {
        this.attempt = 0
        this.room = msg.room
        if (this.menu !== msg.menu) {
          this.menu = msg.menu
          this.index = buildIndex(msg.menu)
        }
        this.confirmed = msg.state
        this.version = msg.version
        this.connection = 'online'

        // Replay what was in flight when the connection dropped. Safe only
        // because every command is idempotent; bounded in time so a tap from
        // long ago cannot resurrect itself over someone else's later change.
        const cutoff = Date.now() - REPLAY_WINDOW_MS
        this.pending = this.pending.filter((env) => env.at >= cutoff)
        this.emit()
        for (const env of this.pending) this.write({ type: 'command', env })
        return
      }

      case 'snapshot': {
        if (msg.version < this.version) return
        this.confirmed = msg.state
        this.version = msg.version
        if (msg.origin) {
          const id = msg.origin.commandId
          this.pending = this.pending.filter((env) => env.id !== id)
        }
        this.emit()
        return
      }

      case 'menu': {
        this.menu = msg.menu
        this.index = buildIndex(msg.menu)
        this.emit()
        return
      }

      case 'rejected': {
        this.pending = this.pending.filter((env) => env.id !== msg.commandId)
        this.setRejection({
          stepId: msg.stepId ?? null,
          reason: msg.reason,
          at: Date.now(),
        })
        this.emit()
        return
      }

      case 'error': {
        if (msg.code === 'room_not_found') {
          this.fatal = msg.message
          this.connection = 'offline'
          this.emit()
          return
        }
        this.setRejection({ stepId: null, reason: msg.message, at: Date.now() })
        this.emit()
        return
      }
    }
  }
}

/**
 * One session per room, shared by every component that asks for it. Module
 * scope rather than a ref, so StrictMode's remount finds the same socket.
 */
const sessions = new Map<string, Session>()

export function sessionFor(roomId: string): Session {
  const existing = sessions.get(roomId)
  if (existing) return existing
  const session = new Session(roomId)
  sessions.set(roomId, session)
  return session
}
