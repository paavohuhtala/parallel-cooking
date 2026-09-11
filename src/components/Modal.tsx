import { createContext, useContext, type PointerEvent, type ReactNode } from 'react'
import { useDragControls, type DragControls, type Transition } from 'motion/react'
import * as m from 'motion/react-m'
import { Icon } from './icons.tsx'
import { FADE, useLeaving } from './motion.tsx'
import { SHEET_QUERY, useMediaQuery } from './useMediaQuery.ts'
import { cx } from './cx.ts'
import ui from './ui.module.css'

/*
 * Every dialog in the app: a backdrop that closes it, a panel that does not,
 * and the way both arrive and leave.
 *
 * Render it as the child — or inside the child — of an `AnimatePresence`, with
 * the condition outside it: `{open && <CooksModal key="cooks" />}`. Unmounting
 * is still what closes it, so a dialog's own state starts fresh every time it
 * opens, and the presence only holds it on screen for its way out — `inert`
 * meanwhile (`useLeaving`), since the panel is still under the pointer for a
 * moment and a second tap on a button that has done its job must land nowhere.
 */

type Variant = 'dialog' | 'sheet' | 'wide'

const PANEL_CLASS: Record<Variant, string> = {
  dialog: ui.modal,
  sheet: cx(ui.modal, ui.modalSheet),
  wide: cx(ui.modal, ui.modalWide),
}

/** Docked to the bottom edge, a sheet comes up from it and goes back down. */
const DOCKED = { y: '100%' }
/** Centred, a dialog settles into place from just below and slightly small. */
const FLOATING = { y: 8, scale: 0.97 }
const SLIDE: Transition = { type: 'spring', duration: 0.3, bounce: 0 }

/** How far, or how fast, a sheet has to be pulled down to let go of it. */
const DISMISS_PX = 80
const DISMISS_VELOCITY = 500

/** Set inside a docked sheet: what its head starts a drag with. */
const GrabContext = createContext<DragControls | null>(null)

export function Modal({
  label,
  variant = 'dialog',
  onClose,
  children,
}: {
  /** The dialog's accessible name. Usually its heading, but not always word for word. */
  label: string
  variant?: Variant
  onClose: () => void
  children: ReactNode
}) {
  const leaving = useLeaving()
  const narrow = useMediaQuery(SHEET_QUERY)
  // Only a sheet docks, and only where the stylesheet docks it.
  const docked = variant === 'sheet' && narrow
  const grab = useDragControls()

  return (
    <m.div
      className={ui.modalBackdrop}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={FADE}
      {...leaving}
    >
      <m.div
        className={PANEL_CLASS[variant]}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        initial={docked ? DOCKED : FLOATING}
        animate={{ y: 0, scale: 1 }}
        exit={docked ? DOCKED : FLOATING}
        transition={docked ? SLIDE : FADE}
        /*
         * A docked sheet follows a finger down and springs back if let go
         * early — the promise its handle makes. Only from the head: the rest of
         * the panel scrolls, and holds text fields a drag would steal from.
         */
        drag={docked ? 'y' : false}
        dragListener={false}
        dragControls={grab}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 1 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > DISMISS_PX || info.velocity.y > DISMISS_VELOCITY) onClose()
        }}
      >
        {docked && <div className={ui.sheetHandle} aria-hidden onPointerDown={(e) => grab.start(e)} />}
        <GrabContext.Provider value={docked ? grab : null}>{children}</GrabContext.Provider>
      </m.div>
    </m.div>
  )
}

/**
 * A dialog's heading and its close button. In a docked sheet it is also what a
 * finger pulls the sheet down by — the buttons in it excepted, so a tap on ✕
 * stays a tap.
 */
export function ModalHead({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  const grab = useContext(GrabContext)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!(e.target as Element).closest('button')) grab?.start(e)
  }
  return (
    <div
      className={cx(ui.modalHead, grab && ui.modalGrab)}
      onPointerDown={grab ? onPointerDown : undefined}
    >
      <h2>{title}</h2>
      <button className={cx(ui.btn, ui.btnGhost, ui.icon)} onClick={onClose} aria-label="Sulje">
        <Icon name="close" />
      </button>
    </div>
  )
}
