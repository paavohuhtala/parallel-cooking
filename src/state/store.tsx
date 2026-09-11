import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { KitchenState, Menu, StepState } from '../model/types.ts'
import { checkTransition, recordOf, type GraphIndex } from './graph.ts'
import { sessionFor, type Connection, type Rejection } from './session.ts'
import ui from '../components/ui.module.css'

export { COOK_COLORS } from '../shared/apply.ts'
export type { Rejection } from './session.ts'

/** Which cook you are, per room and per browser. Never leaves this device. */
const meKey = (roomId: string) => `parallel-cooking/me/${roomId}`

interface Store {
  room: { id: string; name: string }
  menu: Menu
  /** The menu's own version; the editor sends it back as `expectedVersion`. */
  menuVersion: number
  index: GraphIndex
  state: KitchenState
  connection: Connection
  /** Cooks with somebody connected as them right now. */
  presence: ReadonlySet<string>
  /** The cook using this browser, if they have said. */
  me: string | null
  setMe: (cookId: string | null) => void
  rejection: Rejection | null
  dismissRejection: () => void
  /** Step id whose "who is taking this?" prompt is open, if any. */
  pendingStart: string | null
  /**
   * Start a step, asking who is taking it first unless that is already
   * settled. Returns false if starting isn't legal at all.
   */
  requestStart: (stepId: string) => boolean
  confirmStart: (stepId: string, cookId: string | null) => void
  cancelStart: () => void
  /** Returns false (and records a rejection) when the move is not legal. */
  setStepState: (stepId: string, next: StepState) => boolean
  assign: (stepId: string, cookId: string | null) => void
  /** Adds a cook and returns their id, so a caller can claim them at once. */
  addCook: () => string
  renameCook: (cookId: string, name: string) => void
  removeCook: (cookId: string) => void
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ roomId, children }: { roomId: string; children: ReactNode }) {
  const session = useMemo(() => sessionFor(roomId), [roomId])
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)

  const [pendingStart, setPendingStart] = useState<string | null>(null)
  const [me, setMeState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(meKey(roomId))
    } catch {
      return null
    }
  })

  const setMe = useCallback(
    (cookId: string | null) => {
      setMeState(cookId)
      try {
        if (cookId) localStorage.setItem(meKey(roomId), cookId)
        else localStorage.removeItem(meKey(roomId))
      } catch {
        // Private mode: you just get asked who you are more often.
      }
    },
    [roomId],
  )

  // Telling the room who is here is the other half of `me`: local until it is
  // announced, and announced again by the session after every reconnect.
  useEffect(() => session.claim(me), [session, me])

  const setStepState = useCallback(
    (stepId: string, next: StepState) => session.send({ type: 'set_step_state', stepId, next }),
    [session],
  )

  const confirmStart = useCallback(
    (stepId: string, cookId: string | null) => {
      setPendingStart(null)
      session.send({ type: 'set_step_state', stepId, next: 'active', cookId })
    },
    [session],
  )

  const requestStart = useCallback(
    (stepId: string) => {
      const index = session.currentIndex()
      if (!index) return false
      const state = session.current()
      const check = checkTransition(index, state, stepId, 'active')
      if (!check.allowed) {
        session.reject(stepId, check.reason ?? 'Ei onnistu juuri nyt.')
        return false
      }
      // Nothing to ask when the step already has a cook, when you have said who
      // you are, or when there is only one person in the kitchen.
      const assigned = recordOf(state, stepId).cookId
      const mine = me && state.cooks.some((c) => c.id === me) ? me : null
      if (assigned) confirmStart(stepId, assigned)
      else if (mine) confirmStart(stepId, mine)
      else if (state.cooks.length === 1) confirmStart(stepId, state.cooks[0].id)
      else setPendingStart(stepId)
      return true
    },
    [session, confirmStart, me],
  )

  const assign = useCallback(
    (stepId: string, cookId: string | null) => {
      session.send({ type: 'assign', stepId, cookId })
    },
    [session],
  )

  const addCook = useCallback(() => {
    const cookId = crypto.randomUUID()
    session.send({ type: 'add_cook', cookId })
    return cookId
  }, [session])

  const renameCook = useCallback(
    (cookId: string, name: string) => {
      session.send({ type: 'rename_cook', cookId, name })
    },
    [session],
  )

  const removeCook = useCallback(
    (cookId: string) => {
      if (cookId === me) setMe(null)
      session.send({ type: 'remove_cook', cookId })
    },
    [session, me, setMe],
  )

  const cancelStart = useCallback(() => setPendingStart(null), [])

  const { room, menu, index } = snapshot
  const value = useMemo<Store | null>(() => {
    if (!room || !menu || !index) return null
    return {
      room,
      menu,
      index,
      menuVersion: snapshot.menuVersion,
      state: snapshot.state,
      connection: snapshot.connection,
      presence: snapshot.presence,
      me,
      setMe,
      rejection: snapshot.rejection,
      dismissRejection: session.dismissRejection,
      pendingStart,
      requestStart,
      confirmStart,
      cancelStart,
      setStepState,
      assign,
      addCook,
      renameCook,
      removeCook,
    }
  }, [
    room, menu, index, snapshot.menuVersion, snapshot.state, snapshot.connection,
    snapshot.presence,
    snapshot.rejection,
    me, setMe, session, pendingStart, requestStart, confirmStart, cancelStart,
    setStepState, assign, addCook, renameCook, removeCook,
  ])

  if (snapshot.fatal) {
    return (
      <div className={ui.splash}>
        <h1>Keittiötä ei löytynyt</h1>
        <p>{snapshot.fatal}</p>
        <a className={ui.btn} href="/">
          Takaisin alkuun
        </a>
      </div>
    )
  }

  // Everything downstream — every view, every component — assumes the menu is
  // there. Gating here is what keeps that true and leaves those files alone.
  if (!value) {
    return (
      <div className={ui.splash}>
        <div className={ui.spinner} aria-hidden />
        <p>Yhdistetään keittiöön…</p>
      </div>
    )
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside <StoreProvider>')
  return store
}
