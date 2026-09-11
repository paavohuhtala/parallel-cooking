import type { Station } from '../model/types.ts'
import { cx } from './cx.ts'
import ui from './ui.module.css'

/*
 * The icon table.
 *
 * Vendored path data rather than a dependency, for the same reason there is no
 * ORM and no nanoid: the whole table is a few KB of path data against a ~350 KB
 * bundle, while `lucide-react` would still leave two of the four stations
 * undrawn — it has no oven and no grill — and `@iconify/react` fetches over the
 * network at runtime, which is the wrong bet in a kitchen. The strings below
 * are the whole of it; there is nothing to build and nothing to update.
 *
 * Two shapes only. Phosphor and Material Design Icons draw an outline as one
 * *filled* path; Lucide strokes one or more paths on a 24 grid. Both are stored
 * as path data and rendered by the same component, so nothing here needs
 * `dangerouslySetInnerHTML`.
 *
 * Sized in `em`. Every call site already sized its emoji with `font-size`, and
 * an icon that scales with its text keeps working when a row, a chip and a
 * pill all want a different size — there is no `size` prop to thread through.
 *
 * Sources: Phosphor Icons (MIT), Material Design Icons (Apache-2.0), Lucide
 * (ISC). All three permit use without attribution in the UI.
 */

export type IconName =
  'liesi' | 'uuni' | 'grilli' | 'muu' | 'disclosure' | 'overflow' | 'add' |
  'subtract' | 'close' | 'undo' | 'redo' | 'hold' | 'dependency' | 'drag' |
  'check' | 'recipe' | 'graph' | 'board' | 'cooks' | 'shift' | 'share' | 'edit'

interface Glyph {
  /** Phosphor draws on 256, the others on 24. */
  box: number
  /** A filled outline — one path. */
  fill?: string
  /** A stroked outline — one or more paths, round caps, 2 units wide. */
  stroke?: readonly string[]
}

const GLYPHS: Record<IconName, Glyph> = {
  liesi: {
    // ph:cooking-pot
    box: 256,
    fill: 'M88 48V16a8 8 0 0 1 16 0v32a8 8 0 0 1-16 0m40 8a8 8 0 0 0 8-8V16a8 8 0 0 0-16 0v32a8 8 0 0 0 8 8m32 0a8 8 0 0 0 8-8V16a8 8 0 0 0-16 0v32a8 8 0 0 0 8 8m92.8 46.4L224 124v60a32 32 0 0 1-32 32H64a32 32 0 0 1-32-32v-60L3.2 102.4a8 8 0 0 1 9.6-12.8L32 104V80a8 8 0 0 1 8-8h176a8 8 0 0 1 8 8v24l19.2-14.4a8 8 0 0 1 9.6 12.8M208 88H48v96a16 16 0 0 0 16 16h128a16 16 0 0 0 16-16Z',
  },
  uuni: {
    // ph:oven
    box: 256,
    fill: 'M208 32H48a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16m0 176H48V48h160zM72 76a12 12 0 1 1 12 12a12 12 0 0 1-12-12m44 0a12 12 0 1 1 12 12a12 12 0 0 1-12-12m44 0a12 12 0 1 1 12 12a12 12 0 0 1-12-12m24 28H72a8 8 0 0 0-8 8v72a8 8 0 0 0 8 8h112a8 8 0 0 0 8-8v-72a8 8 0 0 0-8-8m-8 72H80v-56h96Z',
  },
  grilli: {
    // mdi:grill-outline
    box: 24,
    fill: 'M17 22a3 3 0 1 0-2.82-4H9.14l1.99-3.06a6.4 6.4 0 0 0 1.74 0l1.02 1.56c.42-.5.96-.94 1.61-1.2l-.61-.93A7 7 0 0 0 19 8H5a7 7 0 0 0 4.12 6.37l-3.95 6.08a1 1 0 0 0 1.67 1.09l1-1.54h6.34A3 3 0 0 0 17 22m0-4a1 1 0 0 1 1 1c0 .55-.45 1-1 1s-1-.45-1-1a1 1 0 0 1 1-1m-9.58-8h9.16a5 5 0 0 1-9.16 0m1.99-3h1c.15-1.15.23-1.64-.91-2.96c-.4-.5-.66-.77-.44-2.04h-.99a3.14 3.14 0 0 0 .89 2.96c.22.24.79.67.45 2.04m2.48 0h1c.15-1.15.23-1.64-.89-2.96c-.42-.5-.68-.78-.46-2.04h-.99a3.14 3.14 0 0 0 .89 2.96c.23.24.8.67.45 2.04m2.52 0h1c.15-1.15.23-1.64-.91-2.96c-.4-.5-.66-.77-.44-2.04h-.99a3.14 3.14 0 0 0 .89 2.96c.22.24.79.67.45 2.04',
  },
  muu: {
    // ph:knife
    box: 256,
    fill: 'M231.87 32.13a27.84 27.84 0 0 0-39.32 0L18.34 206.4a8 8 0 0 0 3.86 13.45A160.7 160.7 0 0 0 58.4 224c32.95 0 65.92-10.2 96.95-30.23c31.76-20.5 50.19-43.82 51-44.81a8 8 0 0 0-.64-10.59L185.32 118l46.55-46.56a27.85 27.85 0 0 0 0-39.31M189.1 144.44a220.4 220.4 0 0 1-42.86 36.16c-34.43 22.1-69.94 30.92-105.77 26.3L146 101.33Zm31.46-84.3L174 106.7L157.32 90l46.55-46.56a11.8 11.8 0 0 1 16.69 16.69Z',
  },
  disclosure: {
    // ph:caret-right
    box: 256,
    fill: 'm181.66 133.66l-80 80a8 8 0 0 1-11.32-11.32L164.69 128L90.34 53.66a8 8 0 0 1 11.32-11.32l80 80a8 8 0 0 1 0 11.32',
  },
  overflow: {
    // ph:dots-three-bold
    box: 256,
    fill: 'M144 128a16 16 0 1 1-16-16a16 16 0 0 1 16 16m-84-16a16 16 0 1 0 16 16a16 16 0 0 0-16-16m136 0a16 16 0 1 0 16 16a16 16 0 0 0-16-16',
  },
  add: {
    // ph:plus-bold
    box: 256,
    fill: 'M228 128a12 12 0 0 1-12 12h-76v76a12 12 0 0 1-24 0v-76H40a12 12 0 0 1 0-24h76V40a12 12 0 0 1 24 0v76h76a12 12 0 0 1 12 12',
  },
  subtract: {
    // ph:minus-bold
    box: 256,
    fill: 'M228 128a12 12 0 0 1-12 12H40a12 12 0 0 1 0-24h176a12 12 0 0 1 12 12',
  },
  close: {
    // ph:x-bold
    box: 256,
    fill: 'M208.49 191.51a12 12 0 0 1-17 17L128 145l-63.51 63.49a12 12 0 0 1-17-17L111 128L47.51 64.49a12 12 0 0 1 17-17L128 111l63.51-63.52a12 12 0 0 1 17 17L145 128Z',
  },
  undo: {
    // ph:arrow-counter-clockwise
    box: 256,
    fill: 'M224 128a96 96 0 0 1-94.71 96H128a95.38 95.38 0 0 1-65.9-26.2a8 8 0 0 1 11-11.63a80 80 0 1 0-1.67-114.78a3 3 0 0 1-.26.25L44.59 96H72a8 8 0 0 1 0 16H24a8 8 0 0 1-8-8V56a8 8 0 0 1 16 0v29.8L60.25 60A96 96 0 0 1 224 128',
  },
  redo: {
    // ph:arrow-clockwise
    box: 256,
    fill: 'M240 56v48a8 8 0 0 1-8 8h-48a8 8 0 0 1 0-16h27.4l-26.59-24.36l-.25-.24a80 80 0 1 0-1.67 114.78a8 8 0 0 1 11 11.63A95.44 95.44 0 0 1 128 224h-1.32a96 96 0 1 1 69.07-164L224 85.8V56a8 8 0 1 1 16 0',
  },
  hold: {
    // lucide:snowflake
    box: 24,
    stroke: [
      'm10 20l-1.25-2.5L6 18m4-14L8.75 6.5L6 6m8 14l1.25-2.5L18 18M14 4l1.25 2.5L18 6',
      'm17 21l-3-6h-4m7-12l-3 6l1.5 3M2 12h6.5L10 9m10 1l-1.5 2l1.5 2',
      'M22 12h-6.5L14 15M4 10l1.5 2L4 14m3 7l3-6l-1.5-3M7 3l3 6h4',
    ],
  },
  dependency: {
    // ph:tree-structure
    box: 256,
    fill: 'M160 112h48a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16h-48a16 16 0 0 0-16 16v16h-16a24 24 0 0 0-24 24v32H72v-8a16 16 0 0 0-16-16H24a16 16 0 0 0-16 16v32a16 16 0 0 0 16 16h32a16 16 0 0 0 16-16v-8h32v32a24 24 0 0 0 24 24h16v16a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16h-48a16 16 0 0 0-16 16v16h-16a8 8 0 0 1-8-8V88a8 8 0 0 1 8-8h16v16a16 16 0 0 0 16 16M56 144H24v-32h32zm104 16h48v48h-48Zm0-112h48v48h-48Z',
  },
  drag: {
    // lucide:grip-vertical
    box: 24,
    stroke: [
      'M8.0 12.0a1.0 1.0 0 1 0 2.0 0a1.0 1.0 0 1 0 -2.0 0',
      'M8.0 5.0a1.0 1.0 0 1 0 2.0 0a1.0 1.0 0 1 0 -2.0 0',
      'M8.0 19.0a1.0 1.0 0 1 0 2.0 0a1.0 1.0 0 1 0 -2.0 0',
      'M14.0 12.0a1.0 1.0 0 1 0 2.0 0a1.0 1.0 0 1 0 -2.0 0',
      'M14.0 5.0a1.0 1.0 0 1 0 2.0 0a1.0 1.0 0 1 0 -2.0 0',
      'M14.0 19.0a1.0 1.0 0 1 0 2.0 0a1.0 1.0 0 1 0 -2.0 0',
    ],
  },
  check: {
    // ph:check-bold
    box: 256,
    fill: 'm232.49 80.49l-128 128a12 12 0 0 1-17 0l-56-56a12 12 0 1 1 17-17L96 183L215.51 63.51a12 12 0 0 1 17 17Z',
  },
  recipe: {
    // ph:book-open
    box: 256,
    fill: 'M232 48h-72a40 40 0 0 0-32 16a40 40 0 0 0-32-16H24a8 8 0 0 0-8 8v144a8 8 0 0 0 8 8h72a24 24 0 0 1 24 24a8 8 0 0 0 16 0a24 24 0 0 1 24-24h72a8 8 0 0 0 8-8V56a8 8 0 0 0-8-8M96 192H32V64h64a24 24 0 0 1 24 24v112a39.8 39.8 0 0 0-24-8m128 0h-64a39.8 39.8 0 0 0-24 8V88a24 24 0 0 1 24-24h64Z',
  },
  graph: {
    // ph:graph
    box: 256,
    fill: 'M200 152a31.84 31.84 0 0 0-19.53 6.68l-23.11-18A31.65 31.65 0 0 0 160 128c0-.74 0-1.48-.08-2.21l13.23-4.41A32 32 0 1 0 168 104c0 .74 0 1.48.08 2.21l-13.23 4.41A32 32 0 0 0 128 96a32.6 32.6 0 0 0-5.27.44L115.89 81A32 32 0 1 0 96 88a32.6 32.6 0 0 0 5.27-.44l6.84 15.4a31.92 31.92 0 0 0-8.57 39.64l-25.71 22.84a32.06 32.06 0 1 0 10.63 12l25.71-22.84a31.91 31.91 0 0 0 37.36-1.24l23.11 18A31.65 31.65 0 0 0 168 184a32 32 0 1 0 32-32m0-64a16 16 0 1 1-16 16a16 16 0 0 1 16-16M80 56a16 16 0 1 1 16 16a16 16 0 0 1-16-16M56 208a16 16 0 1 1 16-16a16 16 0 0 1-16 16m56-80a16 16 0 1 1 16 16a16 16 0 0 1-16-16m88 72a16 16 0 1 1 16-16a16 16 0 0 1-16 16',
  },
  board: {
    // ph:kanban
    box: 256,
    fill: 'M216 48H40a8 8 0 0 0-8 8v152a16 16 0 0 0 16 16h40a16 16 0 0 0 16-16v-48h48v16a16 16 0 0 0 16 16h40a16 16 0 0 0 16-16V56a8 8 0 0 0-8-8M88 208H48v-80h40Zm0-96H48V64h40Zm64 32h-48V64h48Zm56 32h-40v-48h40Zm0-64h-40V64h40Z',
  },
  cooks: {
    // ph:users
    box: 256,
    fill: 'M117.25 157.92a60 60 0 1 0-66.5 0a95.83 95.83 0 0 0-47.22 37.71a8 8 0 1 0 13.4 8.74a80 80 0 0 1 134.14 0a8 8 0 0 0 13.4-8.74a95.83 95.83 0 0 0-47.22-37.71M40 108a44 44 0 1 1 44 44a44.05 44.05 0 0 1-44-44m210.14 98.7a8 8 0 0 1-11.07-2.33A79.83 79.83 0 0 0 172 168a8 8 0 0 1 0-16a44 44 0 1 0-16.34-84.87a8 8 0 1 1-5.94-14.85a60 60 0 0 1 55.53 105.64a95.83 95.83 0 0 1 47.22 37.71a8 8 0 0 1-2.33 11.07',
  },
  shift: {
    // lucide:user — one cook, where `cooks` is the whole roster.
    box: 24,
    stroke: [
      'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2',
      'M16 7a4 4 0 1 1-8 0a4 4 0 0 1 8 0',
    ],
  },
  share: {
    // ph:link
    box: 256,
    fill: 'M240 88.23a54.43 54.43 0 0 1-16 37L189.25 160a54.27 54.27 0 0 1-38.63 16h-.05A54.63 54.63 0 0 1 96 119.84a8 8 0 0 1 16 .45A38.62 38.62 0 0 0 150.58 160a38.4 38.4 0 0 0 27.31-11.31l34.75-34.75a38.63 38.63 0 0 0-54.63-54.63l-11 11A8 8 0 0 1 135.7 59l11-11a54.65 54.65 0 0 1 77.3 0a54.86 54.86 0 0 1 16 40.23m-131 97.43l-11 11A38.4 38.4 0 0 1 70.6 208a38.63 38.63 0 0 1-27.29-65.94L78 107.31a38.63 38.63 0 0 1 66 28.4a8 8 0 0 0 16 .45A54.86 54.86 0 0 0 144 96a54.65 54.65 0 0 0-77.27 0L32 130.75A54.62 54.62 0 0 0 70.56 224a54.28 54.28 0 0 0 38.64-16l11-11a8 8 0 0 0-11.2-11.34',
  },
  edit: {
    // ph:pencil-simple
    box: 256,
    fill: 'm227.31 73.37l-44.68-44.69a16 16 0 0 0-22.63 0L36.69 152A15.86 15.86 0 0 0 32 163.31V208a16 16 0 0 0 16 16h44.69a15.86 15.86 0 0 0 11.31-4.69L227.31 96a16 16 0 0 0 0-22.63M92.69 208H48v-44.69l88-88L180.69 120ZM192 108.68L147.31 64l24-24L216 84.68Z',
  },
}

/** Which glyph a cooking station wears, everywhere it is drawn. */
export const STATION_ICON: Record<Station, IconName> = {
  liesi: 'liesi',
  uuni: 'uuni',
  grilli: 'grilli',
  muu: 'muu',
}

/**
 * One icon, sized to the text around it.
 *
 * Decorative by default: every call site pairs it with a label or an
 * `aria-label` on the control, so announcing it again would be noise. Pass
 * `title` only where the icon genuinely stands alone.
 */
export function Icon({
  name,
  className,
  title,
}: {
  name: IconName
  className?: string
  title?: string
}) {
  const glyph = GLYPHS[name]
  return (
    <svg
      className={cx(ui.icon, className)}
      viewBox={`0 0 ${glyph.box} ${glyph.box}`}
      width="1em"
      height="1em"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {glyph.fill !== undefined ? (
        <path d={glyph.fill} fill="currentColor" />
      ) : (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {glyph.stroke!.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      )}
    </svg>
  )
}

/*
 * "Aloita" wears a composed mark rather than a plain triangle: a chef's hat
 * with the play badge tucked into its corner. It is the one icon in the app
 * that carries colour of its own — the hat is filled so it reads on any ground,
 * and the badge is the one green in the palette.
 *
 * Composed here instead of vendored because no set has it: two weights of
 * Phosphor's hat stacked (solid for the fill, outline over it for the edge),
 * then the badge drawn in the 256 grid the hat already uses.
 */
const CHEF_HAT_FILL = 'M240 112a56.06 56.06 0 0 0-56-56c-1.77 0-3.54.1-5.29.26a56 56 0 0 0-101.42 0C75.54 56.1 73.77 56 72 56a56 56 0 0 0-24 106.59V208a16 16 0 0 0 16 16h128a16 16 0 0 0 16-16v-45.41A56.09 56.09 0 0 0 240 112m-87.76 30.06l8-32a8 8 0 0 1 15.52 3.88l-8 32A8 8 0 0 1 160 152a8 8 0 0 1-1.95-.24a8 8 0 0 1-5.81-9.7M120 112a8 8 0 0 1 16 0v32a8 8 0 0 1-16 0Zm-33.94-7.76a8 8 0 0 1 9.7 5.82l8 32a8 8 0 0 1-5.82 9.7a8 8 0 0 1-2 .24a8 8 0 0 1-7.75-6.06l-8-32a8 8 0 0 1 5.87-9.7M192 208H64v-40.58a55.5 55.5 0 0 0 8 .58h112a55.5 55.5 0 0 0 8-.58Z'

const CHEF_HAT = 'M240 112a56.06 56.06 0 0 0-56-56c-1.77 0-3.54.1-5.29.26a56 56 0 0 0-101.42 0C75.54 56.1 73.77 56 72 56a56 56 0 0 0-24 106.59V208a16 16 0 0 0 16 16h128a16 16 0 0 0 16-16v-45.41A56.09 56.09 0 0 0 240 112m-48 96H64v-40.58a55.5 55.5 0 0 0 8 .58h112a55.5 55.5 0 0 0 8-.58Zm-8-56h-13.75l5.51-22.06a8 8 0 0 0-15.52-3.88L153.75 152H136v-24a8 8 0 0 0-16 0v24h-17.75l-6.49-25.94a8 8 0 1 0-15.52 3.88L85.75 152H72a40 40 0 0 1 0-80h.58a55 55 0 0 0-.58 8a8 8 0 0 0 16 0a40 40 0 0 1 80 0a8 8 0 0 0 16 0a55 55 0 0 0-.58-8h.58a40 40 0 0 1 0 80'

const PLAY = 'M240 128a15.74 15.74 0 0 1-7.6 13.51L88.32 229.65a16 16 0 0 1-16.2.3A15.86 15.86 0 0 1 64 216.13V39.87a15.86 15.86 0 0 1 8.12-13.82a16 16 0 0 1 16.2.3l144.08 88.14A15.74 15.74 0 0 1 240 128'

export function StartIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cx(ui.icon, className)}
      viewBox="0 0 256 256"
      width="1em"
      height="1em"
      aria-hidden
      focusable="false"
    >
      {/* The hat, lifted and shrunk to leave the badge a corner to sit in. */}
      <g transform="translate(-12 -20) scale(0.92)">
        <path d={CHEF_HAT_FILL} fill="var(--icon-hat, #fff)" />
        <path d={CHEF_HAT} fill="currentColor" />
      </g>
      {/* The badge, punched out of the hat so the two never merge into a blob. */}
      <circle cx="180" cy="180" r="76" fill="var(--surface, #fff)" />
      <circle cx="180" cy="180" r="60" fill="var(--icon-start, #3f9159)" />
      <g transform="translate(132 132) scale(0.375)">
        <path d={PLAY} fill="#fff" />
      </g>
    </svg>
  )
}
