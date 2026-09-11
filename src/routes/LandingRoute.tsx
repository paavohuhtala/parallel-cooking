import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { deleteRoom, getRoom } from '../api/client.ts'
import { NewKitchenCard } from '../components/NewKitchenCard.tsx'
import { Icon } from '../components/icons.tsx'
import { cx } from '../components/cx.ts'
import { forgetRoom, listRecent, type RecentRoom } from '../state/recent.ts'
import ui from '../components/ui.module.css'
import styles from '../components/landing.module.css'

/**
 * How often the front page asks who is in each kitchen. Presence is a socket
 * thing and this page has no socket, so asking again is the only way it finds
 * out — and it has to, or the remove button would still be refusing a kitchen
 * you walked out of ten seconds ago. A handful of rooms, one point query each.
 */
const PRESENCE_POLL_MS = 3_000

export default function LandingRoute() {
  const navigate = useNavigate()
  const [recent, setRecent] = useState<RecentRoom[]>(listRecent)
  /** Cooks connected to each kitchen, as of the last look. Absent until it answers. */
  const [online, setOnline] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Drop rooms that no longer exist, so the list cannot rot, and read who is in
  // the ones that do — that is what decides whether they can be removed.
  const refresh = useCallback(() => {
    for (const room of listRecent()) {
      getRoom(room.id).then(
        (summary) => setOnline((counts) => ({ ...counts, [room.id]: summary.online })),
        () => {
          forgetRoom(room.id)
          setRecent(listRecent())
        },
      )
    }
  }, [])

  useEffect(() => {
    refresh()
    // Nothing happens behind a hidden tab; coming back is what makes the counts
    // worth having again, so the listener covers the gap the interval skipped.
    const timer = setInterval(() => {
      if (!document.hidden) refresh()
    }, PRESENCE_POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  const remove = async (room: RecentRoom) => {
    if (busy) return
    if (!confirm(`Poistetaanko keittiö "${room.name}"? Sitä ei saa takaisin.`)) return
    setBusy(room.id)
    setError(null)
    try {
      await deleteRoom(room.id)
      forgetRoom(room.id)
      setRecent(listRecent())
    } catch (err: unknown) {
      // Somebody walked in between the last look and the click: the server
      // refuses, and the fresh counts are what disable the button again.
      setError(err instanceof Error ? err.message : String(err))
      refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.landing}>
      <header className={styles.head}>
        <h1>Mössömestari</h1>
        <p>Suunnittele monen kokin illallinen ja seuraa etenemistä yhdessä.</p>
      </header>

      <NewKitchenCard />

      {recent.length > 0 && (
        <section className={styles.card} data-testid="landing-card">
          <h2>Viimeksi avatut</h2>
          <ul className={styles.recentList}>
            {recent.map((room) => {
              const here = online[room.id]
              return (
                <li
                  key={room.id}
                  className={styles.recentRow}
                  data-testid="recent-row"
                  {...(here === undefined ? {} : { 'data-online': here })}
                >
                  <button
                    className={styles.recentItem}
                    data-testid="recent-room"
                    onClick={() =>
                      void navigate({ to: '/r/$roomId', params: { roomId: room.id } })
                    }
                  >
                    <strong>{room.name}</strong>
                    <small data-testid="recent-room-time">
                      {new Date(room.lastVisitedAt).toLocaleString('fi-FI')}
                    </small>
                  </button>

                  {/* A kitchen with cooks in it says so, and says why the
                      remove button next to it is not offering itself. */}
                  {here !== undefined && here > 0 && (
                    <span
                      className={cx(ui.small, styles.recentOnline)}
                      data-testid="recent-room-online"
                    >
                      {here} paikalla
                    </span>
                  )}

                  <button
                    className={cx(ui.btn, ui.btnGhost, ui.icon)}
                    data-testid="recent-room-remove"
                    aria-label={`Poista ${room.name}`}
                    title={
                      here === undefined
                        ? 'Katsotaan onko keittiössä väkeä…'
                        : here > 0
                          ? 'Keittiössä on kokkeja paikalla'
                          : `Poista ${room.name}`
                    }
                    disabled={here === undefined || here > 0 || busy !== null}
                    onClick={() => void remove(room)}
                  >
                    <Icon name="close" />
                  </button>
                </li>
              )
            })}
          </ul>

          {error && (
            <p className={ui.error} data-testid="recent-error">
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
