import { STATIONS, type StepStatus } from '../model/types'
import { Icon, STATION_ICON } from '../components/icons.tsx'
import { recordOf, statusOf } from '../state/graph'
import { useStore } from '../state/store'
import { CookDot, STATUS_LABEL, StepControls } from '../components/StepControls'
import { cx } from '../components/cx.ts'
import ui from '../components/ui.module.css'
import styles from './RecipeView.module.css'

const DOT_CLASS: Record<StepStatus, string> = {
  blocked: ui.statusBlocked,
  ready: ui.statusReady,
  active: ui.statusActive,
  done: ui.statusDone,
}

/* `ready` has no rule of its own: a row a cook can start is the plain row. */
const ROW_CLASS: Record<StepStatus, string | undefined> = {
  blocked: styles.statusBlocked,
  ready: styles.statusReady,
  active: styles.statusActive,
  done: styles.statusDone,
}

export function RecipeView({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (id: string) => void
}) {
  const { menu, index, state } = useStore()
  const order = new Map(index.topoOrder.map((id, i) => [id, i]))

  return (
    <div className={styles.recipe} data-testid="recipe">
      {menu.courses.map((course) => (
        <article key={course.id} data-testid="course">
          <header className={styles.courseHead}>
            <span className={styles.courseNumber}>{course.order}</span>
            <div>
              <h2>{course.name}</h2>
              {course.note && <p className={ui.muted}>{course.note}</p>}
            </div>
          </header>

          <div className={styles.components}>
            {menu.components
              .filter((c) => c.courseId === course.id)
              .map((component) => {
                const steps = menu.steps
                  .filter((s) => s.componentId === component.id)
                  .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
                const done = steps.filter((s) => statusOf(s, state) === 'done').length

                return (
                  <section key={component.id} className={styles.component} data-testid="component">
                    <header className={styles.componentHead}>
                      <h3>{component.name}</h3>
                      <span className={cx(ui.muted, ui.small)} data-testid="component-progress">
                        {done}/{steps.length} valmiina
                      </span>
                      <div
                        className={styles.minibar}
                        role="progressbar"
                        aria-valuenow={done}
                        aria-valuemax={steps.length}
                      >
                        <span style={{ width: `${(done / steps.length) * 100}%` }} />
                      </div>
                    </header>

                    {component.note && <p className={cx(ui.muted, ui.small)}>{component.note}</p>}

                    <details className={styles.ingredients}>
                      <summary>Ainekset ({component.ingredients.length})</summary>
                      <ul className={ui.plainList}>
                        {component.ingredients.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    </details>

                    <ol className={styles.steps}>
                      {steps.map((step) => {
                        const status = statusOf(step, state)
                        const record = recordOf(state, step.id)
                        const station = STATIONS.find((s) => s.id === step.station)
                        return (
                          <li
                            key={step.id}
                            className={cx(
                              styles.stepRow,
                              ROW_CLASS[status],
                              selected === step.id && styles.isSelected,
                            )}
                            data-testid="step-row"
                            data-status={status}
                            data-step-id={step.id}
                          >
                            <button
                              className={styles.stepMain}
                              data-testid="step-main"
                              onClick={() => onSelect(step.id)}
                              aria-expanded={selected === step.id}
                            >
                              <span className={cx(ui.dot, DOT_CLASS[status])} />
                              <span className={styles.stepTitle}>
                                {step.title}
                                {step.holdPoint && (
                                  <span className={cx(ui.tag, ui.tagHold)} title="Voi tehdä hyvissä ajoin">
                                    etukäteen
                                  </span>
                                )}
                              </span>
                              <span
                                className={cx(styles.stepFacts, ui.muted, ui.small)}
                                data-testid="step-facts"
                              >
                                {step.station !== 'muu' && (
                                  <>
                                    <Icon name={STATION_ICON[step.station]} /> {station?.label} ·{' '}
                                  </>
                                )}
                                {STATUS_LABEL[status]}
                              </span>
                              <CookDot cookId={record.cookId} />
                            </button>
                            <StepControls step={step} status={status} />
                          </li>
                        )
                      })}
                    </ol>
                  </section>
                )
              })}
          </div>
        </article>
      ))}
    </div>
  )
}
