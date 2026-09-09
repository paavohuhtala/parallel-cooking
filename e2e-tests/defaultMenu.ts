/**
 * Names from the menu the suite creates its rooms with. The menu in
 * src/data/menu.ts is a living document, so tests name what they need here
 * instead of spreading Finnish step titles across the specs.
 *
 * Titles are matched as substrings, so a distinctive fragment is enough.
 */
export const STEP = {
  /** No dependencies: ready the moment a kitchen opens. */
  mushrooms: 'Puhdista ja hienonna kantarellit',
  onions: 'Kuori ja pilko sipuli',
  /** Depends on `mushrooms`, so it starts out blocked. */
  roast: 'Paahda sienet',
  oil: 'Tee valkosipuliöljy',
} as const

export const COMPONENT = {
  soup: 'Kantarellikeitto',
  bruschetta: 'Valkosipulibruschetta',
} as const

/** `DEFAULT_COOKS` in src/shared/apply.ts, plus what "Lisää kokki" names the next one. */
export const COOK = {
  first: 'Kokki 1',
  second: 'Kokki 2',
  third: 'Kokki 3',
} as const
