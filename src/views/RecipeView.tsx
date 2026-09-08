import { STATIONS } from '../model/types'
import { recordOf, statusOf } from '../state/graph'
import { useStore } from '../state/store'
import { CookDot, STATUS_LABEL, StepControls } from '../components/StepControls'

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
    <div className="recipe">
      {menu.courses.map((course) => (
        <article key={course.id} className="course">
          <header className="course-head">
            <span className="course-number">{course.order}</span>
            <div>
              <h2>{course.name}</h2>
              {course.note && <p className="muted">{course.note}</p>}
            </div>
          </header>

          <div className="components">
            {menu.components
              .filter((c) => c.courseId === course.id)
              .map((component) => {
                const steps = menu.steps
                  .filter((s) => s.componentId === component.id)
                  .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
                const done = steps.filter((s) => statusOf(s, state) === 'done').length

                return (
                  <section key={component.id} className="component">
                    <header className="component-head">
                      <h3>{component.name}</h3>
                      <span className="muted small">
                        {done}/{steps.length} valmiina
                      </span>
                      <div
                        className="minibar"
                        role="progressbar"
                        aria-valuenow={done}
                        aria-valuemax={steps.length}
                      >
                        <span style={{ width: `${(done / steps.length) * 100}%` }} />
                      </div>
                    </header>

                    {component.note && <p className="muted small">{component.note}</p>}

                    <details className="ingredients">
                      <summary>Ainekset ({component.ingredients.length})</summary>
                      <ul className="plain-list">
                        {component.ingredients.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    </details>

                    <ol className="steps">
                      {steps.map((step) => {
                        const status = statusOf(step, state)
                        const record = recordOf(state, step.id)
                        const station = STATIONS.find((s) => s.id === step.station)
                        return (
                          <li
                            key={step.id}
                            className={`step-row status-${status} ${
                              selected === step.id ? 'is-selected' : ''
                            }`}
                          >
                            <button
                              className="step-main"
                              onClick={() => onSelect(step.id)}
                              aria-expanded={selected === step.id}
                            >
                              <span className={`dot status-${status}`} />
                              <span className="step-title">
                                {step.title}
                                {index.criticalPath.has(step.id) && (
                                  <span className="tag tag-critical" title="Kriittisellä polulla">
                                    kriittinen
                                  </span>
                                )}
                                {step.holdPoint && (
                                  <span className="tag tag-hold" title="Voi tehdä hyvissä ajoin">
                                    etukäteen
                                  </span>
                                )}
                              </span>
                              <span className="step-facts muted small">
                                {step.station !== 'muu' && `${station?.icon} ${station?.label} · `}
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
