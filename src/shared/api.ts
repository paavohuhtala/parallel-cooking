import { z } from 'zod'
import type { Menu } from '../model/types.ts'
import type { MenuProblem } from './menuDoc.ts'

/*
 * The REST surface, used for room management. Everything that happens *inside*
 * a room goes over the WebSocket instead. Request bodies are validated here;
 * responses are plain types, because only the trusted server produces them.
 */

const RoomName = z.string().trim().max(80).optional()

export const CreateRoomSchema = z.union([
  z.object({ name: RoomName, templateId: z.string().min(1) }),
  z.object({ name: RoomName, fromRoomId: z.string().min(1) }),
  z.object({ name: RoomName, fromMenuId: z.string().min(1) }),
])

export const RenameRoomSchema = z.object({ name: z.string().trim().min(1).max(80) })

export type CreateRoomBody = z.infer<typeof CreateRoomSchema>
export type RenameRoomBody = z.infer<typeof RenameRoomSchema>

export interface TemplateSummary {
  id: string
  name: string
  description?: string
  courseCount: number
  stepCount: number
}

export interface RoomSummary {
  id: string
  name: string
  menuName: string
  version: number
  createdAt: number
}

/*
 * Menu responses. Plain interfaces on purpose: this module is listed in
 * `tsconfig.e2e.json`'s `files`, and `composite` follows imports, so an edge
 * from here into `menuSchema.ts` would drag zod into the e2e program — and one
 * careless value-import away, into the client bundle.
 */

export interface MenuSummary {
  id: string
  name: string
  description?: string
  courseCount: number
  componentCount: number
  stepCount: number
  version: number
  updatedAt: number
}

export interface MenuDetail extends MenuSummary {
  menu: Menu
  /** True while a dev restart would still rewrite this menu from its code template. */
  followsTemplate: boolean
}

/** What a menu write returns; `version` is the editor's next `expectedVersion`. */
export interface MenuWriteResponse {
  version: number
  /** Rooms whose recorded progress lost steps the menu no longer has. */
  prunedRooms: string[]
}

export interface MenuImportResponse {
  menu: Menu
  /** Blocking when any has `severity: 'error'`. */
  problems: MenuProblem[]
  /** Things filled in or fixed up on the way in. */
  notes: string[]
  /** Absent for a dry run. */
  id?: string
}
