/*
 * Legible text on a colour that is data rather than design.
 *
 * A cook's colour is assigned from `COOK_COLORS` when the cook is added and
 * then stored with the room, so the stylesheet cannot choose the text for it,
 * and changing the palette never reaches a cook that already exists. White
 * initials on those fills measured 2.4–4.5:1. This picks whichever of two inks
 * reads better on the colour it is given — what CSS `contrast-color()` does,
 * where a browser has it.
 *
 * DOM-free, so the palette's contrast is a unit test.
 */

/** The dark theme's page colour: near-black, and warm like everything else. */
export const DARK_INK = '#16150f'
export const LIGHT_INK = '#ffffff'

function channels(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const ca = channels(a)
  const cb = channels(b)
  if (!ca || !cb) return 1
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The ink that reads better on `background`. White if it cannot be parsed. */
export function inkOn(background: string): string {
  if (!channels(background)) return LIGHT_INK
  return contrastRatio(DARK_INK, background) > contrastRatio(LIGHT_INK, background)
    ? DARK_INK
    : LIGHT_INK
}

/** A filled badge in `color`, with text that can be read on it. */
export const badgeColors = (color: string) => ({ background: color, color: inkOn(color) })
