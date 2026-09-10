import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { STATIONS, type Menu, type Station } from '../model/types.ts'
import type { MenuWriteResponse } from '../shared/api.ts'
import { errorsOf, toExportDoc, validateMenu, type MenuProblem } from '../shared/menuDoc.ts'
import { MENU_PROMPT } from '../shared/menuPrompt.ts'
import { ApiError } from '../api/client.ts'
import { MenuImportDialog } from './MenuImportDialog.tsx'
import { Icon, STATION_ICON } from './icons.tsx'
import {
  ancestorKeys,
  dependencyCandidates,
  outlineItems,
  rowKey,
  type MenuAction,
  type OutlineItem,
  type OutlineRow,
} from '../state/menuDraft.ts'
import {
  applyHistory,
  canRedo,
  canUndo,
  initialHistory,
  type DraftHistory,
} from '../state/draftHistory.ts'

/*
 * The menu editor: course → dish → step as an outline, with an inspector
 * beside it.
 *
 * Three rules decide the layout, and they are what keep the two kinds of
 * "expand" from colliding:
 *
 *  - **The left glyph is the only disclosure.** On a course or a dish it means
 *    one thing and nothing else: show or hide the children. A step has no
 *    children, so its slot carries the station instead — and opens the details.
 *  - **Details are never inline.** They live in the inspector, which is a
 *    column on a desktop and a sheet on a phone. So there is no second toggle
 *    on a row competing with the first, and the outline never reflows while
 *    you edit a step.
 *  - **Every list ends in a tail row.** "+ Osa" and "+ Vaihe" are always there,
 *    which is the only way an empty course or dish can be filled at all, and
 *    the only way any of this works without a keyboard.
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

/** "1 osa" but "2 osaa": the partitive the counts need. */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const stationOf = (id: Station) => STATIONS.find((s) => s.id === id)!

export function MenuEditor({
  initial,
  initialVersion,
  save,
  storageKey,
  progressAtRisk,
  onClose,
}: MenuEditorProps) {
  const [saved, setSaved] = useState<Menu>(initial)
  // The draft and its undo stack are one state value on purpose: pushing the
  // replaced menu has to happen inside the same pure updater that produces the
  // new one, or StrictMode's double invocation records the step twice.
  const [history, setHistory] = useState<DraftHistory>(() =>
    initialHistory(restore(storageKey) ?? initial),
  )
  const draft = history.menu
  const [version, setVersion] = useState(initialVersion)
  const [focus, setFocus] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  /** Only the phone-sized inspector needs opening; the column is always there. */
  const [sheetOpen, setSheetOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const items = useMemo(() => outlineItems(draft, collapsed), [draft, collapsed])
  const problems = useMemo(() => validateMenu(draft), [draft])
  const blocking = useMemo(() => errorsOf(problems), [problems])
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved])

  /** Rows currently on screen — what ↑/↓ walks, so collapsed rows are skipped. */
  const visible = useMemo(
    () => items.flatMap((item) => (item.type === 'row' ? [item.row] : [])),
    [items],
  )
  const selectedRow = useMemo(
    () => visible.find((r) => r.key === selected) ?? null,
    [visible, selected],
  )

  const reveal = useCallback((menu: Menu, key: string) => {
    const hidden = ancestorKeys(menu, key)
    if (hidden.length > 0) {
      setCollapsed((current) => {
        if (!hidden.some((k) => current.has(k))) return current
        const next = new Set(current)
        hidden.forEach((k) => next.delete(k))
        return next
      })
    }
    setSelected(key)
    setFocus(key)
  }, [])

  const dispatch = useCallback(
    (action: MenuAction) => {
      setHistory((current) => {
        const result = applyHistory(current, { type: 'apply', action })
        if (result.focus) reveal(result.state.menu, result.focus)
        return result.state
      })
    },
    [reveal],
  )

  const undo = useCallback(() => setHistory((h) => applyHistory(h, { type: 'undo' }).state), [])
  const redo = useCallback(() => setHistory((h) => applyHistory(h, { type: 'redo' }).state), [])

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  const openDetails = useCallback((key: string) => {
    setSelected(key)
    setSheetOpen(true)
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

  /*
   * Undo is the editor's, not the browser's.
   *
   * A row is an `<input>`, so the native stack would only ever reach the text
   * in one field — and the moment a structural action remounts that input it is
   * gone anyway. Taking the key means one stack for the whole document, which
   * is the only kind that can put back a deleted course. Coalescing in
   * `draftHistory` is what keeps it from feeling coarse: a run of typing is
   * still one step.
   *
   * The import dialog is left alone: it has a textarea of pasted JSON where the
   * native stack is exactly what you want.
   */
  useEffect(() => {
    if (merging) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.metaKey || e.ctrlKey) || e.altKey) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [merging, undo, redo])

  // The reducer names the row that should hold the cursor; the view just obeys.
  useLayoutEffect(() => {
    if (!focus) return
    const el = document.querySelector<HTMLInputElement>(`[data-rowkey="${CSS.escape(focus)}"]`)
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
    setFocus(null)
  }, [focus, items])

  const moveFocus = (from: string, delta: -1 | 1) => {
    const at = visible.findIndex((r) => r.key === from)
    const next = visible[at + delta]
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
      // The stack survives a save: saving is not a wall you cannot undo past.
      setHistory((h) => applyHistory(h, { type: 'replace', menu: canonical }).state)
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
          {/* Undo has to be reachable without a keyboard too: the row menu's
              Poista is a thumb's only way to delete, so it needs a thumb's way
              back. */}
          <div className="editor-history">
            <button
              className="btn btn-ghost icon"
              onClick={undo}
              disabled={!canUndo(history)}
              aria-label="Kumoa"
              title="Kumoa (Ctrl+Z)"
            >
              <Icon name="undo" />
            </button>
            <button
              className="btn btn-ghost icon"
              onClick={redo}
              disabled={!canRedo(history)}
              aria-label="Tee uudelleen"
              title="Tee uudelleen (Vaihto+Ctrl+Z)"
            >
              <Icon name="redo" />
            </button>
          </div>
          {/* One recipe at a time is how a model converts them, so assembling a
              multi-course dinner means merging several documents into this one. */}
          <button className="btn btn-ghost" onClick={() => setMerging(true)}>
            Tuo ja yhdistä
          </button>
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
              <Icon name="close" />
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

      <ProblemList problems={problems} onGo={(key) => reveal(draft, key)} />

      <div className="editor-body">
        <div className="outline" role="tree" aria-label="Menun rakenne">
          {items.map((item) =>
            item.type === 'row' ? (
              <Row
                key={item.key}
                item={item}
                dispatch={dispatch}
                selected={selected === item.key}
                onSelect={setSelected}
                onOpenDetails={openDetails}
                onToggleCollapse={toggleCollapse}
                onMoveFocus={moveFocus}
              />
            ) : (
              <TailRow key={item.key} item={item} dispatch={dispatch} />
            ),
          )}
        </div>

        <Inspector
          draft={draft}
          row={selectedRow}
          dispatch={dispatch}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
        />
      </div>

      {merging && (
        <MenuImportDialog
          title="Tuo ja yhdistä"
          acceptLabel="Yhdistä"
          onClose={() => setMerging(false)}
          onAccept={(incoming) => {
            dispatch({ type: 'merge', incoming })
            setMerging(false)
            setNote('Ruokalajit lisättiin. Tarkista ja tallenna.')
          }}
        />
      )}

      <p className="muted small editor-hint">
        Enter lisää rivin · Vaihto+Enter lisää sisällön · ↑/↓ siirtyy rivien välillä ·
        Alt+↑/↓ siirtää riviä · Askelpalautin tyhjällä rivillä poistaa sen, jos sillä ei ole
        sisältöä · Ctrl+Z kumoaa · rivin valikko tekee saman hiirellä
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

/* --------------------------------------------------------------------- rows */

function Row({
  item,
  dispatch,
  selected,
  onSelect,
  onOpenDetails,
  onToggleCollapse,
  onMoveFocus,
}: {
  item: Extract<OutlineItem, { type: 'row' }>
  dispatch: (action: MenuAction) => void
  selected: boolean
  onSelect: (key: string) => void
  onOpenDetails: (key: string) => void
  onToggleCollapse: (key: string) => void
  onMoveFocus: (from: string, delta: -1 | 1) => void
}) {
  const { row, collapsed } = item
  const name = row.title || 'nimetön'
  const parent = row.kind !== 'step'

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Shift+Enter reaches inwards, which is the only direction Enter cannot:
      // the first dish of a course, the first step of a dish.
      if (e.shiftKey && parent) {
        dispatch({ type: 'insert_child', kind: row.kind as 'course' | 'component', id: row.id })
      } else {
        dispatch({ type: 'insert_after', kind: row.kind, id: row.id })
      }
      return
    }
    if (e.key === 'Backspace' && e.currentTarget.value === '') {
      e.preventDefault()
      // Only a row with nothing under it. Renaming a course by selecting the
      // name and retyping it leaves the field empty for exactly as long as it
      // takes to press Backspace once too often — and for a course that used to
      // mean the course, every dish in it and every step in those. Emptying a
      // parent is not a request to delete its contents; that is what the row
      // menu's Poista is for, deliberately reached on purpose rather than by
      // one more keystroke.
      if (row.childCount === 0) dispatch({ type: 'delete_row', kind: row.kind, id: row.id })
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const delta = e.key === 'ArrowUp' ? -1 : 1
      e.preventDefault()
      if (e.altKey) dispatch({ type: 'move', kind: row.kind, id: row.id, delta })
      else onMoveFocus(row.key, delta)
      return
    }
    // Tab is deliberately left alone. It is the one key every user already
    // knows the meaning of — move to the next control — and a version of it
    // that restructures the document means tabbing out of a field silently
    // rewrites the recipe. Rows move with Alt+arrows and nothing else.
  }

  return (
    <div
      className={`outline-row depth-${row.depth} kind-${row.kind}${selected ? ' is-selected' : ''}`}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      {...(parent ? { 'aria-expanded': !collapsed } : {})}
    >
      <div
        className="outline-main"
        // The title is only as wide as its text, so the rest of the row is
        // blank; a press there still means "this row" and lands in the title.
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          const input = e.currentTarget.querySelector<HTMLInputElement>('.outline-title')
          input?.focus()
          input?.setSelectionRange(input.value.length, input.value.length)
        }}
      >
        {parent ? (
          <button
            className="row-glyph"
            aria-label={`${collapsed ? 'Näytä' : 'Piilota'} sisältö: ${name}`}
            onClick={() => onToggleCollapse(row.key)}
          >
            <Icon name="disclosure" />
          </button>
        ) : (
          <StationGlyph item={item} onOpenDetails={onOpenDetails} />
        )}

        <input
          data-rowkey={row.key}
          className="outline-title"
          value={row.title}
          aria-label={`${KIND_LABEL[row.kind]}: ${row.title || 'nimetön'}`}
          placeholder={`Uusi ${KIND_LABEL[row.kind].toLowerCase()}`}
          onChange={(e) =>
            dispatch({ type: 'rename', kind: row.kind, id: row.id, value: e.target.value })
          }
          onFocus={() => onSelect(row.key)}
          onKeyDown={onKeyDown}
        />

        {/* A collapsed row must still say what it is hiding, or collapsing is
            just losing track of a course. */}
        {parent && collapsed && (
          <span className="row-hidden muted small">
            {row.kind === 'course' && `${plural(row.contents.components, 'osa', 'osaa')} · `}
            {plural(row.contents.steps, 'vaihe', 'vaihetta')}
          </span>
        )}

        <RowMenu
          row={row}
          parent={parent}
          dispatch={dispatch}
          onSelect={onSelect}
          onOpenDetails={onOpenDetails}
        />
      </div>
    </div>
  )
}

/**
 * A step's left slot. It shows the station, because a menu that cannot be
 * scanned for what is competing for the stove is not much of a plan — and `muu`
 * stays the quietest of the four, since the unremarkable default is not news.
 * Quiet, not invisible: the same slot is how a step's details are opened by
 * touch, so it has to be a control you can see.
 */
function StationGlyph({
  item,
  onOpenDetails,
}: {
  item: Extract<OutlineItem, { type: 'row' }>
  onOpenDetails: (key: string) => void
}) {
  const station = item.row.station ?? 'muu'
  const label = stationOf(station).label
  return (
    <button
      className={`row-glyph station-glyph${station === 'muu' ? ' is-quiet' : ''}`}
      aria-label={`Tiedot: ${item.row.title || 'nimetön'}`}
      title={`${label} — avaa tiedot`}
      onClick={() => onOpenDetails(item.key)}
    >
      <Icon name={STATION_ICON[station]} />
    </button>
  )
}

/**
 * Everything you can do to a row that is not typing in it: details, reorder,
 * delete. One menu rather than a strip of icons, so that delete is never the
 * thing next to the thing you meant to click, and so that reordering exists at
 * all without a keyboard.
 */
function RowMenu({
  row,
  parent,
  dispatch,
  onSelect,
  onOpenDetails,
}: {
  row: OutlineRow
  parent: boolean
  dispatch: (action: MenuAction) => void
  onSelect: (key: string) => void
  onOpenDetails: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const name = row.title || 'nimetön'

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const act = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }

  return (
    <div className="row-menu" ref={box}>
      <button
        className="btn btn-ghost icon row-menu-open"
        aria-label={`Toiminnot: ${name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          // Opening the menu is acting on this row, so the row is what the
          // selection and the inspector show — not whatever was selected before.
          if (!open) onSelect(row.key)
          setOpen(!open)
        }}
      >
        <Icon name="overflow" />
      </button>
      {open && (
        <div className="row-menu-list" role="menu" aria-label={`Toiminnot: ${name}`}>
          <button role="menuitem" onClick={act(() => onOpenDetails(row.key))}>
            Tiedot
          </button>
          {parent && (
            <button
              role="menuitem"
              onClick={act(() =>
                dispatch({ type: 'insert_child', kind: row.kind as 'course' | 'component', id: row.id }),
              )}
            >
              {row.kind === 'course' ? 'Lisää osa' : 'Lisää vaihe'}
            </button>
          )}
          <button
            role="menuitem"
            disabled={row.index === 0}
            onClick={act(() => dispatch({ type: 'move', kind: row.kind, id: row.id, delta: -1 }))}
          >
            Siirrä ylös
          </button>
          <button
            role="menuitem"
            disabled={row.index === row.siblingCount - 1}
            onClick={act(() => dispatch({ type: 'move', kind: row.kind, id: row.id, delta: 1 }))}
          >
            Siirrä alas
          </button>
          {/* The visible text is the whole name: which row it acts on is the
              menu's own label, and the counts are the part worth reading. */}
          <button
            role="menuitem"
            className="is-danger"
            onClick={act(() => dispatch({ type: 'delete_row', kind: row.kind, id: row.id }))}
          >
            {deleteLabel(row)}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * "Poista ruokalaji (3 osaa, 22 vaihetta)": the same item on a step and on a
 * course holding a third of the dinner cannot be the same one word. Empty
 * levels are left out, so an empty dish is just "Poista osa".
 */
function deleteLabel(row: OutlineRow): string {
  const what = `Poista ${KIND_LABEL[row.kind].toLowerCase()}`
  const { components, steps } = row.contents
  const taken = [
    ...(components > 0 ? [plural(components, 'osa', 'osaa')] : []),
    ...(steps > 0 ? [plural(steps, 'vaihe', 'vaihetta')] : []),
  ]
  return taken.length > 0 ? `${what} (${taken.join(', ')})` : what
}

/** "+ Osa" / "+ Vaihe" / "+ Ruokalaji": the end of every list, always there. */
function TailRow({
  item,
  dispatch,
}: {
  item: Extract<OutlineItem, { type: 'tail' }>
  dispatch: (action: MenuAction) => void
}) {
  const label = KIND_LABEL[item.childKind]
  const where = item.parentName || 'nimetön'
  return (
    <button
      className={`outline-tail depth-${item.depth} kind-${item.childKind}`}
      aria-label={
        item.parentId === null
          ? 'Lisää ruokalaji'
          : `Lisää ${label.toLowerCase()} kohtaan ${where}`
      }
      onClick={() =>
        item.parentId === null
          ? dispatch({ type: 'add_course' })
          : dispatch({
              type: 'insert_child',
              kind: item.childKind === 'component' ? 'course' : 'component',
              id: item.parentId,
            })
      }
    >
      <span className="row-glyph" aria-hidden>
        <Icon name="add" />
      </span>
      {label}
    </button>
  )
}

/* ---------------------------------------------------------------- inspector */

function Inspector({
  draft,
  row,
  dispatch,
  open,
  onClose,
}: {
  draft: Menu
  row: OutlineRow | null
  dispatch: (action: MenuAction) => void
  open: boolean
  onClose: () => void
}) {
  return (
    <aside className={`inspector${open ? ' is-open' : ''}`} aria-label="Rivin tiedot">
      {row === null ? (
        <p className="muted small">Valitse rivi nähdäksesi sen tiedot.</p>
      ) : (
        <>
          <div className="inspector-head">
            <div>
              <span className="inspector-kind muted small">{KIND_LABEL[row.kind]}</span>
              <h3 className="inspector-title">{row.title || 'nimetön'}</h3>
            </div>
            <button className="btn btn-ghost icon inspector-close" onClick={onClose} aria-label="Sulje tiedot">
              <Icon name="close" />
            </button>
          </div>
          {row.kind === 'step' && <StepFields draft={draft} stepId={row.id} dispatch={dispatch} />}
          {row.kind === 'component' && (
            <ComponentFields draft={draft} componentId={row.id} dispatch={dispatch} />
          )}
          {row.kind === 'course' && (
            <label className="field">
              <span>Huomio</span>
              <input
                value={draft.courses.find((c) => c.id === row.id)?.note ?? ''}
                onChange={(e) =>
                  dispatch({ type: 'set_note', kind: 'course', id: row.id, value: e.target.value })
                }
              />
            </label>
          )}
        </>
      )}
    </aside>
  )
}

function StepFields({
  draft,
  stepId,
  dispatch,
}: {
  draft: Menu
  stepId: string
  dispatch: (action: MenuAction) => void
}) {
  const step = draft.steps.find((s) => s.id === stepId)
  const [adding, setAdding] = useState('')
  const candidates = useMemo(() => dependencyCandidates(draft, stepId), [draft, stepId])
  if (!step) return null
  const component = draft.components.find((c) => c.id === step.componentId)
  const titleOf = (id: string) => draft.steps.find((s) => s.id === id)?.title || id

  return (
    <>
      <label className="field">
        <span>Ohje</span>
        <textarea
          rows={3}
          value={step.detail ?? ''}
          onChange={(e) => dispatch({ type: 'set_detail', id: stepId, value: e.target.value })}
        />
      </label>

      <fieldset className="field">
        <legend>Asema</legend>
        <div className="chips">
          {STATIONS.map((s) => (
            <button
              key={s.id}
              className={`chip station${step.station === s.id ? ' is-active' : ''}`}
              aria-pressed={step.station === s.id}
              aria-label={s.label}
              onClick={() => dispatch({ type: 'set_station', id: stepId, station: s.id })}
            >
              <Icon name={STATION_ICON[s.id]} /> {s.label}
            </button>
          ))}
        </div>
      </fieldset>

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
              {titleOf(dep)} <Icon name="close" />
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
    </>
  )
}

function ComponentFields({
  draft,
  componentId,
  dispatch,
}: {
  draft: Menu
  componentId: string
  dispatch: (action: MenuAction) => void
}) {
  const component = draft.components.find((c) => c.id === componentId)
  const [adding, setAdding] = useState('')
  if (!component) return null

  return (
    <>
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
              {ingredient} <Icon name="close" />
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
    </>
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
