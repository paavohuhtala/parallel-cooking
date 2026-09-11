import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react'
import { STATIONS, type StepStatus } from '../model/types'
import { Icon, STATION_ICON } from '../components/icons.tsx'
import { badgeColors } from '../components/ink.ts'
import { recordOf, statusMap, statusOf } from '../state/graph'
import { buildChains, chainStatus } from '../state/chains'
import { layoutGraph, NODE_W, type LayoutInput } from '../state/layout'
import { useStore } from '../state/store'
import { STATUS_LABEL } from '../components/StepControls'
import { cx } from '../components/cx.ts'
import ui from '../components/ui.module.css'
import styles from './GraphView.module.css'

const DOT_CLASS: Record<StepStatus, string> = {
  blocked: ui.statusBlocked,
  ready: ui.statusReady,
  active: ui.statusActive,
  done: ui.statusDone,
}

const NODE_CLASS: Record<StepStatus, string> = {
  blocked: styles.statusBlocked,
  ready: styles.statusReady,
  active: styles.statusActive,
  done: styles.statusDone,
}

const MIN_FIT = 0.5
const MIN_SCALE = 0.35
const MAX_SCALE = 2.2

/** Single-step cards keep the old two-line look; chains grow a row per step. */
const SINGLE_H = 66
const CHAIN_KICKER_H = 15
const CHAIN_ROW_H = 22
const CHAIN_PAD_Y = 9

const cardHeight = (steps: number) =>
  steps === 1 ? SINGLE_H : CHAIN_PAD_Y * 2 + CHAIN_KICKER_H + steps * CHAIN_ROW_H

interface Viewport {
  x: number
  y: number
  scale: number
}

/**
 * Zoom by `factor` around the canvas point (cx, cy), which stays put under the
 * cursor. The group transform is `translate(x y) scale(s)`, so a graph point
 * lands at `p * s + (x, y)`; pinning one screen point across the scale change
 * gives the new offset. Deriving the ratio from the clamped scale rather than
 * from `factor` keeps the view still once it hits a zoom limit.
 */
function zoomAbout(v: Viewport, factor: number, cx: number, cy: number): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
  const ratio = scale / v.scale
  return { scale, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio }
}

export function GraphView({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (id: string) => void
}) {
  const { menu, index, state } = useStore()
  const [merge, setMerge] = useState(true)
  const [showCritical, setShowCritical] = useState(true)

  const chainIndex = useMemo(
    () => buildChains(index, merge),
    [index, merge],
  )
  const statuses = useMemo(() => statusMap(menu, state), [menu, state])

  const layout = useMemo(() => {
    const input: LayoutInput[] = chainIndex.chains.map((c) => ({
      id: c.id,
      deps: c.deps,
      height: cardHeight(c.stepIds.length),
    }))
    const componentOrder = new Map(menu.components.map((c, i) => [c.id, i]))
    const groupOf = new Map(
      chainIndex.chains.map((c) => [c.id, componentOrder.get(c.componentId) ?? 0]),
    )
    return layoutGraph(input, groupOf)
  }, [chainIndex, menu])

  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  /** Once the cook has panned or zoomed, stop moving the view under them. */
  const touched = useRef(false)

  /**
   * Scale the graph down until it fits the canvas and centre it — but never
   * below MIN_FIT, past which the labels stop being readable and panning is
   * the better answer.
   */
  const fit = useCallback(() => {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box?.width || !box.height) return
    const scale = Math.max(
      MIN_FIT,
      Math.min(1, (box.width - 24) / layout.width, (box.height - 24) / layout.height),
    )
    touched.current = false
    setView({
      scale,
      x: Math.max(12, (box.width - layout.width * scale) / 2),
      y: Math.max(12, (box.height - layout.height * scale) / 2),
    })
  }, [layout])

  // Fit on mount and whenever the canvas resizes (the detail panel opening, a
  // window resize) — unless the cook has taken the view over.
  useLayoutEffect(() => {
    fit()
    const el = svgRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (!touched.current) fit()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [fit])

  // Cards directly connected to the selection, so the rest can fade back.
  const neighbours = useMemo(() => {
    if (!selected) return null
    const home = chainIndex.chainOf.get(selected)
    if (!home) return null
    const set = new Set<string>([home])
    for (const d of chainIndex.byId.get(home)?.deps ?? []) set.add(d)
    for (const chain of chainIndex.chains) {
      if (chain.deps.includes(home)) set.add(chain.id)
    }
    return set
  }, [selected, chainIndex])

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    touched.current = true
    setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }))
  }
  const endDrag = () => {
    drag.current = null
  }

  /** Zoom from the toolbar buttons, which have no cursor to aim at. */
  const zoomFromCentre = (factor: number) => {
    const box = svgRef.current?.getBoundingClientRect()
    touched.current = true
    setView((v) => zoomAbout(v, factor, (box?.width ?? 0) / 2, (box?.height ?? 0) / 2))
  }

  // The wheel handler has to be a native, non-passive listener: React registers
  // `onWheel` passively at the root, so `preventDefault` there is ignored and
  // the workspace scrolls out from under the zoom.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: globalThis.WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      touched.current = true
      setView((v) =>
        zoomAbout(v, e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - box.left, e.clientY - box.top),
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const merged = chainIndex.chains.filter((c) => c.stepIds.length > 1).length

  return (
    <div className={styles.graph} data-testid="graph">
      <div className={styles.graphToolbar}>
        <button className={cx(ui.btn, ui.btnGhost)} onClick={fit}>
          Sovita näkymään
        </button>
        <button
          className={cx(ui.btn, ui.btnGhost)}
          onClick={() => zoomFromCentre(1.15)}
        >
          <Icon name="add" />
        </button>
        <button
          className={cx(ui.btn, ui.btnGhost)}
          onClick={() => zoomFromCentre(1 / 1.15)}
        >
          <Icon name="subtract" />
        </button>
        <label className={ui.toggle}>
          <input
            type="checkbox"
            checked={merge}
            onChange={(e) => setMerge(e.target.checked)}
          />
          Yhdistä peräkkäiset vaiheet
        </label>
        <label className={ui.toggle}>
          <input
            type="checkbox"
            checked={showCritical}
            onChange={(e) => setShowCritical(e.target.checked)}
          />
          Korosta kriittinen polku
        </label>
        <span className={cx(ui.muted, ui.small)}>
          {merge && merged > 0
            ? `${chainIndex.chains.length} korttia, ${menu.steps.length} vaihetta`
            : `${menu.steps.length} vaihetta`}
        </span>
      </div>

      <svg
        ref={svgRef}
        className={styles.graphCanvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {layout.edges.map((edge) => {
            const critical =
              showCritical &&
              chainIndex.byId.get(edge.from)!.stepIds.some((s) => index.criticalPath.has(s)) &&
              chainIndex.byId.get(edge.to)!.stepIds.some((s) => index.criticalPath.has(s))
            const satisfied = chainIndex.byId
              .get(edge.from)!
              .stepIds.every((s) => recordOf(state, s).state === 'done')
            const dim = neighbours ? !(neighbours.has(edge.from) && neighbours.has(edge.to)) : false
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={edge.path}
                className={cx(
                  styles.edge,
                  critical && styles.isCritical,
                  satisfied && styles.isSatisfied,
                  dim && styles.isDim,
                )}
              />
            )
          })}

          {layout.nodes.map((node) => {
            const chain = chainIndex.byId.get(node.id)!
            const status = chainStatus(chain, statuses)
            const critical =
              showCritical && chain.stepIds.some((s) => index.criticalPath.has(s))
            const dim = neighbours ? !neighbours.has(node.id) : false
            const holdsSelection = selected ? chain.stepIds.includes(selected) : false

            return (
              <g
                key={node.id}
                transform={`translate(${node.x} ${node.y})`}
                className={cx(
                  styles.node,
                  NODE_CLASS[status],
                  critical && styles.isCritical,
                  holdsSelection && styles.isSelected,
                  dim && styles.isDim,
                )}
              >
                <rect width={NODE_W} height={node.height} rx={10} className={styles.nodeBox} />
                <rect width={5} height={node.height} rx={2.5} className={styles.nodeStripe} />
                <foreignObject
                  x={12}
                  y={chain.stepIds.length === 1 ? 7 : CHAIN_PAD_Y}
                  width={NODE_W - 24}
                  height={node.height - (chain.stepIds.length === 1 ? 14 : CHAIN_PAD_Y * 2)}
                >
                  {chain.stepIds.length === 1 ? (
                    <SingleCard stepId={chain.id} onSelect={onSelect} />
                  ) : (
                    <ChainCard chain={chain} selected={selected} onSelect={onSelect} />
                  )}
                </foreignObject>
              </g>
            )
          })}
        </g>
      </svg>

      <div className={styles.graphLegend}>
        {(['blocked', 'ready', 'active', 'done'] as const).map((s) => (
          <span key={s} className={styles.legendItem}>
            <span className={cx(ui.dot, DOT_CLASS[s])} />
            {STATUS_LABEL[s].toLowerCase()}
          </span>
        ))}
        <span className={styles.legendItem}>
          <span className={styles.legendLine} /> kriittinen polku
        </span>
      </div>
    </div>
  )
}

function SingleCard({
  stepId,
  onSelect,
}: {
  stepId: string
  onSelect: (id: string) => void
}) {
  const { index, state } = useStore()
  const step = index.steps.get(stepId)!
  const cook = state.cooks.find((c) => c.id === recordOf(state, stepId).cookId)
  const station = STATIONS.find((s) => s.id === step.station)

  return (
    <div className={styles.nodeBody} onClick={() => onSelect(stepId)}>
      <div className={styles.nodeTitle}>{step.title}</div>
      {(step.station !== 'muu' || cook) && (
        <div className={styles.nodeFacts}>
          {step.station !== 'muu' && (
            <>
              <Icon name={STATION_ICON[step.station]} /> {station?.label}
            </>
          )}
          {cook ? (
            <span style={{ color: cook.color }}>
              {step.station !== 'muu' ? ' · ' : ''}
              {cook.name}
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}

/**
 * A run of steps that can only ever be done in order, drawn as one card so the
 * graph shows the shape of the *parallelisable* work rather than a long train
 * of single nodes. Each row is still its own step, and clicking one opens it.
 */
function ChainCard({
  chain,
  selected,
  onSelect,
}: {
  chain: { stepIds: string[]; componentId: string }
  selected: string | null
  onSelect: (id: string) => void
}) {
  const { menu, index, state } = useStore()
  const component = menu.components.find((c) => c.id === chain.componentId)

  // When every step in the run happens at the same station, say so once in the
  // heading instead of repeating the icon on each cramped row.
  const stations = new Set(chain.stepIds.map((id) => index.steps.get(id)!.station))
  const shared = stations.size === 1 && !stations.has('muu') ? [...stations][0] : null


  return (
    <div className={cx(styles.nodeBody, styles.nodeChain)}>
      <div className={styles.nodeKicker}>
        {shared && <Icon name={STATION_ICON[shared]} />} {component?.name} ·{' '}
        {chain.stepIds.length} vaihetta
      </div>
      {chain.stepIds.map((id, i) => {
        const step = index.steps.get(id)!
        const status = statusOf(step, state)
        const cook = state.cooks.find((c) => c.id === recordOf(state, id).cookId)
        return (
          <div
            key={id}
            className={cx(styles.nodeStep, NODE_CLASS[status], selected === id && styles.isSelected)}
            title={step.title}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(id)
            }}
          >
            <span className={styles.nodeStepIndex}>{i + 1}</span>
            <span className={cx(ui.dot, styles.stepDot, DOT_CLASS[status])} />
            <span className={styles.nodeStepTitle}>
              {!shared && step.station !== 'muu' && <Icon name={STATION_ICON[step.station]} />}{' '}
              {step.title}
            </span>
            {cook && (
              <span className={styles.nodeStepCook} style={badgeColors(cook.color)}>
                {cook.name.trim().charAt(0).toUpperCase() || '?'}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
