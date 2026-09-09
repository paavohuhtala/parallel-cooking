import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ApiError,
  createMenu,
  createRoom,
  deleteMenu,
  getMenu,
  importMenu,
  listMenus,
} from '../api/client.ts'
import type { MenuImportResponse, MenuSummary } from '../shared/api.ts'
import { toExportDoc } from '../shared/menuDoc.ts'
import { MENU_PROMPT } from '../shared/menuPrompt.ts'

/**
 * Menus you have written or imported, as opposed to the ones authored in code.
 * Starting a kitchen from one copies it, so a menu here can be edited between
 * dinners without touching a dinner already cooked from it.
 */
export function MenuLibrary() {
  const navigate = useNavigate()
  const [menus, setMenus] = useState<MenuSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = () =>
    listMenus()
      .then(setMenus)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))

  useEffect(() => {
    void refresh()
  }, [])

  const guard = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const open = (menuId: string) => navigate({ to: '/m/$menuId', params: { menuId } })

  return (
    <section className="landing-card">
      <div className="library-head">
        <h2>Omat menut</h2>
        <div className="library-actions">
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void guard(async () => {
                const created = await createMenu({ name: 'Uusi menu' })
                await open(created.id)
              })
            }
          >
            Uusi menu
          </button>
          <button className="btn" disabled={busy} onClick={() => setImporting(true)}>
            Tuo JSON
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {menus === null && <p className="muted">Ladataan…</p>}
      {menus?.length === 0 && (
        <p className="muted">
          Ei vielä omia menuja. Tee uusi, tai muunna resepti JSON-muotoon ja tuo se.
        </p>
      )}

      {menus && menus.length > 0 && (
        <ul className="menu-list">
          {menus.map((menu) => (
            <li key={menu.id} className="menu-row">
              <button className="menu-open" onClick={() => void open(menu.id)}>
                <strong>{menu.name}</strong>
                <small>
                  {menu.courseCount} ruokalaji{menu.courseCount === 1 ? '' : 'a'} ·{' '}
                  {menu.stepCount} vaihetta
                </small>
              </button>
              <div className="menu-row-actions">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void guard(async () => {
                      const room = await createRoom({ fromMenuId: menu.id })
                      await navigate({ to: '/r/$roomId', params: { roomId: room.id } })
                    })
                  }
                >
                  Käynnistä keittiö
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={busy}
                  aria-label={`Vie ${menu.name}`}
                  onClick={() =>
                    void guard(async () => {
                      const detail = await getMenu(menu.id)
                      download(detail.menu.name, toExportDoc(detail.menu))
                    })
                  }
                >
                  Vie
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={busy}
                  aria-label={`Kopioi ${menu.name}`}
                  onClick={() =>
                    void guard(async () => {
                      await createMenu({ fromMenuId: menu.id, name: `${menu.name} (kopio)` })
                      await refresh()
                    })
                  }
                >
                  Kopioi
                </button>
                <button
                  className="btn btn-ghost icon"
                  disabled={busy}
                  aria-label={`Poista ${menu.name}`}
                  onClick={() =>
                    void guard(async () => {
                      if (!confirm(`Poistetaanko menu "${menu.name}"?`)) return
                      await deleteMenu(menu.id)
                      await refresh()
                    })
                  }
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImported={(id) => {
            setImporting(false)
            void open(id)
          }}
        />
      )}
    </section>
  )
}

function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (id: string) => void
}) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<MenuImportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Parse here so a JSON typo reads as a JSON typo, not as a schema complaint. */
  const parse = (): unknown => {
    try {
      return JSON.parse(text)
    } catch (err) {
      setError(`JSON ei jäsenny: ${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  }

  const run = async (dryRun: boolean) => {
    setError(null)
    setPreview(null)
    const doc = parse()
    if (doc === undefined) return
    setBusy(true)
    try {
      const result = await importMenu(doc, { dryRun })
      if (dryRun) setPreview(result)
      else if (result.id) onImported(result.id)
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === 'object') {
        const body = err.body as Partial<MenuImportResponse>
        if (body.problems) setPreview(body as MenuImportResponse)
      }
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const blocking = preview?.problems.filter((p) => p.severity === 'error') ?? []

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Tuo menu"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Tuo menu</h2>
          <button className="btn btn-ghost icon" onClick={onClose} aria-label="Sulje">
            ✕
          </button>
        </div>

        <p className="muted small">
          Liitä JSON, tai valitse tiedosto. Muoto on kuvattu docs/menu-format.md:ssä.
        </p>

        <div className="import-tools">
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Valitse JSON-tiedosto"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (file) setText(await file.text())
            }}
          />
          <button
            className="btn btn-ghost"
            onClick={() => void navigator.clipboard.writeText(MENU_PROMPT).catch(() => {})}
          >
            Kopioi LLM-kehote
          </button>
        </div>

        <textarea
          className="import-text"
          rows={10}
          value={text}
          aria-label="Menu JSON-muodossa"
          placeholder='{ "name": "Illallinen", "courses": [ … ] }'
          onChange={(e) => setText(e.target.value)}
        />

        {error && <p className="error">{error}</p>}

        {preview && (
          <div className={`banner ${blocking.length ? 'banner-error' : 'banner-ok'}`}>
            <div>
              {blocking.length === 0 && (
                <p>
                  {preview.menu.courses.length} ruokalajia · {preview.menu.components.length} osaa
                  · {preview.menu.steps.length} vaihetta
                </p>
              )}
              <ul className="plain-list">
                {preview.problems.map((p, i) => (
                  <li key={i}>{p.message}</li>
                ))}
                {preview.notes.map((n, i) => (
                  <li key={`n${i}`} className="muted">
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" disabled={busy || !text.trim()} onClick={() => void run(true)}>
            Tarkista
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !text.trim() || blocking.length > 0}
            onClick={() => void run(false)}
          >
            {busy ? 'Tuodaan…' : 'Tuo'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Peruuta
          </button>
        </div>
      </div>
    </div>
  )
}

function download(name: string, doc: unknown): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[^\w\-. ]+/g, '-').trim() || 'menu'}.json`
  a.click()
  URL.revokeObjectURL(url)
}
