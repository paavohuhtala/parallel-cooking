import { z } from 'zod'
import type { KitchenState, Menu } from '../model/types.ts'

/*
 * The wire format. Client → server is validated at runtime (it is untrusted);
 * server → client is a plain type, because the server is trusted and parsing
 * it would drag zod into the browser bundle.
 *
 * Two properties the rest of the system leans on:
 *
 *  - Every command is *idempotent*. `add_cook` carries a client-generated id
 *    and no-ops when it already exists; everything else is an assignment. That
 *    is what makes it safe for the client to replay its pending queue after a
 *    reconnect.
 *  - Nothing here is derived from ambient state. Timestamps and generated ids
 *    travel in the envelope, so `applyCommand` is a pure function and produces
 *    the same result on both sides.
 */

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set_step_state'),
    stepId: z.string().min(1),
    next: z.enum(['todo', 'active', 'done']),
    /** Omitted leaves the assignment alone; `null` clears it. */
    cookId: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('assign'),
    stepId: z.string().min(1),
    cookId: z.string().nullable(),
  }),
  z.object({
    type: z.literal('add_cook'),
    /** Client-generated, so the optimistic insert needs no temp-id swap. */
    cookId: z.uuid(),
  }),
  z.object({
    type: z.literal('rename_cook'),
    cookId: z.string().min(1),
    name: z.string().max(60),
  }),
  z.object({
    type: z.literal('remove_cook'),
    cookId: z.string().min(1),
  }),
])

/** A command plus the two things that must not be re-derived while applying it. */
export const EnvelopeSchema = z.object({
  id: z.uuid(),
  /** Client's clock on send; the server overwrites it with its own before applying. */
  at: z.number().int(),
  cmd: CommandSchema,
})

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command'), env: EnvelopeSchema }),
  z.object({ type: z.literal('resync') }),
  /**
   * Who is sitting at this socket. Not a command: it is per-connection and
   * dies with it, so it never reaches `applyCommand` or the database.
   */
  z.object({ type: z.literal('presence'), cookId: z.string().min(1).nullable() }),
])

export type Command = z.infer<typeof CommandSchema>
export type Envelope = z.infer<typeof EnvelopeSchema>
export type ClientMessage = z.infer<typeof ClientMessageSchema>

export interface Origin {
  clientId: string
  commandId: string
}

export type ServerMessage =
  | {
      type: 'hello'
      protocol: number
      clientId: string
      room: { id: string; name: string }
      menu: Menu
      menuVersion: number
      state: KitchenState
      version: number
      presence: string[]
    }
  /**
   * The whole state, every time. It is ~2 KB, and carrying it whole is what
   * lets the server delete records (a template refresh pruning steps that no
   * longer exist) without the protocol needing tombstones.
   */
  | { type: 'snapshot'; version: number; state: KitchenState; origin: Origin | null }
  | { type: 'menu'; menu: Menu; menuVersion: number }
  /**
   * Cooks with at least one connected client claiming them. Deliberately a set
   * and not a count: two phones on one cook is a normal way to work, not a
   * conflict to report.
   */
  | { type: 'presence'; cookIds: string[] }
  | { type: 'rejected'; commandId: string; stepId?: string; reason: string }
  | { type: 'error'; code: 'room_not_found' | 'protocol' | 'internal'; message: string }
