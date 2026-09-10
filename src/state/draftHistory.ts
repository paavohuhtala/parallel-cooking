import type { Menu } from '../model/types.ts'
import { applyDraftAction, type MenuAction } from './menuDraft.ts'

/*
 * Undo for the menu editor.
 *
 * `applyDraftAction` is pure and hands back a whole new `Menu`, so undo is just
 * the menus it replaced, kept in a list. There is no inverse per action and
 * nothing to keep in sync — the same property that lets the kitchen's own
 * `applyCommand` roll a rejection back by recomputing.
 *
 * Two rules make the stack usable rather than merely correct:
 *
 *  - **A run of keystrokes in one field is one step.** Every character typed in
 *    a title is a `rename` action, so without coalescing, undoing a mistyped
 *    dish name means forty presses. Consecutive actions that carry the same
 *    `groupOf` key extend the entry already on the stack instead of adding one.
 *  - **Structure is never coalesced.** Inserting, deleting, moving and merging
 *    all return `null` from `groupOf`, so each is its own step even in a run —
 *    those are the ones you actually reach for undo to reverse.
 *
 * Kept out of the component so all of that is a unit test rather than
 * something to check by clicking.
 */

/** Entries kept. Past this, the oldest is dropped rather than the newest refused. */
export const HISTORY_LIMIT = 50

export interface DraftHistory {
  menu: Menu
  /** Older menus, newest last. `past[past.length - 1]` is what undo restores. */
  past: Menu[]
  /** Undone menus, soonest first. */
  future: Menu[]
  /**
   * The coalescing group the newest `past` entry was opened by, or `null` when
   * the last change was structural. Only ever compared, never shown.
   */
  group: string | null
}

export type HistoryAction =
  | { type: 'apply'; action: MenuAction }
  | { type: 'undo' }
  | { type: 'redo' }
  /**
   * A save: the draft becomes the canonical document the server stored. The
   * stack survives it, so a save is not a wall you cannot undo past — but it
   * does close any run of keystrokes, because the next one starts from a
   * document that has been normalised.
   */
  | { type: 'replace'; menu: Menu }

export interface HistoryResult {
  state: DraftHistory
  /** The row that should hold the cursor, as an `OutlineRow.key`. */
  focus: string | null
}

export const initialHistory = (menu: Menu): DraftHistory => ({
  menu,
  past: [],
  future: [],
  group: null,
})

export const canUndo = (history: DraftHistory): boolean => history.past.length > 0
export const canRedo = (history: DraftHistory): boolean => history.future.length > 0

/**
 * Which run of typing an action belongs to, or `null` if it is not typing.
 *
 * Keyed by the field, not just the action, so tabbing from one title to the
 * next and carrying on starts a new undo step — the run is "this text, in this
 * place", which is what a person means by "what I just typed".
 */
function groupOf(action: MenuAction): string | null {
  switch (action.type) {
    case 'rename_menu':
      return 'rename_menu'
    case 'rename':
      return `rename:${action.kind}:${action.id}`
    case 'set_note':
      return `note:${action.kind}:${action.id}`
    case 'set_detail':
      return `detail:${action.id}`
    default:
      return null
  }
}

const capped = (past: Menu[]): Menu[] =>
  past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past

export function applyHistory(history: DraftHistory, action: HistoryAction): HistoryResult {
  switch (action.type) {
    case 'apply': {
      const result = applyDraftAction(history.menu, action.action)
      // An action that changed nothing — a rename to the same string, a move
      // past the end of a list — must not cost an undo step.
      if (result.menu === history.menu) return { state: history, focus: result.focus }

      const group = groupOf(action.action)
      const continues = group !== null && group === history.group && history.past.length > 0
      return {
        state: {
          menu: result.menu,
          past: continues ? history.past : capped([...history.past, history.menu]),
          // Anything new abandons the redo branch, as every editor does.
          future: [],
          group,
        },
        focus: result.focus,
      }
    }

    case 'undo': {
      const previous = history.past[history.past.length - 1]
      if (previous === undefined) return { state: history, focus: null }
      return {
        state: {
          menu: previous,
          past: history.past.slice(0, -1),
          future: [history.menu, ...history.future],
          group: null,
        },
        focus: null,
      }
    }

    case 'redo': {
      const [next, ...rest] = history.future
      if (next === undefined) return { state: history, focus: null }
      return {
        state: {
          menu: next,
          past: capped([...history.past, history.menu]),
          future: rest,
          group: null,
        },
        focus: null,
      }
    }

    case 'replace':
      return { state: { ...history, menu: action.menu, group: null }, focus: null }
  }
}
