import { STATIONS, type StepStatus } from '../model/types'
import { Icon, STATION_ICON } from './icons.tsx'
import { recordOf, statusOf } from '../state/graph'
import { useStore } from '../state/store'
import { CookPicker, STATUS_LABEL, StepControls } from './StepControls'
import { cx } from './cx.ts'
import ui from './ui.module.css'
import styles from './StepDetail.module.css'

const STATUS_CLASS: Record<StepStatus, string> = {
  blocked: ui.statusBlocked,
  ready: ui.statusReady,
  active: ui.statusActive,
  done: ui.statusDone,
}

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
    <aside className={styles.detail} data-testid="step-detail">
      <div className={styles.detailHead}>
        <div>
          <div className={styles.detailKicker} data-testid="detail-kicker">
            {component?.name}
          </div>
          <h2 data-testid="detail-title">{step.title}</h2>
        </div>
        <button
          className={cx(ui.btn, ui.btnGhost, ui.icon)}
          onClick={onClose}
          aria-label="Sulje tiedot"
        >
          <Icon name="close" />
        </button>
      </div>

      <div className={styles.detailMeta}>
        <span className={cx(ui.pill, STATUS_CLASS[status])} data-testid="detail-status">
          {STATUS_LABEL[status]}
        </span>
        {step.station !== 'muu' && (
          <span className={ui.pill}>
            <Icon name={STATION_ICON[step.station]} /> {station?.label}
          </span>
        )}
        {step.holdPoint && <span className={cx(ui.pill, ui.pillHold)}>Voi tehdä etukäteen</span>}
      </div>

      {step.detail && (
        <p className={styles.detailText} data-testid="detail-text">
          {step.detail}
        </p>
      )}

      {step.uses?.length ? (
        <section>
          <h3>Tarvitaan</h3>
          <ul className={ui.plainList}>
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
          <p className={cx(ui.muted, ui.small)} data-testid="detail-started">
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
          <ul className={ui.linkList}>
            {step.deps.map((d) => {
              const dep = index.steps.get(d)!
              return (
                <li key={d}>
                  <button
                    className={ui.linky}
                    data-testid="detail-link"
                    onClick={() => onSelect(d)}
                  >
                    <span className={cx(ui.dot, STATUS_CLASS[statusOf(dep, state)])} />
                    {dep.title}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className={cx(ui.muted, ui.small)}>Ei mitään — tämän voi aloittaa milloin vain.</p>
        )}
      </section>

      <section>
        <h3>Avaa seuraavat</h3>
        {dependents.length ? (
          <ul className={ui.linkList}>
            {dependents.map((d) => {
              const dep = index.steps.get(d)!
              return (
                <li key={d}>
                  <button
                    className={ui.linky}
                    data-testid="detail-link"
                    onClick={() => onSelect(d)}
                  >
                    <span className={cx(ui.dot, STATUS_CLASS[statusOf(dep, state)])} />
                    {dep.title}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className={cx(ui.muted, ui.small)}>Ei mitään — tämä on ketjun pää.</p>
        )}
      </section>

      <div className={styles.detailActions}>
        <StepControls step={step} status={status} />
      </div>
    </aside>
  )
}
