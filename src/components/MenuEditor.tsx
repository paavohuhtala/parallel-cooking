import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AnimatePresence } from 'motion/react'
import { STATIONS, type Menu, type Station } from '../model/types.ts'
import type { MenuWriteResponse } from '../shared/api.ts'
import { errorsOf, toExportDoc, validateMenu, type MenuProblem } from '../shared/menuDoc.ts'
import { MENU_PROMPT } from '../shared/menuPrompt.ts'
import { ApiError } from '../api/client.ts'
import { MenuImportDialog } from './MenuImportDialog.tsx'
import { GutterCell } from './DepGutter.tsx'
import { Icon, STATION_ICON } from './icons.tsx'
import { SHEET_QUERY, useMediaQuery } from './useMediaQuery.ts'
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
import { outlineGutter } from '../state/lanes.ts'
import { cx } from './cx.ts'
import ui from './ui.module.css'
import styles from './MenuEditor.module.css'

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

/** Indent and weight are per level, so both are looked up rather than built. */
const DEPTH_CLASS = [undefined, styles.depth1, styles.depth2] as const
const KIND_CLASS: Record<'course' | 'component' | 'step', string | undefined> = {
  course: styles.kindCourse,
  component: styles.kindComponent,
  step: undefined,
}

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
  const saveState: 'saved' | 'dirty' | 'blocked' | 'saving' = busy
    ? 'saving'
    : !dirty
      ? 'saved'
      : blocking.length > 0
        ? 'blocked'
        : 'dirty'
  const problemsId = useId()

  /** Rows currently on screen — what ↑/↓ walks, so collapsed rows are skipped. */
  const visible = useMemo(
    () => items.flatMap((item) => (item.type === 'row' ? [item.row] : [])),
    [items],
  )
  const selectedRow = useMemo(
    () => visible.find((r) => r.key === selected) ?? null,
    [visible, selected],
  )
  const gutter = useMemo(() => outlineGutter(draft, items), [draft, items])
  /**
   * The lanes of the step being edited, which the rest step back from. Only
   * when it has any: a step on the plain chain dims nothing, or the gutter
   * would go grey whenever you typed a title.
   */
  const emphasis = useMemo(() => {
    const at = items.findIndex((item) => item.key === selected)
    if (at === -1 || gutter.rows[at].node === null) return null
    const touching = new Set(
      gutter.lanes.flatMap((lane, i) => (lane.source === at || lane.targets.includes(at) ? [i] : [])),
    )
    return touching.size > 0 ? touching : null
  }, [items, gutter, selected])
  /**
   * The inspector is a modal sheet only where it covers the outline. Beside it,
   * it is a column, and correctly not a dialog: nothing is blocked, and it has
   * nothing to close.
   */
  const narrow = useMediaQuery(SHEET_QUERY)
  const sheet = narrow && sheetOpen && selectedRow !== null
  /** Where focus goes back to when the sheet closes. */
  const opener = useRef<HTMLElement | null>(null)
  const restoreFocus = useRef(false)

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
    // A button or nothing: Safari does not focus a button on click, so what is
    // focused may be some row's title, and giving focus back to that would
    // open the keyboard.
    opener.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
    setSelected(key)
    setSheetOpen(true)
  }, [])

  const closeSheet = useCallback(() => {
    restoreFocus.current = true
    setSheetOpen(false)
  }, [])

  // A row deleted or undone out from under an open sheet takes the sheet with
  // it; left open, it would pop back up at the next row you tapped into.
  useEffect(() => {
    if (sheetOpen && selectedRow === null) setSheetOpen(false)
  }, [sheetOpen, selectedRow])

  useEffect(() => {
    if (!sheet) return
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [sheet, closeSheet])

  /*
   * Back to whatever opened the sheet — the station glyph, usually. Not on
   * close but after it: until the render that lifts `inert` off the outline,
   * nothing there can take focus. And never to the row's title, which on a
   * phone would open the keyboard over the outline that was just uncovered. A
   * sheet opened from the row menu has lost its opener with the menu, so the
   * row's `⋯` stands in for it, as it does when there was no button to note.
   */
  useEffect(() => {
    if (sheet || !restoreFocus.current) return
    restoreFocus.current = false
    const back = opener.current?.isConnected
      ? opener.current
      : selected
        ? document
            .querySelector(`[data-rowkey="${CSS.escape(selected)}"]`)
            ?.closest('.outline-row')
            ?.querySelector<HTMLElement>('.row-menu-open')
        : null
    back?.focus()
  }, [sheet, selected])

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

  /*
   * The header sticks, so save and undo are there at step 40 too: all of it
   * beside the outline, only its row of actions on a phone, where the menu's
   * name is not worth a line of the screen (CSS). Two things have to clear
   * that band — the inspector column, which sticks too, and a row focused
   * from above, which the browser would otherwise count as on screen while it
   * sits underneath it — so its height is measured rather than assumed: it
   * wraps at some widths and not others.
   *
   * It is set on the scroll container, the page or the kitchen's overlay,
   * because that is where `scroll-padding` has to go for focus to scroll a row
   * clear of the band; the editor inherits it from there.
   */
  const root = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLElement>(null)
  const actions = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const band = narrow ? actions.current : head.current
    const scroller = root.current && scrollerOf(root.current)
    if (!band || !scroller) return
    const observer = new ResizeObserver(() =>
      scroller.style.setProperty('--editor-sticky-h', `${band.offsetHeight}px`),
    )
    observer.observe(band)
    return () => {
      observer.disconnect()
      scroller.style.removeProperty('--editor-sticky-h')
    }
  }, [narrow])

  // The reducer names the row that should hold the cursor; the view just obeys.
  useLayoutEffect(() => {
    if (!focus) return
    const el = document.querySelector<HTMLTextAreaElement>(`[data-rowkey="${CSS.escape(focus)}"]`)
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

  // Everything but the sheet, while it is a sheet: `inert` takes the rest of
  // the editor away from a keyboard and a screen reader — which does not
  // reliably honour `aria-modal` on its own — as the backdrop does from a finger.
  const behindSheet = sheet || undefined

  return (
    <div className={styles.editor} data-testid="menu-editor" ref={root}>
      <header className={styles.head} data-testid="editor-head" ref={head} inert={behindSheet}>
        <input
          className={styles.title}
          data-testid="editor-title"
          value={draft.name}
          aria-label="Menun nimi"
          placeholder="Menun nimi"
          onChange={(e) => dispatch({ type: 'rename_menu', value: e.target.value })}
        />
        <div className={styles.actions} data-testid="editor-actions" ref={actions}>
          {/* Undo has to be reachable without a keyboard too: the row menu's
              Poista is a thumb's only way to delete, so it needs a thumb's way
              back. */}
          <div className={styles.history}>
            <button
              className={cx(ui.btn, ui.btnGhost, ui.icon, styles.headIcon)}
              onClick={undo}
              disabled={!canUndo(history)}
              aria-label="Kumoa"
              title="Kumoa (Ctrl+Z)"
            >
              <Icon name="undo" />
            </button>
            <button
              className={cx(ui.btn, ui.btnGhost, ui.icon, styles.headIcon)}
              onClick={redo}
              disabled={!canRedo(history)}
              aria-label="Tee uudelleen"
              title="Tee uudelleen (Vaihto+Ctrl+Z)"
            >
              <Icon name="redo" />
            </button>
          </div>
          {/* One recipe at a time is how a model converts them, so assembling a
              multi-course dinner means merging several documents into this one.
              Buttons where there is room for them, a menu where there is not. */}
          <div className={styles.extra}>
            <button className={cx(ui.btn, ui.btnGhost)} onClick={() => setMerging(true)}>
              Tuo ja yhdistä
            </button>
            <button className={cx(ui.btn, ui.btnGhost)} onClick={() => void copyPrompt()}>
              Kopioi LLM-kehote
            </button>
            <button className={cx(ui.btn, ui.btnGhost)} onClick={exportJson}>
              Vie JSON
            </button>
          </div>
          <MoreMenu
            onMerge={() => setMerging(true)}
            onCopyPrompt={() => void copyPrompt()}
            onExport={exportJson}
          />
          {/* The button is the draft's status as well as its action, and every
              label it can wear is rendered, stacked in one grid cell with only
              the current one visible. So it is always as wide as its widest
              label, and nothing in the header moves when the first keystroke
              makes the draft dirty — least of all the name field being typed
              in. `visibility` also keeps the hidden labels out of the name. */}
          <button
            className={cx(ui.btn, styles.save)}
            data-testid="editor-save"
            data-state={saveState}
            onClick={() => void onSave()}
            disabled={saveState !== 'dirty'}
            aria-busy={busy}
            aria-describedby={saveState === 'blocked' ? problemsId : undefined}
            title={saveState === 'blocked' ? 'Korjaa virheet ennen tallentamista' : undefined}
          >
            <span className={saveState === 'saved' ? styles.isShown : undefined}>
              <Icon name="check" /> Tallennettu
            </span>
            <span
              className={
                saveState === 'dirty' || saveState === 'blocked' ? styles.isShown : undefined
              }
            >
              Tallenna
            </span>
            <span className={saveState === 'saving' ? styles.isShown : undefined}>
              Tallennetaan…
            </span>
          </button>
          {onClose && (
            <button
              className={cx(ui.btn, ui.btnGhost, ui.icon, styles.headIcon)}
              onClick={onClose}
              aria-label="Sulje"
            >
              <Icon name="close" />
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className={cx(ui.banner, ui.bannerError, styles.banner)} role="alert" inert={behindSheet}>
          {error}
        </div>
      )}
      {note && !error && (
        <div className={cx(ui.banner, ui.bannerOk, styles.banner)} inert={behindSheet}>
          {note}
        </div>
      )}

      <ProblemList
        id={problemsId}
        problems={problems}
        onGo={(key) => reveal(draft, key)}
        inert={behindSheet}
      />

      <div className={styles.body}>
        <div className={styles.outline} role="tree" aria-label="Menun rakenne" inert={behindSheet}>
          {/* Every item carries its slice of the dependency gutter, headings
              and tails included, so a line runs unbroken past them. */}
          {items.map((item, i) => (
            <div key={item.key} className={styles.line} role="none" data-testid="outline-line">
              <GutterCell row={gutter.rows[i]} columns={gutter.columns} emphasis={emphasis} />
              {item.type === 'row' ? (
                <Row
                  item={item}
                  dispatch={dispatch}
                  selected={selected === item.key}
                  onSelect={setSelected}
                  onOpenDetails={openDetails}
                  onToggleCollapse={toggleCollapse}
                  onMoveFocus={moveFocus}
                />
              ) : (
                <TailRow item={item} dispatch={dispatch} />
              )}
            </div>
          ))}
        </div>

        {/* The kitchen's own sheet backdrop, with the same rule: a tap that
            misses the sheet closes it, instead of landing on a row behind it
            and changing what the sheet is editing. */}
        {sheet && (
          <div className={ui.detailBackdrop} data-testid="detail-backdrop" onClick={closeSheet} />
        )}
        <Inspector
          draft={draft}
          row={selectedRow}
          dispatch={dispatch}
          open={sheetOpen}
          modal={sheet}
          onClose={closeSheet}
        />
      </div>

      <AnimatePresence>
        {merging && (
          <MenuImportDialog
            key="merge"
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
      </AnimatePresence>

      <p className={cx(styles.hint, ui.muted, ui.small)} inert={behindSheet}>
        Enter lisää rivin · Vaihto+Enter lisää sisällön · ↑/↓ siirtyy rivien välillä ·
        Alt+↑/↓ siirtää riviä · Askelpalautin tyhjällä rivillä poistaa sen, jos sillä ei ole
        sisältöä · Ctrl+Z kumoaa · rivin valikko tekee saman hiirellä
      </p>
    </div>
  )
}

function ProblemList({
  id,
  problems,
  onGo,
  inert,
}: {
  /** What a blocked save button points at to say why it is blocked. */
  id: string
  problems: MenuProblem[]
  onGo: (key: string) => void
  inert?: boolean
}) {
  if (problems.length === 0) return null
  const errors = problems.filter((p) => p.severity === 'error')
  return (
    <div
      id={id}
      className={cx(
        ui.banner,
        errors.length ? ui.bannerError : ui.bannerWarn,
        styles.banner,
        styles.problems,
      )}
      data-testid="editor-problems"
      inert={inert}
    >
      <ul className={cx(ui.plainList, styles.problemList)}>
        {problems.slice(0, 6).map((problem, i) => (
          <li key={`${problem.code}-${i}`}>
            {problem.target ? (
              <button
                className={ui.linky}
                onClick={() => onGo(rowKey(problem.target!.kind, problem.target!.id))}
              >
                {problem.message}
              </button>
            ) : (
              problem.message
            )}
          </li>
        ))}
        {problems.length > 6 && <li className={ui.muted}>… ja {problems.length - 6} muuta</li>}
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
  /** Held here rather than in the menu, so the row can show whose menu is open. */
  const [menuOpen, setMenuOpen] = useState(false)

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter') {
      // Always ours: the field is a textarea only so that it can wrap, and a
      // title is one line however it is displayed.
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
    // Rows, not lines, even in a title that has wrapped: the wrap is the
    // screen's, not the text's, and ↑/↓ should not mean something different on
    // a narrow window.
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
      className={cx(
        styles.row,
        DEPTH_CLASS[row.depth],
        KIND_CLASS[row.kind],
        selected && styles.isSelected,
        menuOpen && styles.isMenuOpen,
      )}
      data-testid="outline-row"
      data-menu-open={menuOpen || undefined}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      {...(parent ? { 'aria-expanded': !collapsed } : {})}
    >
      <div
        className={styles.rowMain}
        // The title is only as wide as its text, so the rest of the row is
        // blank; a press there still means "this row" and lands in the title.
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          const input = e.currentTarget.querySelector<HTMLTextAreaElement>('textarea')
          input?.focus()
          input?.setSelectionRange(input.value.length, input.value.length)
        }}
      >
        {parent ? (
          <button
            className={styles.glyph}
            data-testid="row-glyph"
            aria-label={`${collapsed ? 'Näytä' : 'Piilota'} sisältö: ${name}`}
            onClick={() => onToggleCollapse(row.key)}
          >
            <Icon name="disclosure" className={styles.glyphIcon} />
          </button>
        ) : (
          <StationGlyph item={item} onOpenDetails={onOpenDetails} />
        )}

        {/* A textarea only so that a long title can wrap: an `<input>` cannot,
            and on a phone it cut a quarter of the titles off mid-letter with
            nothing to say so. It is still one line of text — Enter is taken
            above, and a pasted line break becomes a space. */}
        <textarea
          data-rowkey={row.key}
          className={styles.rowTitle}
          data-testid="outline-title"
          rows={1}
          value={row.title}
          aria-label={`${KIND_LABEL[row.kind]}: ${row.title || 'nimetön'}`}
          placeholder={`Uusi ${KIND_LABEL[row.kind].toLowerCase()}`}
          onChange={(e) =>
            dispatch({
              type: 'rename',
              kind: row.kind,
              id: row.id,
              value: e.target.value.replace(/[\r\n]+/g, ' '),
            })
          }
          onFocus={() => onSelect(row.key)}
          onKeyDown={onKeyDown}
        />

        {/* A collapsed row must still say what it is hiding, or collapsing is
            just losing track of a course. */}
        {parent && collapsed && (
          <span className={cx(styles.rowHidden, ui.muted, ui.small)}>
            {row.kind === 'course' && `${plural(row.contents.components, 'osa', 'osaa')} · `}
            {plural(row.contents.steps, 'vaihe', 'vaihetta')}
          </span>
        )}

        <RowMenu
          row={row}
          parent={parent}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          dispatch={dispatch}
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
      className={cx(styles.glyph, styles.stationGlyph, station === 'muu' && styles.isQuiet)}
      data-testid="row-glyph"
      aria-label={`Tiedot: ${item.row.title || 'nimetön'}`}
      title={`${label} — avaa tiedot`}
      onClick={() => onOpenDetails(item.key)}
    >
      <Icon name={STATION_ICON[station]} />
    </button>
  )
}

/**
 * What a popup menu needs besides its items: closing on a press outside it or
 * on Escape, and opening towards whichever side of its button has the room.
 */
function usePopupMenu(open: boolean, setOpen: (open: boolean) => void) {
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  /**
   * The menu opens rightwards — over the blank row the title no longer fills,
   * in a row's case — and flips to end at its button only where that would
   * leave the screen. Measured from the button rather than the list, so a stale
   * flip cannot measure itself as fine.
   */
  const [alignEnd, setAlignEnd] = useState(false)

  useLayoutEffect(() => {
    if (!open || !box.current || !list.current) return
    const start = box.current.getBoundingClientRect().left
    setAlignEnd(start + list.current.offsetWidth > document.documentElement.clientWidth - 8)
  }, [open])

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
  }, [open, setOpen])

  const act = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }

  return { box, list, alignEnd, act }
}

/**
 * The header's once-a-menu actions behind one `⋯`, where the header is too
 * narrow to give them a row of their own (CSS decides). Tuo ja yhdistä, Kopioi
 * LLM-kehote and Vie JSON took a whole line above the two controls that matter
 * on every visit, undo and save.
 */
function MoreMenu({
  onMerge,
  onCopyPrompt,
  onExport,
}: {
  onMerge: () => void
  onCopyPrompt: () => void
  onExport: () => void
}) {
  const [open, setOpen] = useState(false)
  const { box, list, alignEnd, act } = usePopupMenu(open, setOpen)
  return (
    <div className={styles.more} ref={box}>
      <button
        className={cx(ui.btn, ui.btnGhost, ui.icon, styles.headIcon)}
        aria-label="Lisää toimintoja"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <Icon name="overflow" />
      </button>
      {open && (
        <div
          ref={list}
          className={cx(styles.popup, alignEnd && styles.isEnd)}
          role="menu"
          aria-label="Lisää toimintoja"
        >
          <button role="menuitem" onClick={act(onMerge)}>
            Tuo ja yhdistä
          </button>
          <button role="menuitem" onClick={act(onCopyPrompt)}>
            Kopioi LLM-kehote
          </button>
          <button role="menuitem" onClick={act(onExport)}>
            Vie JSON
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Everything you can do to a row that is not typing in it: reorder, delete, and
 * on a phone open its details. One menu rather than a strip of icons, so that
 * delete is never the thing next to the thing you meant to click, and so that
 * reordering exists at all without a keyboard.
 */
function RowMenu({
  row,
  parent,
  open,
  onOpenChange: setOpen,
  dispatch,
  onOpenDetails,
}: {
  row: OutlineRow
  parent: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  dispatch: (action: MenuAction) => void
  onOpenDetails: (key: string) => void
}) {
  const { box, list, alignEnd, act } = usePopupMenu(open, setOpen)
  const name = row.title || 'nimetön'

  return (
    <div className={styles.rowMenu} ref={box}>
      <button
        className={cx(ui.btn, ui.btnGhost, ui.icon, styles.rowMenuOpen)}
        data-testid="row-menu-open"
        aria-label={`Toiminnot: ${name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        // Opening the menu does not select the row: looking at what you could
        // do to a row is not choosing to edit it, and the inspector should not
        // change under you for a peek. The row is marked instead.
        onClick={() => setOpen(!open)}
      >
        <Icon name="overflow" />
      </button>
      {open && (
        <div
          ref={list}
          className={cx(styles.popup, alignEnd && styles.isEnd)}
          role="menu"
          aria-label={`Toiminnot: ${name}`}
        >
          {/* Phone only (CSS): beside the outline the inspector already shows
              whatever row you are in, but as a sheet it has to be opened, and a
              course or a dish has no station glyph to open it with. */}
          <button
            role="menuitem"
            className={styles.rowMenuDetails}
            onClick={act(() => onOpenDetails(row.key))}
          >
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
            className={styles.isDanger}
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
      className={cx(styles.tail, DEPTH_CLASS[item.depth], KIND_CLASS[item.childKind])}
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
      <span className={styles.glyph} aria-hidden>
        <Icon name="add" />
      </span>
      {label}
    </button>
  )
}

/* ---------------------------------------------------------------- inspector */

/** How far the sheet's head has to be pulled down to let go of it. */
const DISMISS_DRAG_PX = 80

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

function Inspector({
  draft,
  row,
  dispatch,
  open,
  modal,
  onClose,
}: {
  draft: Menu
  row: OutlineRow | null
  dispatch: (action: MenuAction) => void
  open: boolean
  /** A sheet over the outline, rather than a column beside it. */
  modal: boolean
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; from: number } | null>(null)

  // Into the sheet, so the keyboard is where the eye is — the panel itself,
  // not its first field, which on a phone would put the keyboard up unasked.
  useEffect(() => {
    if (modal) panel.current?.focus()
  }, [modal])

  /*
   * The head pulls down to dismiss, which is what a sheet's handle promises.
   * The panel follows the finger by style rather than by state, so a drag does
   * not re-render every field under it; letting go short of the threshold puts
   * it back.
   */
  const follow = (dy: number) => {
    if (panel.current) panel.current.style.transform = dy > 0 ? `translateY(${dy}px)` : ''
  }
  const grab = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!modal || (e.target as Element).closest('button')) return
      drag.current = { pointer: e.pointerId, from: e.clientY }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (drag.current?.pointer === e.pointerId) follow(e.clientY - drag.current.from)
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      if (drag.current?.pointer !== e.pointerId) return
      const pulled = e.clientY - drag.current.from
      drag.current = null
      follow(0)
      if (pulled > DISMISS_DRAG_PX) onClose()
    },
    onPointerCancel: () => {
      drag.current = null
      follow(0)
    },
  }

  /*
   * Tab wraps inside the sheet. `inert` already takes the rest of the editor
   * out of reach, but not the page around it — the library's nav, the kitchen
   * under the overlay — and a modal the keyboard can walk out of is not one.
   */
  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const stops = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) =>
      el.checkVisibility(),
    )
    const first = stops[0]
    const last = stops.at(-1)
    if (!first || !last) return
    const at = document.activeElement
    if (e.shiftKey && (at === first || at === e.currentTarget)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && at === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      ref={panel}
      className={cx(styles.inspector, open && styles.isOpen)}
      data-testid="inspector"
      role={modal ? 'dialog' : 'complementary'}
      aria-modal={modal || undefined}
      aria-label="Rivin tiedot"
      tabIndex={modal ? -1 : undefined}
      onKeyDown={modal ? trapTab : undefined}
    >
      {row === null ? (
        <p className={cx(ui.muted, ui.small)}>Valitse rivi nähdäksesi sen tiedot.</p>
      ) : (
        <>
          <div className={styles.inspectorGrab} data-testid="inspector-grab" {...grab}>
            <div className={styles.sheetHandle} aria-hidden />
            <div className={styles.inspectorHead}>
              <div>
                <span className={cx(styles.inspectorKind, ui.muted, ui.small)}>
                  {KIND_LABEL[row.kind]}
                </span>
                <h3 className={styles.inspectorTitle} data-testid="inspector-title">
                  {row.title || 'nimetön'}
                </h3>
              </div>
              <button
                className={cx(ui.btn, ui.btnGhost, ui.icon, styles.inspectorClose)}
                onClick={onClose}
                aria-label="Sulje tiedot"
              >
                <Icon name="close" />
              </button>
            </div>
          </div>
          {row.kind === 'step' && <StepFields draft={draft} stepId={row.id} dispatch={dispatch} />}
          {row.kind === 'component' && (
            <ComponentFields draft={draft} componentId={row.id} dispatch={dispatch} />
          )}
          {row.kind === 'course' && (
            <label className={cx(ui.field, styles.field)}>
              <span data-testid="field-label">Huomio</span>
              <input
                className={ui.textInput}
                value={draft.courses.find((c) => c.id === row.id)?.note ?? ''}
                onChange={(e) =>
                  dispatch({ type: 'set_note', kind: 'course', id: row.id, value: e.target.value })
                }
              />
            </label>
          )}
        </>
      )}
    </div>
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
      <label className={cx(ui.field, styles.field)}>
        <span data-testid="field-label">Ohje</span>
        <textarea
          rows={3}
          value={step.detail ?? ''}
          onChange={(e) => dispatch({ type: 'set_detail', id: stepId, value: e.target.value })}
        />
      </label>

      <fieldset className={cx(ui.field, styles.field)}>
        <legend>Asema</legend>
        <div className={styles.chips} data-testid="chips">
          {STATIONS.map((s) => (
            <button
              key={s.id}
              className={cx(ui.chip, styles.inspectorChip, step.station === s.id && ui.isActive)}
              aria-pressed={step.station === s.id}
              aria-label={s.label}
              onClick={() => dispatch({ type: 'set_station', id: stepId, station: s.id })}
            >
              <Icon name={STATION_ICON[s.id]} /> {s.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={cx(ui.field, styles.field)}>
        <legend>Edellyttää</legend>
        <div className={styles.chips} data-testid="chips">
          {step.deps.map((dep) => (
            <button
              key={dep}
              className={cx(ui.chip, ui.isActive, styles.inspectorChip)}
              onClick={() => dispatch({ type: 'toggle_dep', id: stepId, depId: dep })}
              aria-label={`Poista riippuvuus ${titleOf(dep)}`}
            >
              {titleOf(dep)} <Icon name="close" />
            </button>
          ))}
          {/* Only steps that cannot close a cycle are offered at all. */}
          <select
            className={styles.depPicker}
            data-testid="dep-picker"
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
        <fieldset className={cx(ui.field, styles.field)}>
          <legend>Tarvitaan</legend>
          <div className={styles.chips} data-testid="chips">
            {component.ingredients.map((ingredient) => (
              <button
                key={ingredient}
                className={cx(
                  ui.chip,
                  styles.inspectorChip,
                  step.uses?.includes(ingredient) && ui.isActive,
                )}
                aria-pressed={step.uses?.includes(ingredient) ?? false}
                onClick={() => dispatch({ type: 'toggle_use', id: stepId, ingredient })}
              >
                {ingredient}
              </button>
            ))}
            <input
              className={styles.ingredientAdd}
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

      <label className={ui.toggle}>
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
      <label className={cx(ui.field, styles.field)}>
        <span data-testid="field-label">Huomio</span>
        <input
          className={ui.textInput}
          value={component.note ?? ''}
          onChange={(e) =>
            dispatch({ type: 'set_note', kind: 'component', id: component.id, value: e.target.value })
          }
        />
      </label>
      <fieldset className={cx(ui.field, styles.field)}>
        <legend>Ainekset</legend>
        <div className={styles.chips} data-testid="chips">
          {component.ingredients.map((ingredient, i) => (
            // By position, not by name: a rename changes the name, and a key
            // that changed with it would remount the field Enter just left the
            // caret in.
            <IngredientChip
              key={i}
              componentId={component.id}
              ingredient={ingredient}
              dispatch={dispatch}
            />
          ))}
          <input
            className={styles.ingredientAdd}
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

/**
 * One of a dish's ingredients: the name is a field, the × beside it removes it.
 *
 * Unlike every other field in the editor, the rename is sent when the edit is
 * finished — on Enter or on leaving the field — rather than per keystroke. An
 * ingredient *is* its name, so renaming as you type would walk every step that
 * uses it through each intermediate spelling: emptying the field to retype it
 * would have nowhere to go, and backspacing "voita" past "voi" would merge it
 * into a "voi" already on the list before the rest was typed.
 *
 * Escape puts back a name being edited, and only that: the sheet's own Escape
 * waits for the next press, so the first one never throws the edit away along
 * with the sheet.
 */
function IngredientChip({
  componentId,
  ingredient,
  dispatch,
}: {
  componentId: string
  ingredient: string
  dispatch: (action: MenuAction) => void
}) {
  const [value, setValue] = useState(ingredient)
  // Follow the name when it changes underneath the field — an undo, or the
  // list closing up after a removal, since chips are keyed by position.
  const [shown, setShown] = useState(ingredient)
  if (shown !== ingredient) {
    setShown(ingredient)
    setValue(ingredient)
  }

  const commit = () => {
    // An empty name is not a request to delete — the × is right there — so it
    // simply goes back to what it was. A real rename resets the field anyway,
    // through `shown`, once the new name comes back down.
    setValue(value.trim() || ingredient)
    dispatch({ type: 'rename_ingredient', componentId, from: ingredient, to: value })
  }

  return (
    <span className={cx(ui.chip, styles.inspectorChip, styles.ingredient)}>
      {/* A textarea for the reason the outline's titles are one: a long name
          has to wrap in the narrow column rather than be cut through a letter,
          and the chip it replaced did wrap. Still one line of text. */}
      <textarea
        className={styles.ingredientName}
        rows={1}
        // The fallback width where `field-sizing` is missing.
        cols={Math.max(value.length, 1)}
        aria-label={`Aines: ${ingredient}`}
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[\r\n]+/g, ' '))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape' && value !== ingredient) {
            e.stopPropagation()
            setValue(ingredient)
          }
        }}
      />
      <button
        className={styles.ingredientRemove}
        aria-label={`Poista aines ${ingredient}`}
        onClick={() => dispatch({ type: 'remove_ingredient', componentId, value: ingredient })}
      >
        <Icon name="close" />
      </button>
    </span>
  )
}

/** The nearest ancestor that scrolls vertically, or the page. */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let at = el.parentElement; at; at = at.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at
  }
  return document.documentElement
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
