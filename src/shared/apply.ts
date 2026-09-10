import type { Cook, KitchenState, StepState } from '../model/types.ts'
import { checkTransition, recordOf, type GraphIndex } from '../state/graph.ts'
import type { Envelope } from './protocol.ts'

/**
 * Every entry must carry a badge initial at 4.5:1 with one of the two inks the
 * client chooses between (`components/ink.ts`, which tests this). The purple
 * and the red were darkened a step for that — from #a45cd0 and #d0455f, which
 * reached only 4.4:1 either way; cooks stored with those keep them.
 */
export const COOK_COLORS = [
  '#e8743b',
  '#3b8ee8',
  '#48a463',
  '#9755bf',
  '#d4a017',
  '#c6425a',
]

export const DEFAULT_COOKS: Cook[] = [
  { id: 'cook-1', name: 'Kokki 1', color: COOK_COLORS[0] },
  { id: 'cook-2', name: 'Kokki 2', color: COOK_COLORS[1] },
]

export const initialState = (): KitchenState => ({ cooks: DEFAULT_COOKS, steps: {} })

export type ApplyResult =
  | { ok: true; state: KitchenState }
  | { ok: false; reason: string; stepId?: string }

const ok = (state: KitchenState): ApplyResult => ({ ok: true, state })
const no = (reason: string, stepId?: string): ApplyResult => ({ ok: false, reason, stepId })

/** Records a state change, keeping the timestamps consistent with it. */
function withState(
  prev: KitchenState,
  stepId: string,
  next: StepState,
  at: number,
  cookId?: string | null,
): KitchenState {
  const current = recordOf(prev, stepId)
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
              ? (current.startedAt ?? at)
              : current.startedAt,
        completedAt: next === 'done' ? at : undefined,
      },
    },
  }
}

/**
 * The single writer. Runs unchanged on the client (optimistically, against the
 * pending queue) and on the server (authoritatively), which is the only reason
 * an optimistic update can be rolled back by replaying rather than by a
 * hand-written inverse per mutation.
 *
 * Pure: every non-deterministic input arrives in `env`.
 */
export function applyCommand(
  index: GraphIndex,
  state: KitchenState,
  env: Envelope,
): ApplyResult {
  const { cmd, at } = env
  const cookById = (id: string) => state.cooks.find((c) => c.id === id)

  switch (cmd.type) {
    case 'set_step_state': {
      if (!index.steps.get(cmd.stepId)) return no('Tuntematon vaihe.', cmd.stepId)
      if (cmd.cookId != null && !cookById(cmd.cookId)) return no('Tuntematon kokki.')

      const current = recordOf(state, cmd.stepId)

      // Two cooks tapping "Aloita" at the same time: the first claim stands.
      // `checkTransition` waves this through (it allows same-state moves), so
      // the rule lives here.
      if (
        cmd.next === 'active' &&
        current.state === 'active' &&
        current.cookId !== null &&
        cmd.cookId !== undefined &&
        cmd.cookId !== current.cookId
      ) {
        const holder = cookById(current.cookId)
        return no(`${holder?.name ?? 'Joku muu'} aloitti tämän jo.`, cmd.stepId)
      }

      const check = checkTransition(index, state, cmd.stepId, cmd.next)
      if (!check.allowed) return no(check.reason ?? 'Ei onnistu juuri nyt.', cmd.stepId)

      return ok(withState(state, cmd.stepId, cmd.next, at, cmd.cookId))
    }

    case 'assign': {
      if (!index.steps.get(cmd.stepId)) return no('Tuntematon vaihe.', cmd.stepId)
      if (cmd.cookId !== null && !cookById(cmd.cookId)) return no('Tuntematon kokki.')
      return ok({
        ...state,
        steps: {
          ...state.steps,
          [cmd.stepId]: { ...recordOf(state, cmd.stepId), cookId: cmd.cookId },
        },
      })
    }

    case 'add_cook': {
      // Idempotent, so a replayed envelope after a reconnect adds nobody twice.
      if (cookById(cmd.cookId)) return ok(state)
      return ok({
        ...state,
        cooks: [
          ...state.cooks,
          {
            id: cmd.cookId,
            name: `Kokki ${state.cooks.length + 1}`,
            color: COOK_COLORS[state.cooks.length % COOK_COLORS.length],
          },
        ],
      })
    }

    case 'rename_cook': {
      // A rename racing a removal is a no-op rather than an error.
      if (!cookById(cmd.cookId)) return ok(state)
      return ok({
        ...state,
        cooks: state.cooks.map((c) => (c.id === cmd.cookId ? { ...c, name: cmd.name } : c)),
      })
    }

    case 'remove_cook': {
      if (!cookById(cmd.cookId)) return ok(state)
      if (state.cooks.length <= 1) return no('Keittiössä pitää olla ainakin yksi kokki.')
      return ok({
        ...state,
        cooks: state.cooks.filter((c) => c.id !== cmd.cookId),
        steps: Object.fromEntries(
          Object.entries(state.steps).map(([id, rec]) =>
            rec.cookId === cmd.cookId ? [id, { ...rec, cookId: null }] : [id, rec],
          ),
        ),
      })
    }
  }
}
