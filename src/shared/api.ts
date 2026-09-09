import { z } from 'zod'

/*
 * The REST surface, used for room management. Everything that happens *inside*
 * a room goes over the WebSocket instead. Request bodies are validated here;
 * responses are plain types, because only the trusted server produces them.
 */

const RoomName = z.string().trim().max(80).optional()

export const CreateRoomSchema = z.union([
  z.object({ name: RoomName, templateId: z.string().min(1) }),
  z.object({ name: RoomName, fromRoomId: z.string().min(1) }),
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
