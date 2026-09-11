import { useMemo, useState, type DragEvent } from 'react'
import { STATIONS, type Step, type StepState, type StepStatus } from '../model/types'
import { Icon, STATION_ICON } from '../components/icons.tsx'
import { recordOf, statusOf } from '../state/graph'
import { useStore } from '../state/store'
import { CookDot, STATUS_LABEL, StepControls } from '../components/StepControls'
import { cx } from '../components/cx.ts'
import ui from '../components/ui.module.css'
import styles from './KanbanView.module.css'

const DOT_CLASS: Record<StepStatus, string> = {
  blocked: ui.statusBlocked,
  ready: ui.statusReady,
  active: ui.statusActive,
  done: ui.statusDone,
}

/* `blocked` has no rule of its own: the card's own left border is that colour. */
const CARD_CLASS: Record<StepStatus, string | undefined> = {
  blocked: styles.statusBlocked,
  ready: styles.statusReady,
  active: styles.statusActive,
  done: styles.statusDone,
}

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
    <div className={styles.kanban} data-testid="board">
      <div className={styles.kanbanToolbar} data-testid="board-toolbar">
        <span className={cx(ui.muted, ui.small)}>Ryhmittely:</span>
        {(Object.keys(GROUPING_LABEL) as Grouping[]).map((g) => (
          <button
            key={g}
            className={cx(ui.chip, grouping === g && ui.isActive)}
            onClick={() => setGrouping(g)}
          >
            {GROUPING_LABEL[g]}
          </button>
        ))}
        <span className={cx(ui.muted, ui.small)}>Raahaa kortti sarakkeesta toiseen.</span>
      </div>

      <div className={styles.lanes}>
        {lanes.map((lane) => {
          const laneSteps = menu.steps.filter(lane.match)
          if (grouping !== 'none' && laneSteps.length === 0) return null
          return (
            <section key={lane.id} data-testid="lane">
              {lane.label && (
                <h3 className={styles.laneTitle}>
                  {lane.color && <span className={ui.cookDot} style={{ background: lane.color }} />}
                  {lane.label}
                  <span className={cx(ui.muted, ui.small)}>
                    {laneSteps.filter((s) => statuses.get(s.id) === 'done').length}/
                    {laneSteps.length}
                  </span>
                </h3>
              )}
              <div className={styles.board}>
                {COLUMNS.map((column) => {
                  const cards = laneSteps
                    .filter((s) => statuses.get(s.id) === column.status)
                    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
                  const key = `${lane.id}:${column.status}`
                  return (
                    <div
                      key={column.status}
                      className={cx(
                        styles.column,
                        hover === key && styles.isHover,
                        dragging && !column.drop && styles.isNodrop,
                      )}
                      data-testid={`column-${column.status}`}
                      onDragOver={(e) => {
                        if (!column.drop) return
                        e.preventDefault()
                        setHover(key)
                      }}
                      onDragLeave={() => setHover((h) => (h === key ? null : h))}
                      onDrop={(e) => drop(e, column.drop)}
                    >
                      <header className={styles.columnHead}>
                        <span className={cx(ui.dot, DOT_CLASS[column.status])} />
                        <strong>{STATUS_LABEL[column.status]}</strong>
                        <span className={cx(styles.columnCount, ui.muted, ui.small)}>
                          {cards.length}
                        </span>
                      </header>
                      {!lane.label && <p className={cx(ui.muted, ui.small)}>{column.hint}</p>}
                      <div className={styles.columnBody}>
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
      className={cx(styles.card, CARD_CLASS[status], selected && styles.isSelected)}
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
      <div className={styles.cardTop}>
        <span className={cx(ui.muted, ui.small)}>{component?.name}</span>
        <CookDot cookId={record.cookId} className={styles.cardCook} />
      </div>
      <div className={styles.cardTitle} data-testid="card-title">
        {step.title}
      </div>
      {step.station !== 'muu' && (
        <div className={cx(ui.muted, ui.small)}>
          <Icon name={STATION_ICON[step.station]} /> {station?.label}
        </div>
      )}
      <StepControls step={step} status={status} className={styles.cardControls} />
    </article>
  )
}
