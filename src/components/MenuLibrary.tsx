import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { createMenu, createRoom, deleteMenu, getMenu, importMenu, listMenus } from '../api/client.ts'
import type { MenuSummary } from '../shared/api.ts'
import { toExportDoc } from '../shared/menuDoc.ts'
import { MenuImportDialog } from './MenuImportDialog.tsx'

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
        <MenuImportDialog
          title="Tuo menu"
          acceptLabel="Tuo"
          onClose={() => setImporting(false)}
          onAccept={async (menu) => {
            // A canonical menu is itself a valid document, so the same endpoint
            // stores it.
            const created = await importMenu(menu, { name: menu.name })
            setImporting(false)
            if (created.id) await open(created.id)
          }}
        />
      )}
    </section>
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
