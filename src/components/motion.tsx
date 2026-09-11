import { useEffect, useState, type ReactNode } from 'react'
import { LazyMotion, MotionConfig, useIsPresent, useReducedMotionConfig, type Transition } from 'motion/react'
import { useAnimate } from 'motion/react-mini'
import * as m from 'motion/react-m'
import type { Rejection } from '../state/store.tsx'

/*
 * Motion, on this app's terms.
 *
 * Motion is here for one problem more than any other: in a kitchen several
 * people share, things change without you seeing them change. Another cook's
 * tap, an optimistic move the server turned down, a finished step opening two
 * more — each arrives as a new snapshot and the page re-renders into a new
 * arrangement. Animating *that* is the point; hover states and colour fades
 * stay in CSS.
 *
 * Only `m.*` components, never `motion.*`: the provider below is `strict`, so a
 * `motion.div` throws instead of silently pulling every feature into the main
 * chunk. The features themselves load after the first render.
 */

const loadFeatures = () => import('./motionFeatures.ts').then((mod) => mod.default)

/**
 * `reducedMotion="user"` turns transform and layout animations off for anyone
 * who asked their OS for less motion, and keeps the opacity and height fades —
 * which carry the meaning without the movement.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  )
}

/**
 * What an element inside an `AnimatePresence` puts on while it is leaving. It
 * is still in the DOM for the length of its exit, so it goes `inert` — nothing
 * can press a button that has already done its job — and says so with
 * `data-leaving`, which is how a test that wants *the* hero card tells it from
 * the one fading out beside it.
 */
export function useLeaving(): { inert: boolean; 'data-leaving'?: '' } {
  return useIsPresent() ? { inert: false } : { inert: true, 'data-leaving': '' }
}

/** Something that moved getting to where it is now. Quick, with no bounce to wait out. */
export const MOVE: Transition = { type: 'spring', duration: 0.35, bounce: 0.08 }

/** Something appearing or leaving. */
export const FADE: Transition = { duration: 0.18, ease: 'easeOut' }

/**
 * A block that opens to its height when it appears and closes to nothing when
 * it goes, so what is below it slides rather than jumps. Put it directly inside
 * an `AnimatePresence`.
 *
 * Clipped only while its height is changing: a child can then still be seen
 * arriving from somewhere else (a `layoutId`), and a focus ring is not cut off.
 * `appear={false}` skips the opening, for a block whose arrival is shown some
 * other way.
 */
export function Collapse({
  appear = true,
  className,
  children,
}: {
  appear?: boolean
  className?: string
  children: ReactNode
}) {
  const leaving = useLeaving()
  const [settled, setSettled] = useState(!appear)
  return (
    <m.div
      className={className}
      initial={appear ? { height: 0, opacity: 0 } : false}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={FADE}
      onAnimationComplete={() => setSettled(true)}
      style={{ overflow: settled && !leaving.inert ? 'visible' : 'hidden' }}
      {...leaving}
    >
      {children}
    </m.div>
  )
}

/** A rejection older than this happened before the view looking at it existed. */
const NUDGE_FRESH_MS = 1_000

/**
 * Points at the step a rejection is about. The banner names it, but on a board
 * of forty cards a name is a search; a card that shakes its head is not.
 *
 * Every view marks the element standing for a step with `data-step-id`, so this
 * runs once, at the root, and reaches whichever view is showing. It animates
 * the CSS `translate` property rather than `transform`: that is the one a
 * layout animation writes, and a card rolling back to its column has to be
 * able to shake on the way. Motion's WAAPI-only `mini` build is enough for
 * that, and it keeps the full animation engine in the lazily loaded chunk.
 */
export function useRejectionNudge<T extends Element>(rejection: Rejection | null) {
  const [scope, animate] = useAnimate<T>()
  const reduced = useReducedMotionConfig()

  useEffect(() => {
    if (!rejection?.stepId || reduced || Date.now() - rejection.at > NUDGE_FRESH_MS) return
    const targets = scope.current?.querySelectorAll(
      `[data-step-id="${CSS.escape(rejection.stepId)}"]`,
    )
    if (!targets?.length) return
    animate(
      targets,
      { translate: ['0px', '-6px', '6px', '-4px', '3px', '0px'] },
      { duration: 0.4, ease: 'easeInOut' },
    )
  }, [rejection, reduced, scope, animate])

  return scope
}
