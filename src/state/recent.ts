/** Rooms this browser has opened. Purely a convenience for finding your way back. */

const KEY = 'parallel-cooking/rooms'
const LIMIT = 12

export interface RecentRoom {
  id: string
  name: string
  lastVisitedAt: number
}

export function listRecent(): RecentRoom[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (r): r is RecentRoom =>
          !!r && typeof r.id === 'string' && typeof r.name === 'string',
      )
      .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
  } catch {
    return []
  }
}

export function rememberRoom(room: { id: string; name: string }): void {
  try {
    const rest = listRecent().filter((r) => r.id !== room.id)
    const next = [{ ...room, lastVisitedAt: Date.now() }, ...rest].slice(0, LIMIT)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private mode: the list is a nicety, not a requirement.
  }
}

export function forgetRoom(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(listRecent().filter((r) => r.id !== id)))
  } catch {
    /* ignore */
  }
}
