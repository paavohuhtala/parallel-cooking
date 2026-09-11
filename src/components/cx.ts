/**
 * Join class names, dropping anything falsy.
 *
 * A component's classes come from two or three stylesheets now — its own
 * module, [ui.module.css](ui.module.css), and a conditional state class — and
 * a template literal with `''` branches in it reads worse the more of them
 * there are.
 */
export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ')
