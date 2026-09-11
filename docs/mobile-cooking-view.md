# Oma vuoro — a cooking view for one cook on one phone

**Built.** `Oma vuoro` ships as the fourth view; this document is what it was built from,
amended where the building taught us something. What changed on contact is marked *in the
event*.

A design for the missing fourth view. The board, the recipe and the graph all answer *what is
the state of the kitchen*; none of them answers *what do I do next, and how*. On a laptop
propped against the wall that distinction does not matter, because the whole board fits. On a
390 px phone held in one flour-covered hand it is the only thing that matters.

## The problem, specifically

[`KanbanView`](../src/views/KanbanView.tsx) is four columns wide by construction, and
`.board` is laid out to be scrolled sideways. At 390 px that means:

- **Four columns, one screen.** Two of them — `blocked` and `done` — are history and
  homework, and they take half the horizontal budget. The column a cook actually acts in
  (`ready`) is off-screen more often than not.
- **Drag and drop is the only way to move a card between columns**, and the thing you are
  dragging across is a horizontally scrolling container. `StepControls` is on the card too,
  so the moves exist — but the toolbar hint still says *"Raahaa kortti sarakkeesta toiseen"*,
  which on a phone is a lie.
- **The chrome eats the screen before the content starts.** `.topbar` wraps to three rows at
  that width (brand, tabs, four action buttons), then the progress bar, then `.upnext`. Against
  `height: 100dvh` and `overflow: hidden` on `.app`, roughly 40 % of the viewport is gone before
  the first card.
- **Nothing is about *you*.** Grouping by cook exists, but it is a board-wide regrouping, not a
  personal lane — and it still renders every other cook's lanes underneath.

The board is not broken. It is a *situation display*, and a situation display wants a big
screen. The fix is not to squeeze it; it is to add the view that a phone actually wants.

## The shape of the answer

A fourth view, **`Oma vuoro`**, beside Resepti / Graafi / Keittiötaulu. One scrolling column,
three zones, in the order a cook needs them:

```
┌──────────────────────────────┐
│  Illallinen          ●  ⋯    │  compact bar: room, connection, overflow
│  ▓▓▓▓▓▓▓░░░░░░░  12/23       │
├──────────────────────────────┤
│  TYÖN ALLA                   │  ① what I am doing, and how
│  ┌────────────────────────┐  │
│  │ Kantarellikeitto       │  │
│  │ Kuullota sipulit    🍲 │  │
│  │ 6 min · aloitit 18:42  │  │
│  │ ────────────────────── │  │
│  │ Kuullota hienonnettu   │  │
│  │ sipuli voissa, kunnes  │  │
│  │ pehmeää muttei ruskeaa │  │
│  │ • 2 salottisipulia     │  │
│  │ • 30 g voita           │  │
│  │ ┌────────────────────┐ │  │
│  │ │      ✓ Valmis      │ │  │  48 px, thumb-height
│  │ └────────────────────┘ │  │
│  └────────────────────────┘  │
├──────────────────────────────┤
│  OTA SEURAAVA                │  ② the picker
│  ┌────────────────────────┐  │
│  │ Jatkoa: Kantarellikeitto│ │  ← why this one
│  │ Lisää kantarellit    🍲 │  │
│  │ ┌────────────────────┐ │  │
│  │ │      Aloita        │ │  │
│  │ └────────────────────┘ │  │
│  └────────────────────────┘  │
│  [Liesi][Uuni][Grilli][Muu]  │  filters
│  Kaikki vapaat (7)      ⌄    │
├──────────────────────────────┤
│  ODOTTAA MUITA (3)      ⌄    │  ③ nudge material, collapsed
├──────────────────────────────┤
│   📖      ⚙      ▦      👤   │  fixed bottom tabs
└──────────────────────────────┘
```

**It is a view, not a route.** `/r/<id>` stays the one link that means "this kitchen" — that
property is in the first paragraph of [CLAUDE.md](../CLAUDE.md) and is worth more than a
tidier URL. The view tab is already local-only state in `App.tsx`; this adds a fourth value
to it and nothing else.

**It is not phone-only.** A cook with a laptop on the counter wants the same focused list. The
only thing the viewport decides is the *default*: `useState` initialises to `shift` when
`matchMedia('(max-width: 640px)')` matches at mount, and never again — narrowing a desktop
window must not yank the view out from under someone mid-task.

**At desktop width it is a capped column** — `max-width: 620px`, the treatment `.landing`
already gets in [`landing.module.css`](../src/components/landing.module.css) — **with
`StepDetail` as its second column.** That pairing is the desktop layout, and it costs
nothing: above 900 px the panel is already a real column rather than a sheet, so opening a
step puts the queue on the left and its instructions on the right. The tempting alternative
— two columns *of the view itself*, *Työn alla* beside *Ota seuraava* — is declined: it is a
second layout to maintain for a view whose entire argument is that it does one thing in one
column, and it would break the reading order that makes the column work.

*In the event:* the first version centred the column in the scroller, so opening a step slid
the whole queue 170 px sideways as the panel took its width (measured: `left` 410 → 240 at
1440 px). The queue reserves `--detail-width` instead, whether or not the panel is open, and
an e2e test asserts `left` and `width` are unchanged across the transition. This is the rule
the editor already follows for its outline, one section up in [CLAUDE.md](../CLAUDE.md);
a queue is no more allowed to jump than an outline is.

*Also in the event:* `Seuraavaksi` is hidden in this view at every width, not only on a phone.
It is the recipe view's quick jump list and stays that; beside zone ② it is a second, worse
ranking of the same steps.

Everything else this adds to a desktop is a fourth entry in the tab strip. The chrome changes
below are all inside `@media (max-width: 640px)`; `RecipeView`, `GraphView`, `KanbanView` and
`StepDetail` are untouched. Worth watching: four tabs with icon *and* label is a wide strip,
and `.topbar` already wraps around 900 px — icon-only tabs may be wanted a little earlier than
they otherwise would be.

## ① Työn alla — what I have going

The steps where `recordOf(state, id).cookId === me && state === 'active'`. Usually one; often
two (rice simmering, sauce reducing); never many.

- The **first card is expanded**: `step.detail` and `step.uses` inline, because that is the
  whole reason a cook is holding the phone. The rest are collapsed to a title row and expand on
  tap. No navigation for the common case.
- **Elapsed time**, from `record.startedAt`, ticking. The field is already written by
  `applyCommand`; nothing renders it today. `6 min` is the single most useful number on the
  screen and it costs one local `setInterval`.
- **One primary action, `✓ Valmis`**, full-width. `Palauta` and `Vaihda tekijä` live behind the
  card's `⋯`, because a mis-tap that hands your work back is worse than one extra tap.
  *In the event:* filling that button needed an ink. White on `--done` measures 3.88:1; the
  page's near-black measures 4.71:1, and 7.19:1 against the dark theme's lighter green — so
  `--on-done` exists now, and unlike `--on-ready` it is the same value in both themes.
- Steps active under *another* cook's name never appear here. They are in zone ③.

## ② Ota seuraava — the picker

This is the part the board cannot do at all, and it is the heart of the design. A 23-step menu
routinely has eight steps in `ready` at once; a 66-step menu has fifteen. A flat list of fifteen
is not a decision, it is homework.

So: **one hero card, plus the list behind it.**

The hero is the highest-ranked ready step, shown large, with its dish name, its station glyph,
a one-line **reason**, and a full-width `Aloita`. Because `me` is known (see *The gate*, below),
`Aloita` goes straight through `requestStart` → `confirmStart(stepId, me)` with no dialog: the
existing short-circuit in [`store.tsx`](../src/state/store.tsx) already does exactly this. One
tap, from question to answer.

Under it, filter chips (`Liesi` `Uuni` `Grilli` `Muu`, plus `Vain tämä ruokalaji`) and a
collapsed `Kaikki vapaat (n)`. Each row carries its own `Aloita`, so a cook who has already
decided never pays for the hero. Tapping the row body opens the existing `StepDetail`, which is
already a bottom sheet under 900 px — no new component.

### The ranking

A pure function, `rankReady(menu, index, state, cookId)`, in a new `src/state/shift.ts` — React-
free and DOM-free, so it is a `node:test` file rather than something to click at. Same posture
as [`chains.ts`](../src/state/chains.ts) and [`menuDraft.ts`](../src/state/menuDraft.ts).

It starts from `suggestedNext` (ready steps, longest remaining chain first) and adds what
`suggestedNext` cannot know: who is asking.

| Signal | Δ | Why |
| --- | ---: | --- |
| `chainLength` | `+4 ×` | The existing measure of urgency: how many rounds of strictly sequential work still hang off this step. |
| Same `componentId` as a step I am active on or just finished | `+100` | Dominant on purpose. Staying in one dish means one board, one set of ingredients out, one head-space. Jumping dishes is how things get missed. |
| Already assigned to me | `+25` | Somebody meant for me to have it. |
| Same station as a step I am active on | `+20` | I am already standing there. |
| `holdPoint` | `−15` | It says in the type that this can be done well ahead. |
| Assigned to another cook | *excluded* | Not offered at all; it shows under `Kaikki vapaat` greyed with their dot, so it is visible but not proposed. |

Ties break on `index.topoOrder`, so the function is deterministic and the test can assert an
order rather than a set.

*In the event:* the station bonus had to exclude `muu`. `muu` is not a station — `types.ts` says
so in its first comment, it is the bucket a step falls into when no contended equipment is
involved — so "you are already standing at the not-a-station" was firing on half the menu and
putting `Sama piste: Muu` on the suggestion. Every other view hides the `muu` tag for the same
reason; the ranker now ignores it, with a test.

**`criticalPath` is deliberately not a signal.** `buildIndex` says so itself: ties between
equally long chains are broken arbitrarily, *"so it is never used to label an individual step."*
Ranking by it would be labelling by it, one step removed — and the first time two cooks compared
phones and saw different "critical" steps, the feature would have lied. `chainLength` carries
the same information with none of the arbitrariness.

The reason line is read back off whichever bonus decided it: `Jatkoa: Kantarellikeitto` ·
`Sama piste: Liesi` · `Avaa 4 vaihetta` · `Voi tehdä etukäteen`. A ranking a cook cannot
interrogate is a ranking a cook will not trust — and the moment they distrust it they are back
to reading fifteen rows.

## ③ Odottaa muita — the nudge list

Collapsed by default. Blocked steps **one step away**: every unmet dependency is `active`. For
each, who is holding it — `Odotat: Anna · Kastikkeen siivilöinti`, with the presence dot the
roster already draws. This is the piece a phone is uniquely good at, because the person you need
to nudge is standing two metres away and you are the one who knows you are stuck.

`oneStepAway(index, state)` joins `shift.ts`; it is four lines and a test.

## The loop that closes it

The reason this is a *flow* and not three lists: completing a step is also the moment you need
the next one.

Tapping `✓ Valmis` collapses the card and raises a brief bar above the tab strip:

```
  Valmis: Kuullota sipulit.  Vapautui: Lisää kantarellit.
  [ Kumoa ]                            [ Aloita se ]
```

`Vapautui` is `index.dependents.get(id)` filtered to steps that are now `ready` — the work this
cook just unlocked, offered back to them in the same gesture that finished the last one.
`Kumoa` is `setStepState(id, 'todo')` behind the existing `checkTransition`, and it matters: a
`Valmis` button sized for a thumb will occasionally be hit by a thumb that meant something else.

This bar is the only genuinely new interaction pattern in the design, and it is the one that
turns "a mobile layout" into "a mobile flow".

## The gate: who is holding this phone

Every one-tap affordance above depends on `me` being set, and today `me` is set in a modal
behind a button in a topbar that is three rows tall. So on a phone the shift view opens on the
question instead of the content:

```
  Kuka sinä olet?
  [ A  Anna ]  [ P  Pekka ]  [ + Lisää kokki ]
```

It writes through the existing `setMe`, which persists per room and per browser and re-announces
presence on every reconnect. After that the cook's own dot sits in the compact bar and taps
through to the roster — handing the phone to someone else has to be possible, it just does not
have to be on the critical path.

Without the gate the design collapses: every `Aloita` becomes a two-step `StartDialog`, which is
precisely the friction the board already has.

*In the event*, the second half of that shipped without the first: the gate was built, the line
that says who it decided was not. Asked once is not the same as answered once — every card below
is ranked *for* a cook, the view never said which, and changing it meant the roster three taps
into the header's `⋯`, under a label that promises actions rather than an identity. So zone ①
now opens on one compact line — dot, name, `Vaihda` — and tapping it asks the gate's own question
again in a dialog:

```
  [ K  Kokki 1                                    Vaihda ]
  TYÖN ALLA                                             1
```

The same list of choices serves both, since it is the same question at two moments; only the
frame differs. The gate stays a whole screen, because there is nothing behind it worth keeping;
the switcher is a dialog, because by now there is.

## The chrome, at 390 px

Three CSS-only changes, no DOM restructuring:

- **The tab strip fixes to the bottom.** `.tabs` is already a single flex row inside `.topbar`;
  under 640 px it becomes `position: fixed; inset: auto 0 0 0` with
  `padding-bottom: env(safe-area-inset-bottom)` and icon-only labels. `position: fixed` takes it
  out of flow without taking it out of the DOM, so both the topbar's layout *and* every
  `topbar.getByRole('tab')` locator in [`KitchenPageModel`](../e2e-tests/pom/KitchenPageModel.ts)
  survive untouched. `.workspace` gets the matching bottom padding.
- **`Kokit` / `Jaa` / `Muokkaa menua` / `Uusi keittiö` collapse into one `⋯`** that opens a
  `.modal-sheet` — a class the stylesheet already bottom-sheets under 900 px. The room name
  truncates, the connection indicator becomes a dot with its label as `aria-label`.
- **`.upnext` is hidden under 640 px.** Zone ② is a strictly better version of it; two ranked
  lists of the same steps on one small screen is worse than either alone.

The existing `@media (pointer: coarse)` block in
[`MenuEditor.module.css`](../src/components/MenuEditor.module.css) already
establishes 2.75 rem as this project's touch target and explains why. Zone ① and ② inherit it;
the two primary buttons go to 3 rem because they are the only buttons that matter.

## What this does not touch

Worth stating plainly, because it is why the change is small:

- **No protocol change.** No new `Command`, no `applyCommand` branch, no server work. Every
  action in the view is `set_step_state` or `assign`, which exist. `startedAt` exists.
  Presence exists. `me` exists.
- **No new derived state on the wire.** Ranking is a pure function of `(menu, index, state,
  cookId)`, all four of which every client already has.
- **The board is left alone.** It stays a four-column situation display for a big screen, and
  its toolbar hint stays true, because the phone no longer has to pretend to be one.
- **`StepDetail` is reused as-is.** It is already a sheet under 900 px.

## Files

| File | |
| --- | --- |
| `src/state/shift.ts` | **done** — `rankReady`, `activeFor`, `oneStepAway`, `justUnblocked`. Pure, React-free. |
| `src/state/shift.test.ts` | **done**, 13 tests — the ranking's order, the continuity bonus, the tie-break, `oneStepAway`. |
| `src/views/ShiftView.tsx` | **done** — the three zones, the gate, the completion bar. |
| `src/App.tsx` | fourth entry in `VIEWS`; viewport-chosen initial view; actions behind `⋯` under 640 px. |
| `src/components/icons.tsx` | `shift`, vendored from Lucide's `user` — `cooks` is the whole roster, this is one of them. |
| `src/views/ShiftView.module.css` | the shift view. |
| `src/App.module.css` | the 640 px chrome block. |
| `e2e-tests/pom/ShiftViewModel.ts` | **done** — page object, per the repo's rule that new UI means extending a model. |
| `e2e-tests/tests/shift.test.ts` | **done**, 10 tests — gate → pick → work → finish → pick again, plus switching cook mid-shift. |
| `e2e-tests/tests/shift-desktop.test.ts` | **done**, 3 tests — the queue holding still, the panel as its second column, and `Seuraavaksi` giving way. Runs in the desktop project. |
| `playwright.config.ts` | a second project, `devices['Pixel 7']`, matching only this spec — one phone-sized project rather than doubling the suite. The desktop project ignores it, since it would open the room on the recipe and never reach the view. |

## Declined, on purpose

- **A swipeable one-card-at-a-time deck.** It reads well in a demo and fails in a kitchen: a cook
  needs to see that the fish is not yet startable, not just be told what to do next. The hero
  card gets the one-tap decision without hiding the other fourteen steps.
- **A separate `/r/<id>/m` route.** One link per kitchen is the product.
- **Making the kanban responsive.** Four columns at 390 px is two columns of history you cannot
  read and two you cannot act in. Adding the view is less code than squeezing the board, and the
  result is better on both screens.
- **Per-step durations, so the ranking could be minutes rather than steps.** A real improvement,
  and entirely separable — it is a `Step` field and a menu-format change, not a mobile question.
