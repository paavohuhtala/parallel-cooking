import type { Menu } from '../model/types.ts'
import type {
  CreateRoomBody,
  MenuDetail,
  MenuImportResponse,
  MenuSummary,
  MenuWriteResponse,
  RoomSummary,
  TemplateSummary,
} from '../shared/api.ts'

/**
 * Room and menu management. Everything that happens *inside* a room while
 * cooking travels over the WebSocket instead.
 *
 * Responses are typed but not re-validated: the server is the only thing that
 * produces them, and parsing them would pull zod into the bundle.
 */

/** Carries the status and body, so a 409 can hand the editor the menu it lost to. */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body: unknown) {
    // Fields are assigned in the body, not as parameter properties:
    // `erasableSyntaxOnly` forbids those.
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`, body)
  }
  return (await res.json()) as T
}

const send = (method: string, url: string, body?: unknown) =>
  fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })

const id = (value: string) => encodeURIComponent(value)

export const listTemplates = (): Promise<TemplateSummary[]> =>
  fetch('/api/templates').then(unwrap<TemplateSummary[]>)

export const getRoom = (roomId: string): Promise<RoomSummary> =>
  fetch(`/api/rooms/${id(roomId)}`).then(unwrap<RoomSummary>)

export const createRoom = (body: CreateRoomBody): Promise<RoomSummary> =>
  send('POST', '/api/rooms', body).then(unwrap<RoomSummary>)

/** Refused with a 409 while anybody still has the kitchen open. */
export const deleteRoom = (roomId: string): Promise<void> =>
  send('DELETE', `/api/rooms/${id(roomId)}`).then(async (res) => {
    if (!res.ok) await unwrap(res)
  })

/* ------------------------------------------------------------------- menus */

export const listMenus = (): Promise<MenuSummary[]> =>
  fetch('/api/menus').then(unwrap<MenuSummary[]>)

export const getMenu = (menuId: string): Promise<MenuDetail> =>
  fetch(`/api/menus/${id(menuId)}`).then(unwrap<MenuDetail>)

export const createMenu = (
  body: { name: string } | { name?: string; templateId: string } | { name?: string; fromMenuId: string },
): Promise<MenuDetail> => send('POST', '/api/menus', body).then(unwrap<MenuDetail>)

export const deleteMenu = (menuId: string): Promise<void> =>
  send('DELETE', `/api/menus/${id(menuId)}`).then(async (res) => {
    if (!res.ok) await unwrap(res)
  })

/**
 * Validate a document and, unless `dryRun`, store it. A rejected import comes
 * back as an `ApiError` whose `body` is the same `MenuImportResponse`, so the
 * dialog can list the problems either way.
 */
export const importMenu = (
  doc: unknown,
  opts: { name?: string; dryRun?: boolean } = {},
): Promise<MenuImportResponse & { id?: string }> =>
  send('POST', '/api/menus/import', { ...opts, doc }).then(
    unwrap<MenuImportResponse & { id?: string }>,
  )

export const saveMenu = (
  menuId: string,
  menu: Menu,
  expectedVersion: number,
): Promise<MenuWriteResponse> =>
  send('PUT', `/api/menus/${id(menuId)}`, { expectedVersion, menu }).then(
    unwrap<MenuWriteResponse>,
  )

export const getRoomMenu = (roomId: string): Promise<MenuDetail> =>
  fetch(`/api/rooms/${id(roomId)}/menu`).then(unwrap<MenuDetail>)

export const saveRoomMenu = (
  roomId: string,
  menu: Menu,
  expectedVersion: number,
): Promise<MenuWriteResponse> =>
  send('PUT', `/api/rooms/${id(roomId)}/menu`, { expectedVersion, menu }).then(
    unwrap<MenuWriteResponse>,
  )
