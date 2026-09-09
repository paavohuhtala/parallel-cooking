import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { STATIONS, type Menu, type Station } from '../model/types.ts'
import type { MenuWriteResponse } from '../shared/api.ts'
import { errorsOf, toExportDoc, validateMenu, type MenuProblem } from '../shared/menuDoc.ts'
import { MENU_PROMPT } from '../shared/menuPrompt.ts'
import { ApiError } from '../api/client.ts'
import {
  applyDraftAction,
  dependencyCandidates,
  flattenMenu,
  rowKey,
  type MenuAction,
  type OutlineRow,
} from '../state/menuDraft.ts'

/*
 * The menu editor: a keyboard-first outliner over course → dish → step.
 *
 * Saving is explicit rather than per-keystroke, unlike the cook editor. Three
 * reasons it has to be: a half-typed menu is routinely invalid, every save
 * broadcasts a new menu to everyone connected to a kitchen using it, and the
 * "this will discard recorded progress" confirmation cannot be asked on every
 * keystroke. Nothing is lost in the meantime — the draft is mirrored to
 * sessionStorage and leaving with unsaved work asks first.
 */

export interface MenuEditorProps {
  initial: Menu
  initialVersion: number
  save: (menu: Menu, expectedVersion: number) => Promise<MenuWriteResponse>
  /** Distinct per menu, so two open drafts cannot overwrite each other. */
  storageKey: string
  /**
   * Titles of steps that have progress recorded and would lose it. Set only in
   * a room; the library has no kitchen to disturb.
   */
  progressAtRisk?: (next: Menu) => string[]
  onClose?: () => void
}

const KIND_LABEL = { course: 'Ruokalaji', component: 'Osa', step: 'Vaihe' } as const

export function MenuEditor({
  initial,
  initialVersion,
  save,
  storageKey,
  progressAtRisk,
  onClose,
}: MenuEditorProps) {
  const [saved, setSaved] = useState<Menu>(initial)
  const [draft, setDraft] = useState<Menu>(() => restore(storageKey) ?? initial)
  const [version, setVersion] = useState(initialVersion)
  const [focus, setFocus] = useState<string | null>(null)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const rows = useMemo(() => flattenMenu(draft), [draft])
  const problems = useMemo(() => validateMenu(draft), [draft])
  const blocking = useMemo(() => errorsOf(problems), [problems])
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved])

  const dispatch = useCallback((action: MenuAction) => {
    setDraft((current) => {
      const result = applyDraftAction(current, action)
      if (result.focus) setFocus(result.focus)
      return result.menu
    })
  }, [])

  // Mirror the draft so a reload, or a stray back button, does not cost work.
  useEffect(() => {
    try {
      if (dirty) sessionStorage.setItem(storageKey, JSON.stringify(draft))
      else sessionStorage.removeItem(storageKey)
    } catch {
      // Private mode: the draft simply is not kept across a reload.
    }
  }, [draft, dirty, storageKey])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // The reducer names the row that should hold the cursor; the view just obeys.
  useLayoutEffect(() => {
    if (!focus) return
    const el = document.querySelector<HTMLInputElement>(`[data-rowkey="${CSS.escape(focus)}"]`)
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
    setFocus(null)
  }, [focus, rows])

  const moveFocus = (from: string, delta: -1 | 1) => {
    const at = rows.findIndex((r) => r.key === from)
    const next = rows[at + delta]
    if (next) setFocus(next.key)
  }

  async function onSave() {
    if (busy || blocking.length > 0) return
    const canonical = toExportDoc(draft)

    const losing = progressAtRisk?.(canonical) ?? []
    if (losing.length > 0) {
      const list = losing.slice(0, 8).join('\n· ')
      const more = losing.length > 8 ? `\n… ja ${losing.length - 8} muuta` : ''
      if (
        !confirm(
          `Näiden vaiheiden merkinnät katoavat, koska vaiheet poistuvat menusta:\n\n· ${list}${more}\n\nTallennetaanko?`,
        )
      ) {
        return
      }
    }

    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const result = await save(canonical, version)
      setSaved(canonical)
      setDraft(canonical)
      // The next save must build on the version this write produced, not on the
      // one echoed back over the socket.
      setVersion(result.version)
      if (result.prunedRooms.length > 0) {
        setNote('Tallennettu. Poistettujen vaiheiden merkinnät poistettiin keittiöstä.')
      } else {
        setNote('Tallennettu.')
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Joku muu ehti muokata tätä menua. Avaa se uudelleen — muutoksesi ovat yhä tässä ikkunassa.'
          : err instanceof Error
            ? err.message
            : String(err),
      )
    } finally {
      setBusy(false)
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(toExportDoc(draft), null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slugFilename(draft.name)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(MENU_PROMPT)
      setNote('LLM-kehote kopioitu leikepöydälle.')
    } catch {
      setNote('Leikepöytä ei ole käytettävissä.')
    }
  }

  return (
    <div className="editor">
      <header className="editor-head">
        <input
          className="editor-title"
          value={draft.name}
          aria-label="Menun nimi"
          placeholder="Menun nimi"
          onChange={(e) => dispatch({ type: 'rename_menu', value: e.target.value })}
        />
        <div className="editor-actions">
          <button className="btn btn-ghost" onClick={() => void copyPrompt()}>
            Kopioi LLM-kehote
          </button>
          <button className="btn btn-ghost" onClick={exportJson}>
            Vie JSON
          </button>
          <span className={`editor-dirty${dirty ? ' is-dirty' : ''}`}>
            {dirty ? 'Tallentamattomia muutoksia' : 'Tallennettu'}
          </span>
          <button
            className="btn btn-primary"
            onClick={() => void onSave()}
            disabled={busy || !dirty || blocking.length > 0}
          >
            {busy ? 'Tallennetaan…' : 'Tallenna'}
          </button>
          {onClose && (
            <button className="btn btn-ghost icon" onClick={onClose} aria-label="Sulje">
              ✕
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}
      {note && !error && <div className="banner banner-ok">{note}</div>}

      <ProblemList problems={problems} onGo={(key) => setFocus(key)} />

      <div className="outline" role="tree" aria-label="Menun rakenne">
        {rows.map((row) => (
          <Row
            key={row.key}
            row={row}
            draft={draft}
            dispatch={dispatch}
            open={openRow === row.key}
            onToggleOpen={() => setOpenRow((cur) => (cur === row.key ? null : row.key))}
            onMoveFocus={moveFocus}
          />
        ))}
      </div>

      <p className="muted small editor-hint">
        Enter lisää rivin · Sarkain siirtää osan edelliseen · Vaihto+Sarkain nostaa vaiheen
        omaksi osaksi · Alt+↑/↓ siirtää · Askelpalautin tyhjällä rivillä poistaa
      </p>
    </div>
  )
}

function ProblemList({
  problems,
  onGo,
}: {
  problems: MenuProblem[]
  onGo: (key: string) => void
}) {
  if (problems.length === 0) return null
  const errors = problems.filter((p) => p.severity === 'error')
  return (
    <div className={`banner ${errors.length ? 'banner-error' : 'banner-warn'} editor-problems`}>
      <ul className="plain-list">
        {problems.slice(0, 6).map((problem, i) => (
          <li key={`${problem.code}-${i}`}>
            {problem.target ? (
              <button
                className="linky"
                onClick={() => onGo(rowKey(problem.target!.kind, problem.target!.id))}
              >
                {problem.message}
              </button>
            ) : (
              problem.message
            )}
          </li>
        ))}
        {problems.length > 6 && <li className="muted">… ja {problems.length - 6} muuta</li>}
      </ul>
    </div>
  )
}

function Row({
  row,
  draft,
  dispatch,
  open,
  onToggleOpen,
  onMoveFocus,
}: {
  row: OutlineRow
  draft: Menu
  dispatch: (action: MenuAction) => void
  open: boolean
  onToggleOpen: () => void
  onMoveFocus: (from: string, delta: -1 | 1) => void
}) {
  const step = row.kind === 'step' ? draft.steps.find((s) => s.id === row.id) : undefined
  const component =
    row.kind === 'component' ? draft.components.find((c) => c.id === row.id) : undefined

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      dispatch({ type: 'insert_after', kind: row.kind, id: row.id })
      return
    }
    if (e.key === 'Backspace' && e.currentTarget.value === '') {
      e.preventDefault()
      dispatch({ type: 'delete_row', kind: row.kind, id: row.id })
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const delta = e.key === 'ArrowUp' ? -1 : 1
      if (e.altKey) {
        e.preventDefault()
        dispatch({ type: 'move', kind: row.kind, id: row.id, delta })
      } else {
        e.preventDefault()
        onMoveFocus(row.key, delta)
      }
      return
    }
    // Tab only crosses the step/dish boundary; anywhere else it stays the
    // ordinary "move to the next control", which is what people expect.
    if (e.key === 'Tab' && !e.shiftKey && row.kind === 'component') {
      e.preventDefault()
      dispatch({ type: 'demote_component', id: row.id })
      return
    }
    if (e.key === 'Tab' && e.shiftKey && row.kind === 'step') {
      e.preventDefault()
      dispatch({ type: 'promote_step', id: row.id })
    }
  }

  return (
    <div className={`outline-row depth-${row.depth} kind-${row.kind}`} role="treeitem" aria-level={row.depth + 1}>
      <div className="outline-main">
        <span className="outline-bullet" aria-hidden>
          {row.kind === 'course' ? '▣' : row.kind === 'component' ? '▸' : '·'}
        </span>
        <input
          data-rowkey={row.key}
          className="outline-title"
          value={row.title}
          aria-label={`${KIND_LABEL[row.kind]}: ${row.title || 'nimetön'}`}
          placeholder={row.kind === 'step' ? 'Uusi vaihe' : `Uusi ${KIND_LABEL[row.kind].toLowerCase()}`}
          onChange={(e) =>
            dispatch({ type: 'rename', kind: row.kind, id: row.id, value: e.target.value })
          }
          onKeyDown={onKeyDown}
        />

        {step && (
          <span className="outline-stations">
            {STATIONS.map((s) => (
              <button
                key={s.id}
                // `muu` is the unremarkable default, so an active `muu` stays
                // quiet; every other station shows even when the row is idle,
                // or you could not scan a menu for what is on the stove.
                className={`chip station${step.station === s.id ? ' is-active' : ''}${
                  s.id === 'muu' ? ' is-quiet' : ''
                }`}
                aria-pressed={step.station === s.id}
                aria-label={s.label}
                title={s.label}
                onClick={() => dispatch({ type: 'set_station', id: row.id, station: s.id as Station })}
              >
                {s.icon}
              </button>
            ))}
          </span>
        )}

        <button className="btn btn-ghost icon" onClick={onToggleOpen} aria-expanded={open}
          aria-label={`Tiedot: ${row.title || 'nimetön'}`}>
          {open ? '▾' : '▸'}
        </button>
        <button
          className="btn btn-ghost icon"
          onClick={() => dispatch({ type: 'delete_row', kind: row.kind, id: row.id })}
          aria-label={`Poista ${row.title || 'nimetön'}`}
        >
          ✕
        </button>
      </div>

      {open && step && <StepDetails draft={draft} stepId={row.id} dispatch={dispatch} />}
      {open && component && (
        <ComponentDetails component={component} dispatch={dispatch} />
      )}
      {open && row.kind === 'course' && (
        <div className="outline-detail">
          <label className="field">
            <span>Huomio</span>
            <input
              value={draft.courses.find((c) => c.id === row.id)?.note ?? ''}
              onChange={(e) =>
                dispatch({ type: 'set_note', kind: 'course', id: row.id, value: e.target.value })
              }
            />
          </label>
        </div>
      )}
    </div>
  )
}

function StepDetails({
  draft,
  stepId,
  dispatch,
}: {
  draft: Menu
  stepId: string
  dispatch: (action: MenuAction) => void
}) {
  const step = draft.steps.find((s) => s.id === stepId)!
  const component = draft.components.find((c) => c.id === step.componentId)
  const [adding, setAdding] = useState('')
  const candidates = useMemo(() => dependencyCandidates(draft, stepId), [draft, stepId])
  const titleOf = (id: string) => draft.steps.find((s) => s.id === id)?.title || id

  return (
    <div className="outline-detail">
      <label className="field">
        <span>Ohje</span>
        <textarea
          rows={2}
          value={step.detail ?? ''}
          onChange={(e) => dispatch({ type: 'set_detail', id: stepId, value: e.target.value })}
        />
      </label>

      <fieldset className="field">
        <legend>Edellyttää</legend>
        <div className="chips">
          {step.deps.map((dep) => (
            <button
              key={dep}
              className="chip is-active"
              onClick={() => dispatch({ type: 'toggle_dep', id: stepId, depId: dep })}
              aria-label={`Poista riippuvuus ${titleOf(dep)}`}
            >
              {titleOf(dep)} ✕
            </button>
          ))}
          {/* Only steps that cannot close a cycle are offered at all. */}
          <select
            className="dep-picker"
            value=""
            aria-label="Lisää riippuvuus"
            onChange={(e) => {
              if (e.target.value) dispatch({ type: 'toggle_dep', id: stepId, depId: e.target.value })
            }}
          >
            <option value="">+ Riippuvuus…</option>
            {candidates
              .filter((c) => !step.deps.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {draft.components.find((k) => k.id === c.componentId)?.name} — {c.title}
                </option>
              ))}
          </select>
        </div>
      </fieldset>

      {component && (
        <fieldset className="field">
          <legend>Tarvitaan</legend>
          <div className="chips">
            {component.ingredients.map((ingredient) => (
              <button
                key={ingredient}
                className={`chip${step.uses?.includes(ingredient) ? ' is-active' : ''}`}
                aria-pressed={step.uses?.includes(ingredient) ?? false}
                onClick={() => dispatch({ type: 'toggle_use', id: stepId, ingredient })}
              >
                {ingredient}
              </button>
            ))}
            <input
              className="ingredient-add"
              placeholder="+ Uusi aines"
              aria-label="Lisää aines ja käytä tässä vaiheessa"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !adding.trim()) return
                e.preventDefault()
                dispatch({
                  type: 'add_ingredient',
                  componentId: component.id,
                  value: adding,
                  alsoUse: stepId,
                })
                setAdding('')
              }}
            />
          </div>
        </fieldset>
      )}

      <label className="toggle">
        <input
          type="checkbox"
          checked={step.holdPoint ?? false}
          onChange={() => dispatch({ type: 'toggle_hold', id: stepId })}
        />
        Voi tehdä etukäteen
      </label>
    </div>
  )
}

function ComponentDetails({
  component,
  dispatch,
}: {
  component: { id: string; note?: string; ingredients: string[] }
  dispatch: (action: MenuAction) => void
}) {
  const [adding, setAdding] = useState('')
  return (
    <div className="outline-detail">
      <label className="field">
        <span>Huomio</span>
        <input
          value={component.note ?? ''}
          onChange={(e) =>
            dispatch({ type: 'set_note', kind: 'component', id: component.id, value: e.target.value })
          }
        />
      </label>
      <fieldset className="field">
        <legend>Ainekset</legend>
        <div className="chips">
          {component.ingredients.map((ingredient) => (
            <button
              key={ingredient}
              className="chip"
              aria-label={`Poista aines ${ingredient}`}
              onClick={() =>
                dispatch({ type: 'remove_ingredient', componentId: component.id, value: ingredient })
              }
            >
              {ingredient} ✕
            </button>
          ))}
          <input
            className="ingredient-add"
            placeholder="+ Uusi aines"
            aria-label="Lisää aines"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !adding.trim()) return
              e.preventDefault()
              dispatch({ type: 'add_ingredient', componentId: component.id, value: adding })
              setAdding('')
            }}
          />
        </div>
      </fieldset>
    </div>
  )
}

function restore(key: string): Menu | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Menu) : null
  } catch {
    return null
  }
}

const slugFilename = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'menu'
