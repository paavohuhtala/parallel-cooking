/**
 * Runtime values shared by client and server, kept apart from `protocol.ts` on
 * purpose: that module's schemas pull in zod, and the client must reach it
 * through `import type` only so the bundler never sees the edge.
 */

/** Bumped whenever the wire format changes incompatibly. */
export const PROTOCOL_VERSION = 1
