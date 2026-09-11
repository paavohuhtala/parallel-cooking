import { useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { useNavigate } from '@tanstack/react-router'
import {
  createMenu,
  createRoom,
  deleteMenu,
  getMenu,
  importMenu,
  listMenus,
  listTemplates,
} from '../api/client.ts'
import type { MenuSummary, TemplateSummary } from '../shared/api.ts'
import { toExportDoc } from '../shared/menuDoc.ts'
import { MenuImportDialog } from './MenuImportDialog.tsx'
import { Icon } from './icons.tsx'
import { cx } from './cx.ts'
import ui from './ui.module.css'
import shell from './landing.module.css'
import styles from './NewKitchenCard.module.css'

/**
 * "Uusi keittiö": name the dinner, pick the menu, start.
 *
 * The menus authored in code and the ones you have written or imported are one
 * list, because starting a kitchen from either is the same act — the same POST
 * with `templateId` or `fromMenuId`. They were two cards once, and only the
 * code menus could be given a name.
 *
 * Whichever you pick is *copied* into the kitchen, so editing a menu on this
 * shelf tomorrow cannot rewrite a dinner already being cooked.
 */

interface Choice {
  kind: 'template' | 'menu'
  id: string
  name: string
  description?: string
  courseCount: number
  stepCount: number
}

const keyOf = (choice: Pick<Choice, 'kind' | 'id'>) => `${choice.kind}:${choice.id}`

const fromTemplate = (t: TemplateSummary): Choice => ({ kind: 'template', ...t })
const fromMenu = (m: MenuSummary): Choice => ({
  kind: 'menu',
  id: m.id,
  name: m.name,
  ...(m.description === undefined ? {} : { description: m.description }),
  courseCount: m.courseCount,
  stepCount: m.stepCount,
})

export function NewKitchenCard() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null)
  const [menus, setMenus] = useState<MenuSummary[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshMenus = () => listMenus().then(setMenus)

  useEffect(() => {
    Promise.all([listTemplates().then(setTemplates), refreshMenus()]).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    )
  }, [])

  const choices: Choice[] = [
    ...(templates ?? []).map(fromTemplate),
    ...(menus ?? []).map(fromMenu),
  ]

  // Derived rather than corrected in an effect: a menu can be deleted out from
  // under the selection, and the fallback has to be right on that same render.
  const selected =
    choices.find((c) => keyOf(c) === picked) ?? (choices.length > 0 ? choices[0] : null)

  const guard = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const open = (menuId: string) => navigate({ to: '/m/$menuId', params: { menuId } })

  const create = () =>
    guard(async () => {
      if (!selected) return
      const named = name.trim() || undefined
      const room = await createRoom(
        selected.kind === 'template'
          ? { templateId: selected.id, name: named }
          : { fromMenuId: selected.id, name: named },
      )
      await navigate({ to: '/r/$roomId', params: { roomId: room.id } })
    })

  /** Copies a menu — a code one or your own — and leaves you on the new copy. */
  const copy = (choice: Choice) =>
    guard(async () => {
      const created = await createMenu(
        choice.kind === 'template'
          ? { templateId: choice.id }
          : { fromMenuId: choice.id, name: `${choice.name} (kopio)` },
      )
      await refreshMenus()
      setPicked(keyOf({ kind: 'menu', id: created.id }))
    })

  return (
    <section className={shell.card} data-testid="landing-card">
      <h2>Uusi keittiö</h2>

      <label className={ui.field}>
        <span>Nimi</span>
        <input
          className={ui.textInput}
          value={name}
          placeholder="Esim. Lauantain illallinen"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
        />
      </label>

      <fieldset className={ui.field}>
        <legend>Menu</legend>

        {choices.length === 0 && <p className={ui.muted}>Ladataan…</p>}

        {choices.length > 0 && (
          <ul className={styles.menuList}>
            {choices.map((choice) => (
              <li key={keyOf(choice)} className={styles.menuRow} data-testid="menu-row">
                <label className={styles.menuChoice}>
                  <input
                    type="radio"
                    name="menu"
                    checked={selected !== null && keyOf(selected) === keyOf(choice)}
                    onChange={() => setPicked(keyOf(choice))}
                  />
                  <span>
                    <span className={styles.menuChoiceTitle}>
                      {/* The name is a text node of its own: a test matches a
                          menu by its exact name, badge or no badge. */}
                      <strong>{choice.name}</strong>
                      {choice.kind === 'template' && (
                        <em className={styles.menuBadge}>Valmis pohja</em>
                      )}
                    </span>
                    {choice.description && <em>{choice.description}</em>}
                    <small>
                      {choice.courseCount} ruokalaji{choice.courseCount === 1 ? '' : 'a'} ·{' '}
                      {choice.stepCount} vaihetta
                    </small>
                  </span>
                </label>

                <div className={styles.menuRowActions}>
                  {choice.kind === 'menu' && (
                    <button
                      className={cx(ui.btn, ui.btnGhost)}
                      disabled={busy}
                      aria-label={`Muokkaa ${choice.name}`}
                      onClick={() => void open(choice.id)}
                    >
                      Muokkaa
                    </button>
                  )}
                  {choice.kind === 'menu' && (
                    <button
                      className={cx(ui.btn, ui.btnGhost)}
                      disabled={busy}
                      aria-label={`Vie ${choice.name}`}
                      onClick={() =>
                        void guard(async () => {
                          const detail = await getMenu(choice.id)
                          download(detail.menu.name, toExportDoc(detail.menu))
                        })
                      }
                    >
                      Vie
                    </button>
                  )}
                  <button
                    className={cx(ui.btn, ui.btnGhost)}
                    disabled={busy}
                    aria-label={`Kopioi ${choice.name}`}
                    onClick={() => void copy(choice)}
                  >
                    {choice.kind === 'template' ? 'Kopioi omaksi' : 'Kopioi'}
                  </button>
                  {choice.kind === 'menu' && (
                    <button
                      className={cx(ui.btn, ui.btnGhost, ui.icon)}
                      disabled={busy}
                      aria-label={`Poista ${choice.name}`}
                      onClick={() =>
                        void guard(async () => {
                          if (!confirm(`Poistetaanko menu "${choice.name}"?`)) return
                          await deleteMenu(choice.id)
                          await refreshMenus()
                        })
                      }
                    >
                      <Icon name="close" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.libraryActions}>
          <button
            className={ui.btn}
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
          <button className={ui.btn} disabled={busy} onClick={() => setImporting(true)}>
            Tuo JSON
          </button>
        </div>
      </fieldset>

      {error && (
        <p className={ui.error} data-testid="error">
          {error}
        </p>
      )}

      <button
        className={cx(ui.btn, ui.btnPrimary)}
        disabled={!selected || busy}
        onClick={() => void create()}
      >
        {busy ? 'Luodaan…' : 'Luo keittiö'}
      </button>
      <p className={ui.muted}>Jaa linkki muille kokeille — kaikki näkevät saman tilanteen.</p>

      <AnimatePresence>
        {importing && (
          <MenuImportDialog
            key="import"
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
      </AnimatePresence>
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
