import { useEffect, useMemo, useState } from 'react'
import { STATIONS, type Menu, type Station, type Step } from '../model/types'
import { Icon, STATION_ICON, StartIcon } from '../components/icons.tsx'
import { badgeColors } from '../components/ink.ts'
import { CookDot } from '../components/StepControls'
import { checkTransition, recordOf, statusOf } from '../state/graph'
import {
  activeFor,
  justUnblocked,
  oneStepAway,
  rankReady,
  type ShiftPick,
  type ShiftReason,
} from '../state/shift'
import { useStore } from '../state/store'

/**
 * One cook, one phone. The board, the recipe and the graph all answer *what is
 * the state of the kitchen*; this answers *what do I do next, and how*.
 *
 * One scrolling column, three zones, in the order a cook needs them: what I
 * have going and its instructions, what I should take next and why, and who I
 * am waiting on. All the reasoning lives in `state/shift.ts`; this file is the
 * wording and the thumbs.
 */
export function ShiftView({ onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const { menu, index, state, me } = useStore()
  const [finished, setFinished] = useState<string | null>(null)

  // Every one-tap affordance below depends on knowing who is holding the
  // phone, so the view opens on that question rather than on the content.
  const known = me !== null && state.cooks.some((c) => c.id === me)
  if (!known) return <CookGate />

  const active = activeFor(menu, index, state, me)
  const picks = rankReady(menu, index, state, me)
  const waiting = oneStepAway(menu, index, state)
  const mine = menu.steps.filter((s) => {
    const record = recordOf(state, s.id)
    return record.state === 'done' && record.cookId === me
  })

  return (
    <div className="shift">
      <ActiveZone steps={active} onSelect={onSelect} onFinished={setFinished} />
      <NextZone picks={picks} onSelect={onSelect} />
      {waiting.length > 0 && <WaitingZone waiting={waiting} onSelect={onSelect} />}
      {mine.length > 0 && <DoneZone steps={mine} />}
      {finished && <CompletionBar stepId={finished} onDismiss={() => setFinished(null)} />}
    </div>
  )
}

/* --------------------------------------------------------------- the gate */

/**
 * Without this, every `Aloita` below becomes a two-step `StartDialog` — which
 * is precisely the friction the board already has. `setMe` persists per room
 * and per browser, and the session re-announces presence after every
 * reconnect, so this is asked once.
 */
function CookGate() {
  const { state, presence, me, setMe, addCook } = useStore()
  return (
    <div className="shift-gate">
      <h2>Kuka sinä olet?</h2>
      <p className="muted small">
        Nimi jää tälle puhelimelle. Sen jälkeen vaiheen aloitus on yksi napautus.
      </p>
      <div className="gate-cooks">
        {state.cooks.map((cook) => (
          <button key={cook.id} className="cook-choice" onClick={() => setMe(cook.id)}>
            <span className="cook-dot" style={badgeColors(cook.color)}>
              {cook.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
            {cook.name}
            {presence.has(cook.id) && cook.id !== me && (
              <span className="muted small gate-taken">jo paikalla</span>
            )}
          </button>
        ))}
        <button className="cook-choice is-add" onClick={() => setMe(addCook())}>
          <span className="cook-dot cook-dot-empty">
            <Icon name="add" />
          </span>
          Lisää kokki
        </button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- zone one */

function ActiveZone({
  steps,
  onSelect,
  onFinished,
}: {
  steps: Step[]
  onSelect: (id: string) => void
  onFinished: (stepId: string) => void
}) {
  // The first card is open, because that is the whole reason the phone is in a
  // hand; the rest are title rows until asked. A cook can overrule either way.
  const [open, setOpen] = useState<Record<string, boolean>>({})

  return (
    <section className="shift-zone">
      <h2 className="shift-zone-head">
        Työn alla <span className="muted small">{steps.length}</span>
      </h2>
      {steps.length === 0 ? (
        <p className="shift-empty muted small">Ei mitään kesken. Ota seuraava alta.</p>
      ) : (
        steps.map((step, i) => (
          <ActiveCard
            key={step.id}
            step={step}
            open={open[step.id] ?? i === 0}
            onToggle={() => setOpen((o) => ({ ...o, [step.id]: !(o[step.id] ?? i === 0) }))}
            onSelect={onSelect}
            onFinished={onFinished}
          />
        ))
      )}
    </section>
  )
}

function ActiveCard({
  step,
  open,
  onToggle,
  onSelect,
  onFinished,
}: {
  step: Step
  open: boolean
  onToggle: () => void
  onSelect: (id: string) => void
  onFinished: (stepId: string) => void
}) {
  const { menu, index, state, setStepState, assign } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const record = recordOf(state, step.id)
  const component = menu.components.find((c) => c.id === step.componentId)
  const toTodo = checkTransition(index, state, step.id, 'todo')

  return (
    <article className="shift-card is-active">
      <button className="shift-card-head" onClick={onToggle} aria-expanded={open}>
        <span className="shift-kicker muted small">
          {component?.name}
          <StationTag station={step.station} />
        </span>
        <span className="shift-title">{step.title}</span>
        <Elapsed since={record.startedAt} />
      </button>

      {open && (
        <div className="shift-card-body">
          {step.detail && <p className="shift-detail">{step.detail}</p>}
          {step.uses?.length ? (
            <ul className="plain-list shift-uses">
              {step.uses.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          ) : null}
          <button className="linky shift-more" onClick={() => onSelect(step.id)}>
            Näytä kaikki tiedot
          </button>
        </div>
      )}

      <div className="shift-card-actions">
        <button
          className="btn btn-done shift-primary"
          onClick={() => setStepState(step.id, 'done') && onFinished(step.id)}
        >
          <Icon name="check" /> Valmis
        </button>
        {/*
          Everything that could take the work away from you sits behind the
          `⋯`: a button sized for a thumb will occasionally be hit by a thumb
          that meant something else, and losing your step is worse than a
          second tap.
        */}
        <button
          className="btn btn-ghost icon"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={`Muut toiminnot: ${step.title}`}
          aria-expanded={menuOpen}
        >
          <Icon name="overflow" />
        </button>
      </div>

      {menuOpen && (
        <div className="shift-card-menu">
          <button
            className="btn btn-ghost"
            disabled={!toTodo.allowed}
            title={toTodo.reason}
            onClick={() => {
              setMenuOpen(false)
              setStepState(step.id, 'todo')
            }}
          >
            Palauta jonoon
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setMenuOpen(false)
              assign(step.id, null)
            }}
          >
            Luovu tekijyydestä
          </button>
        </div>
      )}
    </article>
  )
}

/**
 * How long this has been on. `startedAt` has been recorded since the first
 * version of `applyCommand` and nothing has ever drawn it; on a phone it is
 * the single most useful number on the screen.
 */
function Elapsed({ since }: { since?: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((t) => t + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  if (!since) return null
  const minutes = Math.max(0, Math.floor((Date.now() - since) / 60_000))
  return (
    <span className="shift-elapsed muted small">
      {minutes < 1 ? 'juuri nyt' : `${minutes} min`} · aloitettu{' '}
      {new Date(since).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

/* ---------------------------------------------------------------- zone two */

function NextZone({ picks, onSelect }: { picks: ShiftPick[]; onSelect: (id: string) => void }) {
  const { menu, requestStart } = useStore()
  const [station, setStation] = useState<Station | null>(null)
  const [listOpen, setListOpen] = useState(false)

  // The filter narrows the whole zone, hero included: "show me stove work"
  // should change what is being suggested, not just what is listed under it.
  const shown = station ? picks.filter((p) => p.step.station === station) : picks
  const offered = shown.filter((p) => p.offered)
  const taken = shown.filter((p) => !p.offered)
  const [hero, ...rest] = offered
  const available = STATIONS.filter((s) => picks.some((p) => p.step.station === s.id))

  return (
    <section className="shift-zone">
      <h2 className="shift-zone-head">
        Ota seuraava <span className="muted small">{picks.filter((p) => p.offered).length} vapaana</span>
      </h2>

      {hero ? (
        <article className="shift-card is-hero">
          <span className={`shift-why why-${hero.reason.kind}`}>{reasonLabel(hero.reason, menu)}</span>
          <button className="shift-card-head" onClick={() => onSelect(hero.step.id)}>
            <span className="shift-kicker muted small">
              {menu.components.find((c) => c.id === hero.step.componentId)?.name}
              <StationTag station={hero.step.station} />
            </span>
            <span className="shift-title">{hero.step.title}</span>
          </button>
          <div className="shift-card-actions">
            <button
              className="btn btn-start btn-primary shift-primary"
              onClick={() => requestStart(hero.step.id)}
            >
              <StartIcon /> Aloita
            </button>
          </div>
        </article>
      ) : (
        <p className="shift-empty muted small">
          {picks.length === 0
            ? 'Kaikki vapaa työ on otettu. Katso alta, ketä odotat.'
            : 'Tällä pisteellä ei ole vapaata työtä juuri nyt.'}
        </p>
      )}

      {available.length > 1 && (
        <div className="shift-filters">
          <button
            className={`chip ${station === null ? 'is-active' : ''}`}
            onClick={() => setStation(null)}
          >
            Kaikki
          </button>
          {available.map((s) => (
            <button
              key={s.id}
              className={`chip ${station === s.id ? 'is-active' : ''}`}
              onClick={() => setStation(s.id)}
            >
              <Icon name={STATION_ICON[s.id]} /> {s.label}
            </button>
          ))}
        </div>
      )}

      {rest.length + taken.length > 0 && (
        <>
          <button
            className="shift-fold"
            onClick={() => setListOpen((o) => !o)}
            aria-expanded={listOpen}
          >
            Kaikki vapaat
            <span className="muted small">{rest.length + taken.length}</span>
            <Icon name="disclosure" className={listOpen ? 'is-open' : ''} />
          </button>
          {listOpen && (
            <ul className="shift-rows">
              {rest.map((pick) => (
                <li key={pick.step.id}>
                  <ReadyRow pick={pick} onSelect={onSelect} />
                </li>
              ))}
              {taken.map((pick) => (
                <li key={pick.step.id}>
                  <ReadyRow pick={pick} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

/**
 * One ready step in the list. Work already in somebody else's name is shown
 * with their dot and no button — not offered, but not hidden either, or the
 * kitchen would look emptier than it is.
 */
function ReadyRow({ pick, onSelect }: { pick: ShiftPick; onSelect: (id: string) => void }) {
  const { menu, state, requestStart } = useStore()
  const component = menu.components.find((c) => c.id === pick.step.componentId)
  const cookId = recordOf(state, pick.step.id).cookId

  return (
    <div className={`shift-row ${pick.offered ? '' : 'is-taken'}`}>
      <button className="shift-row-main" onClick={() => onSelect(pick.step.id)}>
        <span className="shift-row-title">{pick.step.title}</span>
        <span className="muted small">
          {component?.name} · {reasonLabel(pick.reason, menu)}
        </span>
      </button>
      {pick.offered ? (
        <button className="btn btn-start" onClick={() => requestStart(pick.step.id)}>
          Aloita
        </button>
      ) : (
        <CookDot cookId={cookId} />
      )}
    </div>
  )
}

/* -------------------------------------------------------------- zone three */

function WaitingZone({
  waiting,
  onSelect,
}: {
  waiting: { step: Step; blockers: Step[] }[]
  onSelect: (id: string) => void
}) {
  const { state, presence } = useStore()
  const [open, setOpen] = useState(false)

  return (
    <section className="shift-zone">
      <button className="shift-fold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Odottaa muita
        <span className="muted small">{waiting.length}</span>
        <Icon name="disclosure" className={open ? 'is-open' : ''} />
      </button>
      {open && (
        <ul className="shift-rows">
          {waiting.map(({ step, blockers }) => {
            // Who to nudge: the cooks holding everything in the way.
            const holders = [
              ...new Set(blockers.map((b) => recordOf(state, b.id).cookId).filter((id) => id)),
            ] as string[]
            return (
              <li key={step.id}>
                <div className="shift-row">
                  <button className="shift-row-main" onClick={() => onSelect(step.id)}>
                    <span className="shift-row-title">{step.title}</span>
                    <span className="muted small">
                      Odotat:{' '}
                      {blockers
                        .map((b) => {
                          const cook = state.cooks.find(
                            (c) => c.id === recordOf(state, b.id).cookId,
                          )
                          return cook ? `${cook.name} · ${b.title}` : b.title
                        })
                        .join(', ')}
                    </span>
                  </button>
                  {holders.map((id) => (
                    <span
                      key={id}
                      className={`shift-holder${presence.has(id) ? ' is-online' : ''}`}
                      title={presence.has(id) ? 'Paikalla' : undefined}
                    >
                      <CookDot cookId={id} />
                    </span>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Your own finished work, for the thumb that hit `Valmis` by accident. */
function DoneZone({ steps }: { steps: Step[] }) {
  const { index, state, setStepState } = useStore()
  const [open, setOpen] = useState(false)

  return (
    <section className="shift-zone">
      <button className="shift-fold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Tekemäsi vaiheet
        <span className="muted small">{steps.length}</span>
        <Icon name="disclosure" className={open ? 'is-open' : ''} />
      </button>
      {open && (
        <ul className="shift-rows">
          {steps.map((step) => {
            const back = checkTransition(index, state, step.id, 'todo')
            return (
              <li key={step.id}>
                <div className="shift-row is-done">
                  <span className="shift-row-main">
                    <span className="shift-row-title">{step.title}</span>
                  </span>
                  <button
                    className="btn btn-ghost"
                    disabled={!back.allowed}
                    title={back.reason}
                    onClick={() => setStepState(step.id, 'todo')}
                  >
                    Kumoa
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ----------------------------------------------------------- the loop back */

/**
 * Finishing a step is also the moment you need the next one, so the bar that
 * confirms the one says what it opened and offers it straight back. Rendered
 * by `App` above the tab strip rather than inside the scrolling column, so it
 * is reachable wherever the cook happens to be.
 */
function CompletionBar({
  stepId,
  onDismiss,
}: {
  stepId: string
  onDismiss: () => void
}) {
  const { index, state, setStepState, requestStart } = useStore()
  const step = index.steps.get(stepId)
  const opened = useMemo(() => justUnblocked(index, state, stepId), [index, state, stepId])
  const back = checkTransition(index, state, stepId, 'todo')

  // It stops being true the moment the step is no longer done — somebody
  // reopened it, or the menu was edited underneath.
  useEffect(() => {
    if (!step || statusOf(step, state) !== 'done') onDismiss()
  }, [step, state, onDismiss])

  if (!step) return null
  const next = opened[0]

  return (
    <div className="shift-toast" role="status">
      <div className="shift-toast-text">
        <strong>Valmis:</strong> {step.title}
        {next && (
          <>
            <br />
            <strong>Vapautui:</strong> {opened.map((s) => s.title).join(', ')}
          </>
        )}
      </div>
      <div className="shift-toast-actions">
        <button
          className="btn btn-ghost"
          disabled={!back.allowed}
          title={back.reason}
          onClick={() => {
            setStepState(stepId, 'todo')
            onDismiss()
          }}
        >
          Kumoa
        </button>
        {next && (
          <button
            className="btn btn-start"
            onClick={() => {
              requestStart(next.id)
              onDismiss()
            }}
          >
            <StartIcon /> Aloita se
          </button>
        )}
        <button className="btn btn-ghost icon" onClick={onDismiss} aria-label="Sulje">
          <Icon name="close" />
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ bits */

function StationTag({ station }: { station: Station }) {
  if (station === 'muu') return null
  return (
    <span className="shift-station">
      <Icon name={STATION_ICON[station]} /> {STATIONS.find((s) => s.id === station)?.label}
    </span>
  )
}

/**
 * The reason a step is being suggested, in words. `shift.ts` hands back which
 * bonus decided the position and leaves the wording here — a ranking a cook
 * cannot interrogate is a ranking a cook will not trust.
 */
function reasonLabel(reason: ShiftReason, menu: Menu): string {
  switch (reason.kind) {
    case 'continues':
      return `Jatkoa: ${menu.components.find((c) => c.id === reason.componentId)?.name ?? ''}`
    case 'assigned':
      return 'Sinun nimissäsi'
    case 'station':
      return `Sama piste: ${STATIONS.find((s) => s.id === reason.station)?.label}`
    case 'hold':
      return 'Voi tehdä etukäteen'
    case 'chain':
      return reason.opens === 0
        ? 'Ketjun pää'
        : reason.opens === 1
          ? 'Avaa yhden vaiheen'
          : `Avaa ${reason.opens} vaihetta`
  }
}
