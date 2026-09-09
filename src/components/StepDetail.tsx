import { STATIONS } from '../model/types'
import { recordOf, statusOf } from '../state/graph'
import { useStore } from '../state/store'
import { CookPicker, STATUS_LABEL, StepControls } from './StepControls'

export function StepDetail({
  stepId,
  onClose,
  onSelect,
}: {
  stepId: string
  onClose: () => void
  onSelect: (id: string) => void
}) {
  const { menu, index, state } = useStore()
  const step = index.steps.get(stepId)
  if (!step) return null

  const status = statusOf(step, state)
  const record = recordOf(state, step.id)
  const component = menu.components.find((c) => c.id === step.componentId)
  const station = STATIONS.find((s) => s.id === step.station)
  const dependents = index.dependents.get(step.id) ?? []

  return (
    <aside className="detail">
      <div className="detail-head">
        <div>
          <div className="detail-kicker">{component?.name}</div>
          <h2>{step.title}</h2>
        </div>
        <button className="btn btn-ghost icon" onClick={onClose} aria-label="Sulje tiedot">
          ✕
        </button>
      </div>

      <div className="detail-meta">
        <span className={`pill status-${status}`}>{STATUS_LABEL[status]}</span>
        {step.station !== 'muu' && (
          <span className="pill">
            {station?.icon} {station?.label}
          </span>
        )}
        {step.holdPoint && <span className="pill pill-hold">Voi tehdä etukäteen</span>}
      </div>

      {step.detail && <p className="detail-text">{step.detail}</p>}

      {step.uses?.length ? (
        <section>
          <h3>Tarvitaan</h3>
          <ul className="plain-list">
            {step.uses.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3>Tekijä</h3>
        <CookPicker step={step} />
        {record.startedAt && (
          <p className="muted small">
            Aloitettu {new Date(record.startedAt).toLocaleTimeString('fi-FI')}
            {record.completedAt
              ? ` · valmistui ${new Date(record.completedAt).toLocaleTimeString('fi-FI')}`
              : ''}
          </p>
        )}
      </section>

      <section>
        <h3>Edellyttää</h3>
        {step.deps.length ? (
          <ul className="link-list">
            {step.deps.map((d) => {
              const dep = index.steps.get(d)!
              return (
                <li key={d}>
                  <button className="linky" onClick={() => onSelect(d)}>
                    <span className={`dot status-${statusOf(dep, state)}`} />
                    {dep.title}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="muted small">Ei mitään — tämän voi aloittaa milloin vain.</p>
        )}
      </section>

      <section>
        <h3>Avaa seuraavat</h3>
        {dependents.length ? (
          <ul className="link-list">
            {dependents.map((d) => {
              const dep = index.steps.get(d)!
              return (
                <li key={d}>
                  <button className="linky" onClick={() => onSelect(d)}>
                    <span className={`dot status-${statusOf(dep, state)}`} />
                    {dep.title}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="muted small">Ei mitään — tämä on ketjun pää.</p>
        )}
      </section>

      <div className="detail-actions">
        <StepControls step={step} status={status} />
      </div>
    </aside>
  )
}
