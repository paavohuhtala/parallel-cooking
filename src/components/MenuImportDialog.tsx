import { useState } from 'react'
import type { Menu } from '../model/types.ts'
import type { MenuImportResponse } from '../shared/api.ts'
import { MENU_PROMPT } from '../shared/menuPrompt.ts'
import { ApiError, importMenu } from '../api/client.ts'

/**
 * Paste or open a JSON document, check it, and hand the caller the canonical
 * menu it describes.
 *
 * The dialog never writes anything itself. It validates with a dry run — which
 * is also where a document is normalised, ids filled in and dependencies written
 * as titles resolved — and passes the result on. That is what lets the same
 * dialog create a new library menu and merge a recipe into a menu already open
 * in the editor.
 */
export function MenuImportDialog({
  title,
  acceptLabel,
  onAccept,
  onClose,
}: {
  title: string
  acceptLabel: string
  onAccept: (menu: Menu) => void | Promise<void>
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<MenuImportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function check(): Promise<MenuImportResponse | null> {
    setError(null)
    setPreview(null)

    let doc: unknown
    try {
      // Parsed here so a JSON typo reads as a JSON typo rather than as a
      // complaint about the schema.
      doc = JSON.parse(text)
    } catch (err) {
      setError(`JSON ei jäsenny: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }

    setBusy(true)
    try {
      const result = await importMenu(doc, { dryRun: true })
      setPreview(result)
      return result
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === 'object') {
        const body = err.body as Partial<MenuImportResponse>
        if (body.problems) setPreview(body as MenuImportResponse)
      }
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function accept() {
    // Re-check rather than trusting a preview from before the last edit.
    const result = preview ?? (await check())
    if (!result || result.problems.some((p) => p.severity === 'error')) return
    setBusy(true)
    try {
      await onAccept(result.menu)
    } catch (err) {
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
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost icon" onClick={onClose} aria-label="Sulje">
            ✕
          </button>
        </div>

        <p className="muted small">
          Liitä JSON tai valitse tiedosto. Muoto on kuvattu docs/menu-format.md:ssä.
        </p>

        <div className="import-tools">
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Valitse JSON-tiedosto"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (file) {
                setText(await file.text())
                setPreview(null)
              }
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
          onChange={(e) => {
            setText(e.target.value)
            setPreview(null)
          }}
        />

        {error && <p className="error">{error}</p>}

        {preview && (
          <div className={`banner ${blocking.length ? 'banner-error' : 'banner-ok'}`}>
            <div>
              {blocking.length === 0 && (
                <p>
                  {preview.menu.courses.length} ruokalajia · {preview.menu.components.length} osaa ·{' '}
                  {preview.menu.steps.length} vaihetta
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
          <button className="btn" disabled={busy || !text.trim()} onClick={() => void check()}>
            Tarkista
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !text.trim() || blocking.length > 0}
            onClick={() => void accept()}
          >
            {busy ? 'Odota…' : acceptLabel}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Peruuta
          </button>
        </div>
      </div>
    </div>
  )
}
