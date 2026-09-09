import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { createRoom } from './api/client'
import { StartDialog } from './components/StepControls'
import { StepDetail } from './components/StepDetail'
import { progressOf, suggestedNext } from './state/graph'
import { useStore } from './state/store'
import { GraphView } from './views/GraphView'
import { KanbanView } from './views/KanbanView'
import { RecipeView } from './views/RecipeView'

type View = 'recipe' | 'graph' | 'board'

const CONNECTION_LABEL: Record<'connecting' | 'online' | 'offline', string> = {
  connecting: 'Yhdistetään…',
  online: 'Yhteydessä',
  offline: 'Ei yhteyttä',
}

const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'recipe', label: 'Resepti', icon: '📖' },
  { id: 'graph', label: 'Graafi', icon: '🕸️' },
  { id: 'board', label: 'Keittiötaulu', icon: '🗂️' },
]

export default function App() {
  const store = useStore()
  const { room, menu, index, state, rejection, dismissRejection, connection } = store
  const navigate = useNavigate()
  const [view, setView] = useState<View>('recipe')
  const [selected, setSelected] = useState<string | null>(null)
  const [cooksOpen, setCooksOpen] = useState(false)
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
              <span aria-hidden>{v.icon}</span> {v.label}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={() => setCooksOpen((o) => !o)}>
            👥 Kokit ({state.cooks.length})
          </button>
          <button className="btn btn-ghost" onClick={() => void copyLink()}>
            {copied ? '✓ Kopioitu' : '🔗 Jaa'}
          </button>
          <button className="btn btn-ghost" onClick={() => void startFresh()}>
            Uusi keittiö
          </button>
          <span className={`conn conn-${connection}`} title={CONNECTION_LABEL[connection]}>
            {CONNECTION_LABEL[connection]}
          </span>
        </div>

        <div className="progressbar" aria-hidden>
          <span className="seg done" style={{ flexGrow: progress.done }} />
          <span className="seg active" style={{ flexGrow: progress.active }} />
          <span className="seg ready" style={{ flexGrow: progress.ready }} />
          <span className="seg blocked" style={{ flexGrow: progress.blocked }} />
        </div>
      </header>

      {cooksOpen && <CooksPanel onClose={() => setCooksOpen(false)} />}

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
            ✕
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
    </div>
  )
}

function CooksPanel({ onClose }: { onClose: () => void }) {
  const { state, addCook, renameCook, removeCook, me, setMe } = useStore()
  return (
    <div className="cooks-panel">
      <div className="cooks-list">
        {state.cooks.map((cook) => (
          <div key={cook.id} className={`cook-row${me === cook.id ? ' is-me' : ''}`}>
            <button
              className="cook-dot as-button"
              style={{ background: cook.color }}
              onClick={() => setMe(me === cook.id ? null : cook.id)}
              title={me === cook.id ? 'Tämä olen minä' : 'Merkitse itsesi tähän'}
              aria-pressed={me === cook.id}
            >
              {cook.name.trim().charAt(0).toUpperCase() || '?'}
            </button>
            <input
              value={cook.name}
              onChange={(e) => renameCook(cook.id, e.target.value)}
              aria-label="Kokin nimi"
            />
            <button
              className="btn btn-ghost icon"
              onClick={() => removeCook(cook.id)}
              aria-label={`Poista ${cook.name}`}
              disabled={state.cooks.length <= 1}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <p className="muted cooks-hint">
        Napauta väripalloa merkitäksesi kuka sinä olet — sen jälkeen vaiheet alkavat
        suoraan sinun nimissäsi. Voit silti antaa tehtäviä muille.
      </p>
      <div className="cooks-actions">
        <button className="btn" onClick={addCook}>
          Lisää kokki
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Sulje
        </button>
      </div>
    </div>
  )
}
