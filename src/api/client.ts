import type { CreateRoomBody, RoomSummary, TemplateSummary } from '../shared/api.ts'

/**
 * Room management only — everything inside a room travels over the WebSocket.
 * Responses are typed but not re-validated: the server is the only thing that
 * produces them, and parsing them would pull zod into the bundle.
 */

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

const postJson = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

export const listTemplates = (): Promise<TemplateSummary[]> =>
  fetch('/api/templates').then(unwrap<TemplateSummary[]>)

export const getRoom = (id: string): Promise<RoomSummary> =>
  fetch(`/api/rooms/${encodeURIComponent(id)}`).then(unwrap<RoomSummary>)

export const createRoom = (body: CreateRoomBody): Promise<RoomSummary> =>
  postJson('/api/rooms', body).then(unwrap<RoomSummary>)
