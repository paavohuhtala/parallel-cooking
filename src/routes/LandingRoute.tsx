import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { getRoom } from '../api/client.ts'
import { NewKitchenCard } from '../components/NewKitchenCard.tsx'
import { forgetRoom, listRecent, type RecentRoom } from '../state/recent.ts'
import styles from '../components/landing.module.css'

export default function LandingRoute() {
  const navigate = useNavigate()
  const [recent, setRecent] = useState<RecentRoom[]>(listRecent)

  // Drop rooms that no longer exist, so the list cannot rot.
  useEffect(() => {
    for (const room of listRecent()) {
      getRoom(room.id).catch(() => {
        forgetRoom(room.id)
        setRecent(listRecent())
      })
    }
  }, [])

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
            {recent.map((room) => (
              <li key={room.id}>
                <button
                  className={styles.recentItem}
                  data-testid="recent-room"
                  onClick={() => void navigate({ to: '/r/$roomId', params: { roomId: room.id } })}
                >
                  <strong>{room.name}</strong>
                  <small data-testid="recent-room-time">
                    {new Date(room.lastVisitedAt).toLocaleString('fi-FI')}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
