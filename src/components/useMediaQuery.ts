import { useCallback, useSyncExternalStore } from 'react'

/**
 * Where a side panel stops being a column and becomes a sheet over the page —
 * the editor's inspector, the kitchen's step details, and the dialogs that dock
 * to the bottom edge. Must match the `900px` media queries in the stylesheets.
 */
export const SHEET_QUERY = '(max-width: 900px)'

/**
 * CSS decides how something looks at a width, but not what it *is*: a dialog's
 * role, `inert` behind it, the Escape key, whether it can be pulled down — those
 * are the script's, so the script has to know which side of a breakpoint it is on.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}
