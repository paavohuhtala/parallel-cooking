import { useMemo, useState, type DragEvent } from 'react'
import { STATIONS, type Step, type StepState, type StepStatus } from '../model/types'
import { Icon, STATION_ICON } from '../components/icons.tsx'
import { recordOf, statusOf } from '../state/graph'
import { useStore } from '../state/store'
import { CookDot, STATUS_LABEL, StepControls } from '../components/StepControls'

const COLUMNS: { status: StepStatus; drop: StepState | null; hint: string }[] = [
  { status: 'blocked', drop: null, hint: 'Odottaa jotain aiempaa vaihetta' },
  { status: 'ready', drop: 'todo', hint: 'Kuka tahansa voi tarttua näihin' },
  { status: 'active', drop: 'active', hint: 'Joku tekee parhaillaan' },
  { status: 'done', drop: 'done', hint: 'Tehty' },
]

type Grouping = 'none' | 'cook' | 'station' | 'component'

const GROUPING_LABEL: Record<Grouping, string> = {
  none: 'Ei ryhmittelyä',
  cook: 'Kokin mukaan',
  station: 'Pisteen mukaan',
  component: 'Osan mukaan',
}

export function KanbanView({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (id: string) => void
}) {
  const { menu, index, state, setStepState, requestStart } = useStore()
  const [grouping, setGrouping] = useState<Grouping>('none')
  const [dragging, setDragging] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  const order = new Map(index.topoOrder.map((id, i) => [id, i]))

  const lanes = useMemo(() => {
    switch (grouping) {
      case 'cook':
        return [
          ...state.cooks.map((c) => ({
            id: c.id,
            label: c.name,
            color: c.color as string | undefined,
            match: (s: Step) => recordOf(state, s.id).cookId === c.id,
          })),
          {
            id: '__none',
            label: 'Ei tekijää',
            color: undefined,
            match: (s: Step) => !recordOf(state, s.id).cookId,
          },
        ]
      case 'station':
        return STATIONS.map((st) => ({
          id: st.id,
          label: (
            <>
              <Icon name={STATION_ICON[st.id]} /> {st.label}
            </>
          ),
          color: undefined,
          match: (s: Step) => s.station === st.id,
        }))
      case 'component':
        return menu.components.map((c) => ({
          id: c.id,
          label: c.name,
          color: undefined,
          match: (s: Step) => s.componentId === c.id,
        }))
      default:
        return [{ id: '__all', label: '', color: undefined, match: () => true }]
    }
  }, [grouping, state, menu])

  const statuses = useMemo(
    () => new Map(menu.steps.map((s) => [s.id, statusOf(s, state)])),
    [menu, state],
  )

  const drop = (e: DragEvent, target: StepState | null) => {
    e.preventDefault()
    setHover(null)
    const id = dragging ?? e.dataTransfer.getData('text/plain')
    setDragging(null)
    if (!id || !target) return
    // Dropping into "Työn alla" is a start, so it asks who is taking it.
    if (target === 'active') requestStart(id)
    else setStepState(id, target)
  }

  return (
    <div className="kanban" data-testid="board">
      <div className="kanban-toolbar" data-testid="board-toolbar">
        <span className="muted small">Ryhmittely:</span>
        {(Object.keys(GROUPING_LABEL) as Grouping[]).map((g) => (
          <button
            key={g}
            className={`chip ${grouping === g ? 'is-active' : ''}`}
            onClick={() => setGrouping(g)}
          >
            {GROUPING_LABEL[g]}
          </button>
        ))}
        <span className="muted small">Raahaa kortti sarakkeesta toiseen.</span>
      </div>

      <div className="lanes">
        {lanes.map((lane) => {
          const laneSteps = menu.steps.filter(lane.match)
          if (grouping !== 'none' && laneSteps.length === 0) return null
          return (
            <section key={lane.id} className="lane" data-testid="lane">
              {lane.label && (
                <h3 className="lane-title">
                  {lane.color && <span className="cook-dot" style={{ background: lane.color }} />}
                  {lane.label}
                  <span className="muted small">
                    {laneSteps.filter((s) => statuses.get(s.id) === 'done').length}/
                    {laneSteps.length}
                  </span>
                </h3>
              )}
              <div className="board">
                {COLUMNS.map((column) => {
                  const cards = laneSteps
                    .filter((s) => statuses.get(s.id) === column.status)
                    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
                  const key = `${lane.id}:${column.status}`
                  return (
                    <div
                      key={column.status}
                      className={`column status-${column.status} ${
                        hover === key ? 'is-hover' : ''
                      } ${dragging && !column.drop ? 'is-nodrop' : ''}`}
                      data-testid={`column-${column.status}`}
                      onDragOver={(e) => {
                        if (!column.drop) return
                        e.preventDefault()
                        setHover(key)
                      }}
                      onDragLeave={() => setHover((h) => (h === key ? null : h))}
                      onDrop={(e) => drop(e, column.drop)}
                    >
                      <header className="column-head">
                        <span className={`dot status-${column.status}`} />
                        <strong>{STATUS_LABEL[column.status]}</strong>
                        <span className="muted small">{cards.length}</span>
                      </header>
                      {!lane.label && <p className="column-hint muted small">{column.hint}</p>}
                      <div className="column-body">
                        {cards.map((step) => (
                          <Card
                            key={step.id}
                            step={step}
                            status={column.status}
                            selected={selected === step.id}
                            onSelect={onSelect}
                            onDragStart={() => setDragging(step.id)}
                            onDragEnd={() => {
                              setDragging(null)
                              setHover(null)
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Card({
  step,
  status,
  selected,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  step: Step
  status: StepStatus
  selected: boolean
  onSelect: (id: string) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const { menu, state } = useStore()
  const record = recordOf(state, step.id)
  const component = menu.components.find((c) => c.id === step.componentId)
  const station = STATIONS.find((s) => s.id === step.station)

  return (
    <article
      className={`card status-${status} ${selected ? 'is-selected' : ''}`}
      data-testid="card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', step.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(step.id)}
    >
      <div className="card-top">
        <span className="card-component muted small">{component?.name}</span>
        <CookDot cookId={record.cookId} />
      </div>
      <div className="card-title" data-testid="card-title">
        {step.title}
      </div>
      {step.station !== 'muu' && (
        <div className="card-facts muted small">
          <Icon name={STATION_ICON[step.station]} /> {station?.label}
        </div>
      )}
      <StepControls step={step} status={status} />
    </article>
  )
}
