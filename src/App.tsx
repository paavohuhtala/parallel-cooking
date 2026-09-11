import { useMemo, useState, type ReactNode } from 'react'
import type { Menu } from './model/types'
import { useNavigate } from '@tanstack/react-router'
import { createRoom, saveRoomMenu } from './api/client'
import { MenuEditor } from './components/MenuEditor'
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

type View = 'recipe' | 'graph' | 'board' | 'shift'

const CONNECTION_LABEL: Record<'connecting' | 'online' | 'offline', string> = {
  connecting: 'Yhdistetään…',
  online: 'Verkossa',
  offline: 'Ei yhteyttä',
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
  const navigate = useNavigate()
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

  // Resetting a kitchen means starting a new one from the same menu — rooms are
  // cheap, and this keeps the finished dinner around to look back at.
  async function startFresh() {
    if (!confirm('Aloitetaanko uusi keittiö samalla menulla? Tämä jää talteen.')) return
    const fresh = await createRoom({ fromRoomId: room.id })
    await navigate({ to: '/r/$roomId', params: { roomId: fresh.id } })
  }

  const progress = useMemo(() => progressOf(menu, index, state), [menu, index, state])
  const upNext = useMemo(() => suggestedNext(menu, index, state), [menu, index, state])

  const select = (id: string) => setSelected((current) => (current === id ? null : id))

  return (
    <div className={`app ${selected ? 'has-detail' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <h1>{room.name}</h1>
          <p className="muted small">
            {progress.done}/{progress.total} vaihetta valmiina · pisin jäljellä oleva ketju{' '}
            {progress.criticalChainLeft} vaihetta
          </p>
        </div>

        <nav className="tabs" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              className={`tab ${view === v.id ? 'is-active' : ''}`}
              onClick={() => setView(v.id)}
            >
              <Icon name={v.icon} /> {v.label}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <RoomActions
            copied={copied}
            cooks={state.cooks.length}
            onCooks={() => setCooksOpen((o) => !o)}
            onCopy={() => void copyLink()}
            onEdit={() => setEditing(true)}
            onFresh={() => void startFresh()}
          />
        </div>

        {/* Where the four buttons above do not fit, they move in here. */}
        <button
          className="btn btn-ghost icon topbar-more"
          onClick={() => setActionsOpen(true)}
          aria-label="Toiminnot"
        >
          <Icon name="overflow" />
        </button>

        <span className={`conn conn-${connection}`} title={CONNECTION_LABEL[connection]}>
          {CONNECTION_LABEL[connection]}
        </span>

        <div className="progressbar" aria-hidden>
          <span className="seg done" style={{ flexGrow: progress.done }} />
          <span className="seg active" style={{ flexGrow: progress.active }} />
          <span className="seg ready" style={{ flexGrow: progress.ready }} />
          <span className="seg blocked" style={{ flexGrow: progress.blocked }} />
        </div>
      </header>

      {index.problems.length > 0 && (
        <div className="banner banner-error">
          <strong>Reseptidatassa on virhe:</strong> {index.problems.join(' ')}
        </div>
      )}

      {rejection && (
        <div className="banner banner-warn" role="alert">
          {rejection.stepId && (
            <strong>{index.steps.get(rejection.stepId)?.title}: </strong>
          )}
          {rejection.reason}
          <button className="btn btn-ghost icon" onClick={dismissRejection} aria-label="Sulje">
            <Icon name="close" />
          </button>
        </div>
      )}

      {upNext.length > 0 && (
        <div className="upnext">
          <span className="upnext-label">Seuraavaksi</span>
          <div className="upnext-items">
            {upNext.slice(0, 6).map((step) => (
              <button
                key={step.id}
                className="chip"
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
      <div className="workspace">
        <div className="scroller">
          <main className="content">
            {view === 'recipe' && <RecipeView selected={selected} onSelect={select} />}
            {view === 'graph' && <GraphView selected={selected} onSelect={select} />}
            {view === 'board' && <KanbanView selected={selected} onSelect={select} />}
            {view === 'shift' && <ShiftView selected={selected} onSelect={select} />}
          </main>
        </div>

        {selected && (
          <>
            {/* Only visible where the panel collapses into a modal sheet. */}
            <div className="detail-backdrop" onClick={() => setSelected(null)} />
            <StepDetail
              stepId={selected}
              onClose={() => setSelected(null)}
              onSelect={(id) => setSelected(id)}
            />
          </>
        )}
      </div>

      <StartDialog />
      {actionsOpen && (
        <ActionsSheet onClose={() => setActionsOpen(false)}>
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
            onFresh={() => {
              setActionsOpen(false)
              void startFresh()
            }}
          />
        </ActionsSheet>
      )}
      {cooksOpen && <CooksModal onClose={() => setCooksOpen(false)} />}
      {editing && <MenuEditorOverlay onClose={() => setEditing(false)} />}
    </div>
  )
}

/**
 * The room's four actions. Rendered twice — inline in the header, and again in
 * the sheet a phone reaches them through — so there is one definition of what
 * they are and one place to change them. The sheet lives outside `.topbar`, so
 * a locator scoped to the header still finds exactly one of each.
 */
function RoomActions({
  copied,
  cooks,
  onCooks,
  onCopy,
  onEdit,
  onFresh,
}: {
  copied: boolean
  cooks: number
  onCooks: () => void
  onCopy: () => void
  onEdit: () => void
  onFresh: () => void
}) {
  return (
    <>
      <button className="btn btn-ghost" onClick={onCooks}>
        <Icon name="cooks" /> Kokit ({cooks})
      </button>
      <button className="btn btn-ghost" onClick={onCopy}>
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
      <button className="btn btn-ghost" onClick={onEdit}>
        <Icon name="edit" /> Muokkaa menua
      </button>
      <button className="btn btn-ghost" onClick={onFresh}>
        Uusi keittiö
      </button>
    </>
  )
}

function ActionsSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Toiminnot"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Toiminnot</h2>
          <button className="btn btn-ghost icon" onClick={onClose} aria-label="Sulje">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-actions">{children}</div>
      </div>
    </div>
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
    <div className="editor-overlay">
      <div className="banner banner-warn editor-live-note">
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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Kokit"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Kokit</h2>
          <button className="btn btn-ghost icon" onClick={onClose} aria-label="Sulje">
            <Icon name="close" />
          </button>
        </div>

        <div className="cooks-list">
          {state.cooks.map((cook) => (
            <div key={cook.id} className={`cook-row${me === cook.id ? ' is-me' : ''}`}>
              <PresenceDot online={presence.has(cook.id)} />
              <span className="cook-dot" style={badgeColors(cook.color)}>
                {cook.name.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <input
                value={cook.name}
                onChange={(e) => renameCook(cook.id, e.target.value)}
                aria-label="Kokin nimi"
              />
              {/* Who *this browser* is: a per-cook toggle, so it needs no explaining. */}
              <button
                className={`btn btn-me${me === cook.id ? ' is-active' : ''}`}
                onClick={() => setMe(me === cook.id ? null : cook.id)}
                aria-pressed={me === cook.id}
              >
                Oon tää
              </button>
              <button
                className="btn btn-ghost icon"
                onClick={() => removeCook(cook.id)}
                aria-label={`Poista ${cook.name}`}
                disabled={state.cooks.length <= 1}
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={addCook}>
            Lisää kokki
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Sulje
          </button>
        </div>
      </div>
    </div>
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
      className={`presence${online ? ' is-online' : ''}`}
      {...(online ? { role: 'img', 'aria-label': 'Paikalla', title: 'Paikalla' } : {})}
    />
  )
}
