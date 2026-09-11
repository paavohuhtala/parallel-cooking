import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { getRoom } from '../api/client.ts'
import { NewKitchenCard } from '../components/NewKitchenCard.tsx'
import { forgetRoom, listRecent, type RecentRoom } from '../state/recent.ts'

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
    <div className="landing">
      <header className="landing-head">
        <h1>Mössömestari</h1>
        <p>Suunnittele monen kokin illallinen ja seuraa etenemistä yhdessä.</p>
      </header>

      <NewKitchenCard />

      {recent.length > 0 && (
        <section className="landing-card" data-testid="landing-card">
          <h2>Viimeksi avatut</h2>
          <ul className="recent-list">
            {recent.map((room) => (
              <li key={room.id}>
                <button
                  className="recent-item"
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
