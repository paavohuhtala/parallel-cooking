import { useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import type { Menu } from './model/types'
import { saveRoomMenu } from './api/client'
import { MenuEditor } from './components/MenuEditor'
import { Modal, ModalHead } from './components/Modal.tsx'
import { Collapse, useRejectionNudge } from './components/motion.tsx'
import { Icon, type IconName } from './components/icons.tsx'
import { badgeColors } from './components/ink.ts'
import { StartDialog } from './components/StepControls'
import { StepDetail } from './components/StepDetail'
import { progressOf, recordOf, suggestedNext } from './state/graph'
import { useStore } from './state/store'
import { GraphView } from './views/GraphView'
import { KanbanView } from './views/KanbanView'
import { RecipeView } from './views/RecipeView'
import { ShiftView } from './views/ShiftView'
import { cx } from './components/cx.ts'
import ui from './components/ui.module.css'
import styles from './App.module.css'

type View = 'recipe' | 'graph' | 'board' | 'shift'

const CONNECTION_LABEL: Record<'connecting' | 'online' | 'offline', string> = {
  connecting: 'Yhdistetään…',
  online: 'Verkossa',
  offline: 'Ei yhteyttä',
}

const CONNECTION_CLASS: Record<'connecting' | 'online' | 'offline', string> = {
  connecting: styles.connConnecting,
  online: styles.connOnline,
  offline: styles.connOffline,
}

const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: 'recipe', label: 'Resepti', icon: 'recipe' },
  { id: 'graph', label: 'Graafi', icon: 'graph' },
  { id: 'board', label: 'Keittiötaulu', icon: 'board' },
  { id: 'shift', label: 'Oma vuoro', icon: 'shift' },
]

/**
 * A phone opens on `Oma vuoro`; anything wider opens on the recipe. Read once,
 * at mount, and never again: narrowing a desktop window must not yank the view
 * out from under somebody mid-task.
 */
const initialView = (): View =>
  typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches
    ? 'shift'
    : 'recipe'

export default function App() {
  const store = useStore()
  const { room, menu, index, state, rejection, dismissRejection, connection } = store
  const [view, setView] = useState<View>(initialView)
  const [selected, setSelected] = useState<string | null>(null)
  const [cooksOpen, setCooksOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (insecure origin, denied permission): the URL bar
      // still has the link, so this is a convenience, not a requirement.
    }
  }

  const progress = useMemo(() => progressOf(menu, index, state), [menu, index, state])
  const upNext = useMemo(() => suggestedNext(menu, index, state), [menu, index, state])

  const select = (id: string) => setSelected((current) => (current === id ? null : id))
  const nudgeScope = useRejectionNudge<HTMLDivElement>(rejection)

  return (
    <div
      ref={nudgeScope}
      className={cx(styles.app, view === 'shift' && styles.viewShift, selected && styles.hasDetail)}
    >
      <header className={styles.topbar} data-testid="topbar">
        <div className={styles.brand}>
          <h1>{room.name}</h1>
          <p className={cx(ui.muted, ui.small)} data-testid="room-progress">
            {progress.done}/{progress.total} vaihetta valmiina · pisin jäljellä oleva ketju{' '}
            {progress.criticalChainLeft} vaihetta
          </p>
        </div>

        <nav className={styles.tabs} role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              className={cx(styles.tab, view === v.id && styles.isActive)}
              onClick={() => setView(v.id)}
            >
              <Icon name={v.icon} className={styles.tabIcon} /> {v.label}
            </button>
          ))}
        </nav>

        <div className={styles.topbarActions} data-testid="topbar-actions">
          <RoomActions
            copied={copied}
            cooks={state.cooks.length}
            onCooks={() => setCooksOpen((o) => !o)}
            onCopy={() => void copyLink()}
            onEdit={() => setEditing(true)}
          />
        </div>

        {/* Where the three buttons above do not fit, they move in here. */}
        <button
          className={cx(ui.btn, ui.btnGhost, ui.icon, styles.topbarMore)}
          onClick={() => setActionsOpen(true)}
          aria-label="Toiminnot"
        >
          <Icon name="overflow" />
        </button>

        <span
          className={cx(styles.conn, CONNECTION_CLASS[connection])}
          data-testid="connection"
          title={CONNECTION_LABEL[connection]}
        >
          {CONNECTION_LABEL[connection]}
        </span>

        <div className={styles.progressbar} aria-hidden>
          <span className={cx(styles.seg, styles.done)} style={{ flexGrow: progress.done }} />
          <span className={cx(styles.seg, styles.active)} style={{ flexGrow: progress.active }} />
          <span className={cx(styles.seg, styles.ready)} style={{ flexGrow: progress.ready }} />
          <span className={cx(styles.seg, styles.blocked)} style={{ flexGrow: progress.blocked }} />
        </div>
      </header>

      {index.problems.length > 0 && (
        <div className={cx(ui.banner, ui.bannerError)}>
          <strong>Reseptidatassa on virhe:</strong> {index.problems.join(' ')}
        </div>
      )}

      {/*
        Opens and closes rather than popping, so the workspace below slides
        instead of jumping — and so the eight-second timeout taking it away is
        something you see happen. One key for every rejection: a second one
        while the first is showing changes the words, not the banner.
      */}
      <AnimatePresence initial={false}>
        {rejection && (
          <Collapse key="rejection" className={styles.bannerSlot}>
            <div className={cx(ui.banner, ui.bannerWarn)} role="alert" data-testid="rejection">
              {rejection.stepId && (
                <strong>{index.steps.get(rejection.stepId)?.title}: </strong>
              )}
              {rejection.reason}
              <button
                className={cx(ui.btn, ui.btnGhost, ui.icon)}
                onClick={dismissRejection}
                aria-label="Sulje"
              >
                <Icon name="close" />
              </button>
            </div>
          </Collapse>
        )}
      </AnimatePresence>

      {upNext.length > 0 && (
        <div className={styles.upnext} data-testid="upnext">
          <span className={styles.upnextLabel}>Seuraavaksi</span>
          <div className={styles.upnextItems}>
            {upNext.slice(0, 6).map((step) => (
              <button
                key={step.id}
                className={ui.chip}
                data-testid="upnext-chip"
                onClick={() => select(step.id)}
              >
                {step.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/*
        The workspace is the only thing that scrolls: the chrome above stays
        put, and the board can run as wide as it likes without the header
        sliding out from under it.
      */}
      <div className={styles.workspace}>
        {/* `layoutScroll`: the board and the shift view animate layout inside
            this, and without it Motion measures a scrolled card as having moved
            by however far the page is scrolled. */}
        <m.div className={styles.scroller} layoutScroll>
          <main className={styles.content}>
            {view === 'recipe' && <RecipeView selected={selected} onSelect={select} />}
            {view === 'graph' && <GraphView selected={selected} onSelect={select} />}
            {view === 'board' && <KanbanView selected={selected} onSelect={select} />}
            {view === 'shift' && <ShiftView selected={selected} onSelect={select} />}
          </main>
        </m.div>

        {selected && (
          <>
            {/* Only visible where the panel collapses into a modal sheet. */}
            <div
              className={ui.detailBackdrop}
              data-testid="detail-backdrop"
              onClick={() => setSelected(null)}
            />
            <StepDetail
              stepId={selected}
              onClose={() => setSelected(null)}
              onSelect={(id) => setSelected(id)}
            />
          </>
        )}
      </div>

      <StartDialog />
      <AnimatePresence>
        {actionsOpen && (
          <ActionsSheet key="actions" onClose={() => setActionsOpen(false)}>
            <RoomActions
              copied={copied}
              cooks={state.cooks.length}
              onCooks={() => {
                setActionsOpen(false)
                setCooksOpen(true)
              }}
              onCopy={() => void copyLink()}
              onEdit={() => {
                setActionsOpen(false)
                setEditing(true)
              }}
            />
          </ActionsSheet>
        )}
        {cooksOpen && <CooksModal key="cooks" onClose={() => setCooksOpen(false)} />}
      </AnimatePresence>
      {editing && <MenuEditorOverlay onClose={() => setEditing(false)} />}
    </div>
  )
}

/**
 * The room's three actions. Rendered twice — inline in the header, and again in
 * the sheet a phone reaches them through — so there is one definition of what
 * they are and one place to change them. The sheet lives outside `.topbar`, so
 * a locator scoped to the header still finds exactly one of each.
 *
 * Deleting a kitchen is deliberately *not* here: it belongs to the list of
 * kitchens on the front page, where you can see which ones are empty, and not
 * to a room you are standing in.
 */
function RoomActions({
  copied,
  cooks,
  onCooks,
  onCopy,
  onEdit,
}: {
  copied: boolean
  cooks: number
  onCooks: () => void
  onCopy: () => void
  onEdit: () => void
}) {
  return (
    <>
      <button className={cx(ui.btn, ui.btnGhost)} onClick={onCooks}>
        <Icon name="cooks" /> Kokit ({cooks})
      </button>
      <button className={cx(ui.btn, ui.btnGhost)} onClick={onCopy}>
        {copied ? (
          <>
            <Icon name="check" /> Kopioitu
          </>
        ) : (
          <>
            <Icon name="share" /> Jaa
          </>
        )}
      </button>
      <button className={cx(ui.btn, ui.btnGhost)} onClick={onEdit}>
        <Icon name="edit" /> Muokkaa menua
      </button>
    </>
  )
}

function ActionsSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <Modal label="Toiminnot" variant="sheet" onClose={onClose}>
      <ModalHead title="Toiminnot" onClose={onClose} />
      <div className={styles.sheetActions}>{children}</div>
    </Modal>
  )
}

/**
 * Editing the menu of a kitchen that is already running.
 *
 * An overlay rather than a route: `RoomRoute` renders `<App/>` and not an
 * `<Outlet/>`, and staying mounted keeps the socket open — so the moment the
 * menu is saved, the views underneath update from the broadcast for free.
 */
function MenuEditorOverlay({ onClose }: { onClose: () => void }) {
  const { room, menu, menuVersion, state } = useStore()

  // Which steps would lose recorded progress if this menu were saved. The
  // server prunes either way; asking first is what makes that not a surprise.
  const progressAtRisk = (next: Menu) => {
    const surviving = new Set(next.steps.map((s) => s.id))
    return menu.steps
      .filter((s) => !surviving.has(s.id) && recordOf(state, s.id).state !== 'todo')
      .map((s) => s.title)
  }

  return (
    <div className={styles.editorOverlay}>
      <div className={cx(ui.banner, ui.bannerWarn, styles.editorLiveNote)}>
        Muokkaat tämän keittiön menua. Tallennus näkyy heti kaikille kokeille.
      </div>
      <MenuEditor
        initial={menu}
        initialVersion={menuVersion}
        storageKey={`parallel-cooking/menuDraft/room-${room.id}`}
        save={(next, expectedVersion) => saveRoomMenu(room.id, next, expectedVersion)}
        progressAtRisk={progressAtRisk}
        onClose={onClose}
      />
    </div>
  )
}

function CooksModal({ onClose }: { onClose: () => void }) {
  const { state, presence, addCook, renameCook, removeCook, me, setMe } = useStore()
  return (
    <Modal label="Kokit" variant="sheet" onClose={onClose}>
      <ModalHead title="Kokit" onClose={onClose} />

      <div className={styles.cooksList}>
        {state.cooks.map((cook) => (
          <div
            key={cook.id}
            className={cx(styles.cookRow, me === cook.id && styles.isMe)}
            data-testid="cook-row"
          >
            <PresenceDot online={presence.has(cook.id)} />
            <span className={ui.cookDot} style={badgeColors(cook.color)}>
              {cook.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <input
              className={ui.control}
              value={cook.name}
              onChange={(e) => renameCook(cook.id, e.target.value)}
              aria-label="Kokin nimi"
            />
            {/* Who *this browser* is: a per-cook toggle, so it needs no explaining. */}
            <button
              className={cx(ui.btn, styles.btnMe, me === cook.id && styles.isActive)}
              onClick={() => setMe(me === cook.id ? null : cook.id)}
              aria-pressed={me === cook.id}
            >
              Oon tää
            </button>
            <button
              className={cx(ui.btn, ui.btnGhost, ui.icon)}
              onClick={() => removeCook(cook.id)}
              aria-label={`Poista ${cook.name}`}
              disabled={state.cooks.length <= 1}
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>

      <div className={ui.modalActions} data-testid="modal-actions">
        <button className={ui.btn} onClick={addCook}>
          Lisää kokki
        </button>
        <button className={cx(ui.btn, ui.btnGhost)} onClick={onClose}>
          Sulje
        </button>
      </div>
    </Modal>
  )
}

/**
 * Somebody has this room open as that cook. Always rendered, so a cook
 * arriving or leaving never shifts the row, and deliberately silent about how
 * many clients are on one cook — a phone and a laptop on the same name is a
 * normal way to work, not a clash.
 */
function PresenceDot({ online }: { online: boolean }) {
  return (
    <span
      className={cx(styles.presence, online && styles.isOnline)}
      {...(online ? { role: 'img', 'aria-label': 'Paikalla', title: 'Paikalla' } : {})}
    />
  )
}
