# Menu editor: UX and visual audit

A measured audit of [`src/components/MenuEditor.tsx`](../src/components/MenuEditor.tsx) and the
reducer behind it, [`src/state/menuDraft.ts`](../src/state/menuDraft.ts). 34 findings.

**Method.** `pnpm build`, then the real server on a library menu of 3 courses, 9 dishes and 66
steps, opened at 1440 px, 820 px and 390 px in light and dark. Hit areas, computed colours and
truncation counts were read out of the live document (`getBoundingClientRect`, `scrollWidth`,
`getComputedStyle`) rather than estimated; every number below is one of those measurements.
Destructive paths were triggered to see what they actually do.

| Severity | Count |
| --- | --- |
| Blocker | 5 |
| Major | 12 |
| Minor | 11 |
| Polish | 6 |

## What already works

- **The three layout rules hold up.** One glyph, one meaning; details never inline; a tail row at
  the end of every list. The outline genuinely does not reflow while you edit a step, and there is
  never a second toggle competing with the first.
- **Auto-chaining is the right default.** Type a dish top to bottom and the dependency graph comes
  out correct without touching a dependency, and `onDefaultChain` means a hand-edited step is never
  silently re-linked.
- **Illegal links are not offered.** `dependencyCandidates` filters out everything downstream, so a
  cycle cannot be proposed and then refused.
- **Deleting heals the chain.** `spliceOut` hands a removed step's dependencies to whatever waited
  on it, instead of splitting a dish in two.
- **Explicit save is correct here** — a half-typed menu is routinely invalid and every save
  broadcasts to a live kitchen — and the sessionStorage mirror plus `beforeunload` means the choice
  costs nothing.
- **The structural rules are a pure reducer**, so most of the fixes below can be written test-first
  in `menuDraft.test.ts` rather than clicked.

## A · Saving and status

### A1 — Major · The success banner contradicts the dirty flag

`note` is only cleared by the next save attempt, so the moment you type again the page carries two
contradictory statuses: a green "Tallennettu." banner under a header reading "Tallentamattomia
muutoksia". Reproduced by saving, then typing one character.

**Fix.** Clear `note` inside `dispatch` — any edit invalidates it — and give the banner the dismiss
button `.banner > button` is already styled for. A 4-second auto-dismiss on the success case would
do as well.

### A2 — Major · No `Ctrl/Cmd+S`

The editor is otherwise keyboard-first — Enter, Shift+Enter, Alt+arrows — and then the one shortcut
every user of every editor tries does nothing. Verified: pressing it leaves the draft dirty.

**Fix.** A `keydown` listener on the editor root guarded by `e.metaKey || e.ctrlKey`, calling the
same `onSave`. It must fire while a row input has focus, so bind on the container and
`preventDefault`. While there: `Escape` should close the inspector sheet and return focus to the row.

### A3 — Minor · The disabled save button is unreadable, and never says why

`.btn:disabled` applies `opacity: .38` to a solid `--ready` fill with white text. Composited against
the page that is a **1.68:1** label — the word "Tallenna" cannot be read at rest. Disabled controls
are exempt from contrast rules, but this is the primary action and it spends most of its life
disabled. It also carries two very different meanings with one appearance: "nothing to save" and
"the menu has errors and will not save".

**Fix.** Give `.btn-primary:disabled` its own quiet state — surface fill, muted text, visible border
— instead of a faded solid. When `blocking.length > 0`, point `aria-describedby` at the problem list
and put the reason in a `title`.

### A4 — Polish · The dirty label sits in the button row and reads as another button

"Tallentamattomia muutoksia" is a 0.78 rem muted string wedged between three ghost buttons and the
primary one, at the same optical weight as its neighbours.

**Fix.** Either a status dot before the label so it reads as state rather than an action, or fold it
into the button itself — "Tallenna · 4 muutosta" — and drop the separate label.

## B · Destructive edits

The largest gap in the editor. One keystroke destroys a course; nothing brings it back.

### B1 — Blocker · Backspace on an emptied course title deletes the course and everything under it

`Backspace` on an empty field calls `delete_row`, and for a course that means `deleteRow` drops
every dish and every step it holds. Nothing checks whether the row has children. Measured on the
fixture: selecting a course name, deleting it, and pressing Backspace once removed **1 course and 22
steps** with no confirmation.

This is not an exotic path — renaming a course by select-all-and-retype leaves the field empty for
exactly as long as it takes to hit Backspace once too often.

**Fix.** Let Backspace-to-delete apply only when the row has no children — that is the behaviour
every outliner has, and it is one predicate in `Row.onKeyDown`. A parent then has to go through
`⋯ → Poista`, which is where the confirmation in B3 belongs.

### B2 — Blocker · There is no undo

Not for a delete, not for a reorder, not for a merge that appended the wrong recipe. `Ctrl+Z` inside
a row input undoes typing, which makes the absence worse: undo appears to work until the moment you
need it.

The architecture is already set up for this. `applyDraftAction` is pure and returns a whole new
immutable `Menu`; the draft is a single state value.

**Fix.** Keep `past` and `future` arrays capped at ~50 entries, push in `dispatch`, and coalesce
consecutive `rename` actions on the same row so typing a title is one undo step rather than forty.
Bind `Cmd/Ctrl+Z` and `Shift+Cmd/Ctrl+Z` at the editor root, and let the row inputs keep their
native undo when they have focus and the last action was a rename of that row.

### B3 — Major · "Poista" never says what it takes with it

The row menu's delete item is the same one word on a step and on a course holding three dishes and
twenty-two steps. The collapsed-row summary already computes exactly the counts that are missing
here — "3 osaa · 22 vaihetta" — but the delete action does not use them.

**Fix.** Label the item with its blast radius: "Poista ruokalaji (3 osaa, 22 vaihetta)". With undo
in place (B2) that is enough; without undo, a confirmation for parents with children is the minimum.

### B4 — Minor · An empty title is never a problem

`validateMenu` warns that a dish has no steps, but says nothing about a course, dish or step with an
empty name. Enter creates blank rows freely, and a menu of nothing but *nimetön* saves cleanly and
reaches the kitchen that way. Confirmed directly against the validator.

**Fix.** Add an `empty_title` warning per row, with the `target` the problem list already uses to
jump focus.

## C · The outline row

### C1 — Blocker · The row's `⋯` is stranded at the far edge, and its menu opens detached from the row it acts on

`.outline-title` is `flex: 1 1 auto`, so the input grows to fill the column and pushes the action
button to the right margin. On a 1440 px screen that is roughly **700 px** between a step's text and
its own menu; on the 820 px tablet layout it is still ~600 px. The popup then opens over the rows
below, with nothing marking which row it belongs to — and opening it does not select the row, so the
inspector goes on showing something else entirely.

**Fix.** Stop letting the input own the column. Either cap it
(`flex: 0 1 auto; width: min(100%, 48ch)`) so the button follows the text, or keep the full-width
field and give the row a visible selected state plus `onSelect` on menu open. The first is better: a
title is a short string and a 950 px field for it is dead space at every width.

### C2 — Major · The `muu` station glyph is invisible — and it is the only way into a step's details by touch

A step at the default station shows `·` in `--border` on `--bg`: **1.26:1** in light, **1.48:1** in
dark. WCAG's floor for a control is 3:1. Most steps in a real menu are `muu`, so most rows look like
they have nothing in the left slot at all — while that slot is the affordance that opens the
inspector.

The reasoning behind it is right: the unremarkable default should not shout. But "quiet" and
"invisible" are different settings, and this is the second one.

**Fix.** Take the resting colour to `--muted` (5.1:1) and let the *shape* carry the quietness: a
hollow ring or a small knife outline reads as "no station assigned" without needing to be faint.

### C3 — Minor · Two of the four station icons are the same red-orange blob at row size

`♨️` (uuni) and `🔥` (grilli) are both small warm-coloured masses at 15 px and are not separable at a
glance. The glyph exists so a menu can be scanned for what is competing for the stove; two of four
stations defeat that. Emoji also render differently per platform.

**Fix.** Four inline SVGs with clearly different silhouettes — a pan, a box, a grate, a knife —
tinted from the existing token palette. Monochrome also lets the glyph sit at `--muted` weight when
the row isn't hovered, which C2 wants anyway.

### C4 — Major · The outline says nothing about dependencies or hold points

Auto-chaining is the editor's cleverest idea and it is completely invisible. A step whose dependency
was inferred and a step whose dependency was hand-authored look identical, so you cannot see the
structure you are editing, and you cannot see that editing one dependency opts that step out of
relinking forever. Steps marked *"voi tehdä etukäteen"* — the ones that decide whether dinner is
possible — are equally unmarked.

**Fix.** A hairline rail in the gutter joining a run of default-chained steps, broken where someone
has forked or joined by hand; a small marker on steps with more than one dependency; and a
hold-point mark (`--hold` already exists) on the rows that carry one. None of them cost a row of
height.

### C5 — Polish · 37 px per row means a dish never fits on screen with its course

Measured row height is 37.4 px with a 2 px gap; the 66-step fixture is ~2 600 px tall, and a
1440×900 window shows 19 rows. Restructuring work needs more than 19 rows at a time.

**Fix.** Trimming `.outline-title` padding to `0.22rem 0.5rem` and the gap to 0 gets ~28 px per row
and ~25 rows visible without making the text smaller. A density toggle would be better still, since
a phone wants the loose setting.

### C6 — Minor · The keyboard legend is below the fold on every real menu

`.editor-hint` sits after the outline, which on the fixture puts it 2 600 px down. The whole
Enter / Shift+Enter / Alt+arrow contract is undiscoverable in practice.

**Fix.** Move it next to the outline's heading, or make it a `?` popover in the header that also
lists the shortcuts added in A2 and B2.

## D · The inspector

### D1 — Major · The same chip means "toggle" in one panel and "delete" in another

In a step's *Tarvitaan* a chip toggles whether the step uses an ingredient. In the dish's *Ainekset*
an identical chip **removes the ingredient from the dish**, and removal also strips it from every
step that used it. Same shape, same size, same border; one is reversible in a click and the other
quietly rewrites other rows. The dependency chips get this right — they carry a `✕`.

**Fix.** Give the destructive chip the `✕` the dependency chips already use, and let a click on the
chip body do nothing. Better still, split *Tarvitaan* into "used here" and "available in this dish",
so a 10-ingredient dish stops giving every step a 10-chip wall.

### D2 — Major · The dependency picker is a bare `<select>` over every step in the menu

On the fixture that is a 65-option flat list of "Osa — Vaihe" strings in an 11 rem control, in
document order, with no grouping and no search. Choosing a cross-course dependency — the interesting
case, the one auto-chaining cannot do for you — means scrolling a native dropdown reading truncated
labels.

**Fix.** `<optgroup>` per course/dish is a five-line change and fixes most of it. A filtered combobox
is the right end state, and `dependencyCandidates` already produces the legal set to filter.

### D3 — Minor · An auto-chained dependency looks exactly like an authored one

*Edellyttää* renders the same solid chip either way, so nothing tells you that this link was
inferred, or that removing and re-adding it permanently opts the step out of relinking when you
reorder around it. That rule — `onDefaultChain` — has real consequences and no surface at all.

**Fix.** Render the inferred link as a ghost chip labelled "automaattinen", and say once, under the
field, that editing dependencies here pins them.

### D4 — Polish · Selecting a course gives you a 21 rem panel with one text field in it

A course's inspector is *Huomio* and nothing else, which makes selecting a course feel like a
mistake.

**Fix.** Add what the level actually owns: its counts, its stations at a glance, and the
reorder/delete actions currently hidden in the row's `⋯`. Same applies to a dish.

### D5 — Polish · With nothing selected the inspector is a bordered empty card

One muted sentence floating in a panel that is otherwise blank, occupying a fifth of the screen from
the moment the editor opens — which is also the state a first-time user sees.

**Fix.** Use it for the menu itself: name, counts, the longest dependency chain, station load.
`state/chains.ts` already computes the chain data, and "which chain decides when food reaches the
table" is the question the whole app is built to answer.

## E · Mobile

The layout adapts; the controls do not. At 390 px a quarter of the outline is unreadable.

### E1 — Blocker · Row titles clip mid-glyph, with no ellipsis

At 390 px, **17 of 69 rows** overflow their input — including every course name in the fixture. An
`<input>` cannot ellipsize or wrap, so the text is cut through a letter with no signal that anything
is missing. "Alkupala: kantarellikeitto ja valkosipulibruschetta" reads as "Alkupala:
kantarellikeitto ja valk".

**Fix.** Render a row at rest as text — free to wrap to two lines, or to ellipsize — and swap in the
input on tap or focus. That keeps every keyboard behaviour intact and is the single biggest
readability win available on a phone. Cheaper interim: a `textarea` with `rows=1` and auto-grow.

### E2 — Blocker · Every control on a row is below the minimum touch target

Measured at 390 px:

| Control | Size |
| --- | --- |
| `⋯` row menu | **27.9 × 21.5 px** |
| Disclosure triangle, station glyph | **24 × 24 px** |
| Tail rows (*+ Vaihe*) | **34.9 px** tall |

WCAG 2.2's AA floor is 24 px and the `⋯` misses it outright; the AAA target and both platform
guidelines are 44. The `⋯` is also the only route to reorder and delete on touch — the row menu
exists *because* `Alt+↑/↓` has no thumb equivalent — so it is the most important target on the row
and the smallest.

**Fix.** Under `@media (pointer: coarse)`, give the row a 44 px min-height and expand each glyph's
hit area with a pseudo-element, so the target grows without the icon growing. Same for the tail rows.

### E3 — Major · The inspector sheet has no scrim, no tap-outside, no Escape and no focus trap

The kitchen's own detail panel already does this properly — `.detail-backdrop` dims the page at the
same 900 px breakpoint. The editor's sheet does not, so the outline stays fully live underneath: a
tap that misses the sheet lands on a row behind it and silently changes what the sheet is editing,
or opens the software keyboard on a field you cannot see. Dismissal is a single 24 px `✕`.

**Fix.** Reuse the existing backdrop: same element, same z-index pattern, click to close. Add
`role="dialog" aria-modal="true"` below 900 px only — on a desktop it is a column and correctly not
a dialog — plus Escape and a drag handle.

### E4 — Major · The header wraps to three rows and pushes the save button off screen

At 390 px, *Tuo ja yhdistä*, *Kopioi LLM-kehote* and *Vie JSON* — three actions used once per menu,
if ever — take a full row above the two that matter, and the whole block eats ~200 px before the
first course appears. Nothing is sticky, so scrolling to step 40 leaves you with no way to save but
scrolling back.

**Fix.** Collapse the three ghost actions into one `⋯` overflow below 900 px, and make
`.editor-head` `position: sticky; top: 0` with the page background.

### E5 — Minor · The software keyboard covers the sheet you are typing in

The sheet is `position: fixed; inset: auto 0 0 0`. On iOS Safari the keyboard does not resize fixed
elements, so editing *Ohje* puts the caret behind the keyboard on a smaller phone.

**Fix.** Add `interactive-widget=resizes-content` to the viewport meta, and pad the sheet by
`env(keyboard-inset-height, 0px)` where supported.

### E6 — Minor · There is no "insert below" for a thumb

The tail rows append to the end of a list, which is the right primitive, but on touch there is no
way to put a step *between* two others: you append, then use *Siirrä ylös* once per position. The
reducer already has the action — `insert_after` — it just isn't exposed anywhere but Enter.

**Fix.** Add "Lisää alle" to the row menu, next to "Lisää vaihe". One menu item, no new reducer code.

## F · Keyboard and assistive tech

### F1 — Major · 227 tab stops for a 69-row menu

Every row contributes a title input plus a `⋯` button, and every list contributes a tail button —
counted in the page: **227** focusable elements. A tree is meant to be one tab stop with arrow-key
navigation inside it.

**Fix.** Roving `tabindex`: the selected row's input is `tabindex=0`, every other focusable in the
outline is `-1`. `↑/↓` already move between rows, so only the tab order needs fixing.

### F2 — Major · `role="tree"` with plain `<button>` children

The tail rows are direct children of the `role="tree"` container, which is invalid — a tree may only
contain `treeitem` and `group`. There are no `group` wrappers either, so the hierarchy rests
entirely on `aria-level`, and `aria-selected` is set on elements that are not themselves focusable
as tree items. A screen reader is being told a structure the DOM does not implement.

**Fix.** Two honest options. Implement the tree properly — `group` wrappers, roving focus on the
`treeitem`, tails as `treeitem` too. Or drop to `role="list"` / `listitem` with `aria-level`, which
is what the widget actually behaves like today.

### F3 — Minor · No key opens a step's details

The inspector is reachable by clicking the station glyph or by `⋯ → Tiedot` — both pointer gestures.
In an editor whose whole pitch is keyboard-first, the second half of every step has no keyboard
route in.

**Fix.** `→` on a step row opens the inspector and moves focus into it; `←` or Escape returns. On a
parent row `→` expands and `←` collapses, which is the standard tree binding and is missing too.

### F4 — Minor · Focus indicators are removed and replaced with a 1 px border colour change

`.outline-title:focus`, `.dep-picker:focus` and `.ingredient-add:focus` all set `outline: none` and
signal focus by recolouring a hairline border. On the dashed adders the border also changes style,
so the difference is easy to miss entirely.

**Fix.** Keep the border treatment for resting/hover and add a real `:focus-visible` outline — 2 px,
`outline-offset: 1px`, in `--ready`. There is currently no `:focus-visible` rule anywhere in the
stylesheet.

### F5 — Minor · Nothing announces saving, or the problem count

The error banner is `role="alert"`; the success banner, the busy state and the validation list are
silent. A screen-reader user pressing save gets no confirmation, and the count of blocking errors —
the reason the button is disabled — is never announced when it changes.

**Fix.** `aria-live="polite"` on the note banner and the problem list's heading, and `aria-busy` on
the button while saving.

## G · Visual polish

### G1 — Polish · In dark mode the outline sits directly on the page background

Rows have no surface of their own, so two thirds of the editor is an unbroken `#16150f` field with
text floating in it, while the inspector card sits on `--surface` and reads as the only real object
on screen. Light mode gets away with it; dark does not.

**Fix.** Put the outline on `--surface` with the same radius and border as the inspector. A hairline
alone would be enough.

### G2 — Polish · No indent guides

Depth is carried by 1.1 rem / 2.2 rem margins and a font-weight step, and below 640 px that halves
to 0.6 / 1.2 rem. Combined with the loose row rhythm (C5), a step at the bottom of a long dish is
hard to attribute to its parent.

**Fix.** A 1 px guide per level, brightened for the ancestors of the selected row. It also gives the
chain rail proposed in C4 a column to live in.

### G3 — Polish · The selected row is a 9% tint and does not read

`.is-selected` is `color-mix(in srgb, var(--ready) 9%, transparent)` — invisible at a glance in
either theme. The selected row is the anchor for everything the inspector shows, and on a phone it
is hidden behind the sheet entirely.

**Fix.** Raise the tint and add a 2 px `--ready` edge on the leading side.

### G4 — Polish · Two dead ends in the problem and confirmation flow

The problem list caps at six with "… ja N muuta" as plain text — the remaining problems cannot be
reached at all, though each has a `target` that would jump straight to it. And the progress-at-risk
confirmation is a native `confirm()` listing up to eight step titles: the one moment the editor
leaves its own design language, and the one dialog that cannot be styled, themed or reliably tested.

**Fix.** Make the overflow a disclosure that expands the full list. Replace `confirm()` with the
modal the app already has — `.modal-backdrop` and `.modal` are in the stylesheet and
`MenuImportDialog` is the pattern.

## Suggested order

Sequenced by what unblocks what, not by severity. The first two change how safe every later change
is to make.

1. **Make edits reversible** — B2, B1, B3. Everything below becomes cheaper to try once a mistake
   costs one keystroke.
2. **Fix the row's geometry** — C1. One CSS change and one handler; fixes desktop and tablet at once.
3. **Make the phone outline readable** — E1, E2, E3, E4.
4. **Make state truthful** — A1, A2, A3, B4.
5. **Make the glyphs do their job** — C2, C3, C4.
6. **Then the inspector and the tree semantics** — D1, D2, F1, F2.
