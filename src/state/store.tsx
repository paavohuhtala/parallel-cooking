import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { MENU } from '../data/menu'
import type { Cook, KitchenState, Menu, StepState } from '../model/types'
import { buildIndex, checkTransition, recordOf, type GraphIndex } from './graph'

const STORAGE_KEY = 'parallel-cooking/v1'

export const COOK_COLORS = [
  '#e8743b',
  '#3b8ee8',
  '#48a463',
  '#a45cd0',
  '#d4a017',
  '#d0455f',
]

const DEFAULT_COOKS: Cook[] = [
  { id: 'cook-1', name: 'Kokki 1', color: COOK_COLORS[0] },
  { id: 'cook-2', name: 'Kokki 2', color: COOK_COLORS[1] },
]

const initialState = (): KitchenState => ({ cooks: DEFAULT_COOKS, steps: {} })

function load(): KitchenState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialState()
    const parsed = JSON.parse(raw) as Partial<KitchenState>
    if (!parsed || typeof parsed !== 'object') return initialState()
    return {
      cooks:
        Array.isArray(parsed.cooks) && parsed.cooks.length ? parsed.cooks : DEFAULT_COOKS,
      steps: parsed.steps && typeof parsed.steps === 'object' ? parsed.steps : {},
    }
  } catch {
    // Corrupt or unavailable storage should never keep the kitchen offline.
    return initialState()
  }
}

export interface Rejection {
  stepId: string
  reason: string
  at: number
}

interface Store {
  menu: Menu
  index: GraphIndex
  state: KitchenState
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
  addCook: () => void
  renameCook: (cookId: string, name: string) => void
  removeCook: (cookId: string) => void
  resetAll: () => void
}

const StoreContext = createContext<Store | null>(null)

/** Records a state change, keeping the timestamps consistent with it. */
function withState(
  prev: KitchenState,
  stepId: string,
  next: StepState,
  cookId?: string | null,
): KitchenState {
  const current = recordOf(prev, stepId)
  const now = Date.now()
  return {
    ...prev,
    steps: {
      ...prev.steps,
      [stepId]: {
        ...current,
        cookId: cookId === undefined ? current.cookId : cookId,
        state: next,
        startedAt:
          next === 'todo'
            ? undefined
            : next === 'active'
              ? (current.startedAt ?? now)
              : current.startedAt,
        completedAt: next === 'done' ? now : undefined,
      },
    },
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const menu = MENU
  const index = useMemo(() => buildIndex(menu), [menu])
  const [state, setState] = useState<KitchenState>(load)
  const [rejection, setRejection] = useState<Rejection | null>(null)
  const [pendingStart, setPendingStart] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Private mode / full quota: the session still works, it just won't
      // survive a reload.
    }
  }, [state])

  const setStepState = useCallback(
    (stepId: string, next: StepState) => {
      const check = checkTransition(index, state, stepId, next)
      if (!check.allowed) {
        setRejection({
          stepId,
          reason: check.reason ?? 'Ei onnistu juuri nyt.',
          at: Date.now(),
        })
        return false
      }
      setRejection(null)
      setState((prev) => withState(prev, stepId, next))
      return true
    },
    [index, state],
  )

  const confirmStart = useCallback((stepId: string, cookId: string | null) => {
    setPendingStart(null)
    setRejection(null)
    setState((prev) => withState(prev, stepId, 'active', cookId))
  }, [])

  const requestStart = useCallback(
    (stepId: string) => {
      const check = checkTransition(index, state, stepId, 'active')
      if (!check.allowed) {
        setRejection({
          stepId,
          reason: check.reason ?? 'Ei onnistu juuri nyt.',
          at: Date.now(),
        })
        return false
      }
      // Nothing to ask when the step already has a cook, or there is only one
      // person in the kitchen.
      const assigned = recordOf(state, stepId).cookId
      if (assigned) {
        confirmStart(stepId, assigned)
      } else if (state.cooks.length === 1) {
        confirmStart(stepId, state.cooks[0].id)
      } else {
        setRejection(null)
        setPendingStart(stepId)
      }
      return true
    },
    [index, state, confirmStart],
  )

  const assign = useCallback((stepId: string, cookId: string | null) => {
    setState((prev) => ({
      ...prev,
      steps: { ...prev.steps, [stepId]: { ...recordOf(prev, stepId), cookId } },
    }))
  }, [])

  const addCook = useCallback(() => {
    setState((prev) => ({
      ...prev,
      cooks: [
        ...prev.cooks,
        {
          id: `cook-${Date.now().toString(36)}`,
          name: `Kokki ${prev.cooks.length + 1}`,
          color: COOK_COLORS[prev.cooks.length % COOK_COLORS.length],
        },
      ],
    }))
  }, [])

  const renameCook = useCallback((cookId: string, name: string) => {
    setState((prev) => ({
      ...prev,
      cooks: prev.cooks.map((c) => (c.id === cookId ? { ...c, name } : c)),
    }))
  }, [])

  const removeCook = useCallback((cookId: string) => {
    setState((prev) => ({
      ...prev,
      cooks: prev.cooks.filter((c) => c.id !== cookId),
      steps: Object.fromEntries(
        Object.entries(prev.steps).map(([id, rec]) =>
          rec.cookId === cookId ? [id, { ...rec, cookId: null }] : [id, rec],
        ),
      ),
    }))
  }, [])

  const resetAll = useCallback(() => {
    setState((prev) => ({ ...prev, steps: {} }))
    setRejection(null)
    setPendingStart(null)
  }, [])

  const value: Store = {
    menu,
    index,
    state,
    rejection,
    dismissRejection: () => setRejection(null),
    pendingStart,
    requestStart,
    confirmStart,
    cancelStart: () => setPendingStart(null),
    setStepState,
    assign,
    addCook,
    renameCook,
    removeCook,
    resetAll,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside <StoreProvider>')
  return store
}
