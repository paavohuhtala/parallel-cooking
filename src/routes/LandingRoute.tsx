import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { createRoom, getRoom, listTemplates } from '../api/client.ts'
import type { TemplateSummary } from '../shared/api.ts'
import { MenuLibrary } from '../components/MenuLibrary.tsx'
import { forgetRoom, listRecent, type RecentRoom } from '../state/recent.ts'

export default function LandingRoute() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [recent, setRecent] = useState<RecentRoom[]>(listRecent)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listTemplates()
      .then((list) => {
        setTemplates(list)
        setTemplateId((current) => current ?? list[0]?.id ?? null)
      })
      .catch((err: unknown) => setError(String(err)))
  }, [])

  // Drop rooms that no longer exist, so the list cannot rot.
  useEffect(() => {
    for (const room of listRecent()) {
      getRoom(room.id).catch(() => {
        forgetRoom(room.id)
        setRecent(listRecent())
      })
    }
  }, [])

  async function create() {
    if (!templateId || busy) return
    setBusy(true)
    setError(null)
    try {
      const room = await createRoom({ templateId, ...(name.trim() ? { name } : {}) })
      await navigate({ to: '/r/$roomId', params: { roomId: room.id } })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="landing">
      <header className="landing-head">
        <h1>Parallel Cooking</h1>
        <p>Suunnittele monen kokin illallinen ja seuraa etenemistä yhdessä.</p>
      </header>

      <section className="landing-card">
        <h2>Uusi keittiö</h2>

        <label className="field">
          <span>Nimi</span>
          <input
            value={name}
            placeholder="Esim. Lauantain illallinen"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
            }}
          />
        </label>

        <fieldset className="field">
          <legend>Menu</legend>
          {templates === null && <p className="muted">Ladataan…</p>}
          {templates?.map((t) => (
            <label key={t.id} className="template-option">
              <input
                type="radio"
                name="template"
                checked={templateId === t.id}
                onChange={() => setTemplateId(t.id)}
              />
              <span>
                <strong>{t.name}</strong>
                {t.description && <em>{t.description}</em>}
                <small>
                  {t.courseCount} ruokalaji{t.courseCount === 1 ? '' : 'a'} · {t.stepCount} vaihetta
                </small>
              </span>
            </label>
          ))}
        </fieldset>

        {error && <p className="error">{error}</p>}

        <button className="btn btn-primary" disabled={!templateId || busy} onClick={() => void create()}>
          {busy ? 'Luodaan…' : 'Luo keittiö'}
        </button>
        <p className="muted">Jaa linkki muille kokeille — kaikki näkevät saman tilanteen.</p>
      </section>

      <MenuLibrary />

      {recent.length > 0 && (
        <section className="landing-card">
          <h2>Viimeksi avatut</h2>
          <ul className="recent-list">
            {recent.map((room) => (
              <li key={room.id}>
                <button
                  className="recent-item"
                  onClick={() => void navigate({ to: '/r/$roomId', params: { roomId: room.id } })}
                >
                  <strong>{room.name}</strong>
                  <small>{new Date(room.lastVisitedAt).toLocaleString('fi-FI')}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
