import type { CSSProperties } from 'react'
import type { GutterRow, LaneCell } from '../state/lanes.ts'
import { cx } from './cx.ts'
import styles from './DepGutter.module.css'

/*
 * One row's slice of the menu editor's dependency gutter. What goes where is
 * decided in `state/lanes.ts`; this only draws it.
 *
 * A slice is as tall as its row, which is only known to the browser — a title
 * wraps, a phone's rows are taller. So nothing here is placed against the row's
 * height. The node sits at `--node-y`, which the outline sets to the middle of
 * a title's first line; the curves live in a fixed box around it, and the
 * straight runs between them are borders pinned to the row's top or bottom
 * edge, which stretch with it for free.
 *
 * Decorative to assistive technology: every dependency it shows is listed in
 * words in the inspector's Edellyttää.
 */

/** Horizontal pitch of one lane, px. */
export const LANE_PX = 10
/** Half the curves' box; a node sits at its vertical middle. */
const HALF = 16
const PALETTE = 8

const ink = (color: number | null) =>
  color === null ? 'var(--muted)' : `var(--lane-${color % PALETTE})`

/** The straight parts of a line, by which edges of the row they run between. */
type Run = 'full' | 'toNode' | 'fromNode' | 'toCurve' | 'fromCurve'

export function GutterCell({
  row,
  columns,
  emphasis,
}: {
  row: GutterRow
  columns: number
  /** Lanes touching the selected step; the others step back while it is. */
  emphasis: ReadonlySet<number> | null
}) {
  const width = columns * LANE_PX
  // The trunk is the innermost column, next to the rows; lanes grow outwards.
  const x = (column: number) => width - (column + 0.5) * LANE_PX
  const xn = x(0)
  const trunk = ink(row.node?.color ?? null)
  const faded = (cell: LaneCell) => emphasis !== null && !emphasis.has(cell.lane)

  const runs: { key: string; run: Run; x: number; color: string; cell?: LaneCell }[] = []
  if (row.trunkIn) runs.push({ key: 'in', run: 'toNode', x: xn, color: trunk })
  if (row.trunkOut) runs.push({ key: 'out', run: 'fromNode', x: xn, color: trunk })
  for (const cell of row.cells) {
    const run: Run = cell.above && cell.below ? 'full' : cell.above ? 'toCurve' : 'fromCurve'
    runs.push({ key: `l${cell.lane}`, run, x: x(cell.column), color: ink(cell.color), cell })
  }

  const branches = row.cells.filter((c) => c.branch !== null)
  const hasBox = row.node !== null || row.marker !== null

  return (
    <span
      className={styles.cell}
      style={{ width }}
      aria-hidden
      data-testid="dep-gutter"
      data-trunk={[row.trunkIn && 'in', row.trunkOut && 'out'].filter(Boolean).join(' ') || undefined}
      data-branches={branches.length}
    >
      {runs.map(({ key, run, x, color, cell }) => (
        <span
          key={key}
          className={cx(
            styles.run,
            styles[run],
            cell?.up && styles.isUp,
            cell && faded(cell) && styles.isFaded,
          )}
          style={{ left: x - 1, '--ink': color } as CSSProperties}
        />
      ))}
      {hasBox && (
        <svg className={styles.box} width={width} height={HALF * 2}>
          {branches.map((cell) => {
            const xc = x(cell.column)
            const d =
              cell.branch === 'above'
                ? `M ${xc} 0 C ${xc} ${HALF / 2}, ${xn} ${HALF / 2}, ${xn} ${HALF}`
                : `M ${xn} ${HALF} C ${xn} ${HALF * 1.5}, ${xc} ${HALF * 1.5}, ${xc} ${HALF * 2}`
            return (
              <path
                key={cell.lane}
                d={d}
                className={cx(styles.curve, cell.up && styles.isUp, faded(cell) && styles.isFaded)}
                style={{ stroke: ink(cell.color) }}
              />
            )
          })}
          {row.node &&
            (row.node.group ? (
              <circle className={styles.group} cx={xn} cy={HALF} r={4} style={{ stroke: trunk }} />
            ) : (
              <circle className={styles.node} cx={xn} cy={HALF} r={4} style={{ fill: trunk }} />
            ))}
          {/* An open dish wears the ring it has when collapsed, only with
              nothing attached: its steps carry the lines now. */}
          {row.marker !== null && (
            <circle
              className={styles.group}
              cx={xn}
              cy={HALF}
              r={4}
              style={{ stroke: ink(row.marker) }}
            />
          )}
        </svg>
      )}
    </span>
  )
}
