import type { Step, StepStatus } from '../model/types'
import { checkTransition, recordOf } from '../state/graph'
import { useStore } from '../state/store'
import { Icon, StartIcon } from './icons.tsx'

export const STATUS_LABEL: Record<StepStatus, string> = {
  blocked: 'Odottaa',
  ready: 'Voi aloittaa',
  active: 'Työn alla',
  done: 'Valmis',
}

export function CookDot({ cookId }: { cookId: string | null }) {
  const { state } = useStore()
  const cook = state.cooks.find((c) => c.id === cookId)
  if (!cook) return null
  return (
    <span className="cook-dot" style={{ background: cook.color }} title={cook.name}>
      {cook.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

export function CookPicker({ step }: { step: Step }) {
  const { state, assign } = useStore()
  const current = recordOf(state, step.id).cookId ?? ''
  return (
    <select
      className="cook-picker"
      value={current}
      onChange={(e) => assign(step.id, e.target.value || null)}
      aria-label={`Kenelle: ${step.title}`}
    >
      <option value="">Ei tekijää</option>
      {state.cooks.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

/**
 * The moves a step can make, with anything illegal shown disabled and
 * explained rather than hidden — a cook needs to know *why* they can't undo.
 */
export function StepControls({ step, status }: { step: Step; status: StepStatus }) {
  const { index, state, setStepState, requestStart } = useStore()

  const toActive = checkTransition(index, state, step.id, 'active')
  const toDone = checkTransition(index, state, step.id, 'done')
  const toTodo = checkTransition(index, state, step.id, 'todo')

  return (
    <div className="step-controls">
      {status !== 'active' && status !== 'done' && (
        <button
          className="btn btn-start"
          disabled={!toActive.allowed}
          title={toActive.reason}
          onClick={() => requestStart(step.id)}
        >
          <StartIcon /> Aloita
        </button>
      )}
      {status !== 'done' && (
        <button
          className="btn btn-done"
          disabled={!toDone.allowed}
          title={toDone.reason}
          onClick={() => setStepState(step.id, 'done')}
        >
          <Icon name="check" /> Valmis
        </button>
      )}
      {status === 'active' && (
        <button className="btn btn-ghost" onClick={() => setStepState(step.id, 'todo')}>
          Palauta
        </button>
      )}
      {status === 'done' && (
        <>
          <button
            className="btn btn-ghost"
            disabled={!toActive.allowed}
            title={toActive.reason}
            onClick={() => setStepState(step.id, 'active')}
          >
            Avaa uudelleen
          </button>
          <button
            className="btn btn-ghost"
            disabled={!toTodo.allowed}
            title={toTodo.reason}
            onClick={() => setStepState(step.id, 'todo')}
          >
            Kumoa
          </button>
        </>
      )}
    </div>
  )
}

/** "Kuka ottaa tämän?" — shown when an unassigned step is started. */
export function StartDialog() {
  const { index, state, pendingStart, confirmStart, cancelStart } = useStore()
  if (!pendingStart) return null
  const step = index.steps.get(pendingStart)
  if (!step) return null

  return (
    <div className="modal-backdrop" onClick={cancelStart}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Kuka ottaa tämän vaiheen?"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Kuka ottaa tämän?</h2>
        <p className="muted small">{step.title}</p>
        <div className="modal-cooks">
          {state.cooks.map((cook) => (
            <button
              key={cook.id}
              className="cook-choice"
              onClick={() => confirmStart(pendingStart, cook.id)}
            >
              <span className="cook-dot" style={{ background: cook.color }}>
                {cook.name.trim().charAt(0).toUpperCase() || '?'}
              </span>
              {cook.name}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => confirmStart(pendingStart, null)}>
            Aloita ilman tekijää
          </button>
          <button className="btn btn-ghost" onClick={cancelStart}>
            Peruuta
          </button>
        </div>
      </div>
    </div>
  )
}
