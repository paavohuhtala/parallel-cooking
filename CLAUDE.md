# CLAUDE.md

## Purpose

Planner for cooking a multi-course dinner with several pairs of hands. Dishes are broken
into atomic steps with dependencies, so you see what can start *now* and which chain
decides when food reaches the table. Real-time and multi-user: everyone opens the same
`/r/<id>` link and sees the same kitchen.

**UI is in Finnish; code, comments and docs are in English.**

## Comments

Sparingly, and for *why* — in the rare case the why is not already apparent from the
code. A comment that justifies a feature's existence, argues for the design or
restates what the line below it does is not allowed, however well it reads. Before
writing one, ask what a reader would get wrong without it; no answer means no
comment. The prose already in this file and in the codebase is not a licence to add
more of it.

## Commands

```
pnpm dev:all    # server (:8080) + Vite (:5173) — Ctrl-C stops both
pnpm dev        # Vite alone; needs dev:server or /api gets ECONNREFUSED
pnpm build      # tsc -b (all three projects) + vite build
pnpm test       # node:test, reducer tests
pnpm e2e        # Playwright, fully parallel; pnpm e2e:install once for Chromium
pnpm start      # production: one process serving dist/ + /api + /ws
pnpm check:bundle
```

No linter; `tsc -b` is the gate — it covers the e2e project too
([tsconfig.e2e.json](tsconfig.e2e.json)). Env vars and deployment are in
[README.md](README.md).

## Architecture

One process serves the built client, a REST API and a WebSocket; SQLite (`node:sqlite`)
stores state as JSON. REST does room management, the socket carries everything *inside* a
room. A **room** is one kitchen, created explicitly and shared by link; it owns a copy of
its menu. Nothing is seeded, there is no default room, and there is no reset — you create
a new room from the same menu. Deleting one is offered from the list of kitchens on the
front page and only while nobody is connected: presence is the one piece of state the
database does not hold, so `DELETE /api/rooms/:id` asks the socket layer and answers 409
rather than trusting the button that was drawn from a count read seconds ago.

Protocol: **commands in, whole versioned snapshots out**. State is ~2 KB, so there is no
reason to diff it, and carrying it whole lets the server delete records without tombstones.

Presence is the one thing outside that loop: a client announces which cook is sitting at
it, the server keeps that on the connection and broadcasts the set of claimed cooks. It
never reaches `applyCommand` or the database, because it is only true while the socket is
open — the client re-announces on every `hello`.

### The invariant that holds it together

[src/shared/apply.ts](src/shared/apply.ts) exports one pure `applyCommand(index, state,
envelope)` running on **both** sides. Client state is `pending.reduce(applyCommand,
confirmed)`, so rolling back a rejection is dropping it from the queue and recomputing —
no inverse per mutation. Don't break either property:

- **Purity** — non-deterministic inputs (`at`, generated ids) travel in the envelope.
  Never read the clock or make an id inside `applyCommand`; the server overwrites `at`.
- **Idempotency** — `add_cook` carries a client UUID and no-ops if it exists, everything
  else is an assignment. This is what makes the client's post-reconnect replay safe.

New command = extend `CommandSchema` in [src/shared/protocol.ts](src/shared/protocol.ts),
handle it in `applyCommand`, add a test, expose it on the store. The server needs nothing.

### Menu writes are REST, not commands

Editing a menu deliberately does **not** go through `applyCommand`. That function takes an
index *derived from the menu*, so a mutable menu inside the pending queue would replay
early commands against an index built from a later menu — the one property the section
above exists to protect. Menus carry their own `version` instead: a `PUT` with an
`expectedVersion` precondition (409 on a mismatch), and the server broadcasts the
`{type:'menu'}` message the protocol already had. `menuChanged` in
[room.ts](src/server/room.ts) is the only door into the live-room map; it must be called
synchronously after the write, or a socket command can apply against state that pruning is
about to replace.

Menu semantics live in [menuDoc.ts](src/shared/menuDoc.ts) (zod-free, so the editor can
validate a draft on every keystroke) and shape validation in
[menuSchema.ts](src/shared/menuSchema.ts) (zod, server-only). The outliner's structural
rules — auto-chaining, splicing on delete, merging a converted recipe in — are a pure
reducer in [menuDraft.ts](src/state/menuDraft.ts), so they are unit tests rather than
clicking. Two constraints hold that reducer together: **Tab never mutates** — it is the one
key whose meaning everyone already knows, and a version that restructures the document means
tabbing out of a field rewrites the recipe — and rows are only ever created, moved and
deleted **at their own level**, because a dish is a noun and a step is a verb, so an
outliner's usual promote/demote between levels would be a category error.

The editor around that reducer is shaped by three rules, and the first two exist because
"expand" otherwise means two things at once:

- **The left glyph is the only disclosure.** On a course or a dish it shows or hides the
  children and does nothing else. A step has no children, so its slot carries the station
  instead — and opens the details.
- **Details are never inline.** They live in the inspector — a column beside the outline on
  a desktop, a sheet over it on a phone — so no second toggle competes with the first, and
  the outline holds still while you edit a step.
- **Every list ends in a tail row.** "+ Osa" / "+ Vaihe" / "+ Ruokalaji" are always there,
  not only when a parent is empty. `insert_after` derives a new row's parent from a sibling,
  so without `insert_child` behind those tails an empty course or dish is a dead end — and
  they are what makes any of this work without a keyboard. Reordering and deleting sit in
  the row's `⋯` for the same reason: `Alt+↑/↓` has no thumb equivalent.

The dependency gutter left of the outline ([lanes.ts](src/state/lanes.ts), drawn by
[DepGutter.tsx](src/components/DepGutter.tsx)) shows the exceptions to auto-chaining. A step
waiting for the one directly above it in its dish is a plain trunk; every other dependency
is a lane in the colour of the dish it comes from, dashed when it runs up the page to
something listed below. It is sliced per row rather than measured, so every outline item
renders its slice — headings and tails included, or a line breaks there.

### Isomorphic boundary

One package, two TS projects (not a workspace) because `checkTransition` and
`buildIndex` run on both sides; a third, [tsconfig.e2e.json](tsconfig.e2e.json), covers
the Playwright tests and takes types — never values — from `src`. Server-reachable: `src/shared/**`, `src/model/**`,
`src/state/graph.ts`, `src/data/menu.ts`. No React or DOM there, and relative imports
**must** carry explicit `.ts` extensions. [tsconfig.server.json](tsconfig.server.json) has
no DOM lib and lists those paths explicitly, so a stray `document.` fails the build.

The server has **no build step** — Node 24 strips types and runs `.ts`, hence
`erasableSyntaxOnly` (no enums, namespaces, parameter properties).

### Client

[session.ts](src/state/session.ts) owns the socket, confirmed state and pending queue; one
per room, refcounted with a grace window so StrictMode's remount doesn't churn it.
[store.tsx](src/state/store.tsx) wraps it in `useSyncExternalStore` and gates rendering
until `hello`, which keeps `menu` non-nullable — **the three views and step components are
untouched by the server work; keep it that way.** Local-only: the start dialog, rejections,
view tab, recent rooms, and the `me` cook id.

### Styles

**CSS modules.** [styles.css](src/styles.css) is the only global stylesheet and holds only
what no component could own: the design tokens, the reset, bare-element rules, `@keyframes`.
Everything else is a `*.module.css` beside the file that renders it, so a class name is local
and renaming one cannot reach across the app. The handful of classes several components
render — a button, a chip, a status dot, a modal, `muted`/`small` — live in
[ui.module.css](src/components/ui.module.css) and are imported like any other module;
[cx.ts](src/components/cx.ts) joins the two or three that land on one element.

Two rules keep the cascade from depending on the bundler's import order, which is the one
thing scoping does *not* fix:

- **Order inside a file is load-bearing and is preserved.** `.btnPrimary` after `.btnStart`,
  `.muted` after `.small` — `muted small` together reads at 0.85rem, `small` alone at 0.8rem.
  These were adjacent in the single stylesheet this was split out of and have to stay so.
- **A component overriding a shared class does it from a more specific selector of its own**
  — `.cardActions .primary`, `.head .save:disabled`, `.inspector .field` — never a bare class
  racing `ui.module.css`. Where the shared element is a plain `<button>`, a descendant
  selector (`.toast button`) says the same thing.

Scoping the names is not free of consequence: two unrelated `.menu-list` classes — the
landing page's list of menus and the editor's popup — were one global class, and the landing
page's list was silently taking the popup's `position: absolute`. Splitting them fixed it.

### Motion

[motion.tsx](src/components/motion.tsx) holds the shared pieces, and its header says what
Motion is for: making changes that arrive over the socket visible — a card travelling
between columns, a suggestion lifting into `Työn alla`, a refused move shaking its head.
Hover and colour fades stay in CSS. The rules:

- **`m.*`, never `motion.*`.** `LazyMotion` is `strict`, so a `motion.div` throws. `domMax`
  loads after first render from [motionFeatures.ts](src/components/motionFeatures.ts);
  anything imported statically from `motion/react` lands in the main chunk, which is why
  the rejection nudge uses the WAAPI-only `motion/react-mini` rather than
  `useAnimationControls` (that one pulls in the whole engine).
- **A Motion element eats `onDragStart`/`onDragEnd`** as its own gesture props and never
  hands them to the DOM. The board's cards use native drag, so the layout animation sits on
  a wrapper `m.div` around a plain `<article draggable>`.
- **`layoutId` is namespaced per view** (`LayoutGroup id="board"` / `"shift"`). Both use
  step ids, and a tab switch swaps one view for the other in a single render — without the
  names, cards would fly from the board into the shift view.
- The workspace's `.scroller` is `m.div layoutScroll`; without it every layout animation
  inside is off by the scroll offset.
- **Dialogs are [Modal.tsx](src/components/Modal.tsx)**, rendered inside an
  `AnimatePresence` with the condition outside: `{open && <X key="x" />}`. Unmounting still
  closes them, so their state starts fresh on every open. A `sheet` docks below 900 px and
  is pulled down by its head (`ModalHead`). The editor's inspector keeps its own
  hand-rolled drag: it is always mounted and is a column above that width, not a dialog.
- **Anything on its way out is `inert` and carries `data-leaving`** (`useLeaving`) — it is
  still in the DOM for its exit, and must neither take a second tap nor be found as *the*
  element by a test.
- The nudge finds its target by `data-step-id`. Every view marks the element that stands
  for a step with it; a new view should too.
- `reducedMotion="user"`: transforms and layout animations go, opacity and height fades stay.

### E2E tests

[playwright.config.ts](playwright.config.ts) has **no `webServer`** on purpose. Each
Playwright worker starts its own `node src/server/main.ts` with its own temp `DATA_DIR`
([e2e-tests/server.ts](e2e-tests/server.ts)), and the worker-scoped fixture in
[pcTest.ts](e2e-tests/pcTest.ts) feeds its URL to `baseURL` — one shared server would
serialise the suite and leak rooms between workers. Ports come from the OS, so two suites
can run at once. The client is built once in globalSetup and served from `dist/` by those
servers, which is why there is no proxy in the picture.

Tests drive the UI through page objects in [e2e-tests/pom/](e2e-tests/pom/) — locators as
`readonly` fields, moves as methods, `expect*` to assert and `ensure*` to make true. New
UI means extending a model, not reaching for a selector in a spec. A model reaches the DOM by
role, by accessible name, or by `data-testid` — never by class, which is scoped and hashed
and is the stylesheet's business; a state a test needs to see is a `data-` attribute
(`data-status`, `data-menu-open`), not a class it reads. Build locators in the
constructor body: `useDefineForClassFields` means a field initialiser runs before the
constructor can store `page`. The REST API is for arranging a test only.

Exit animations mean an element can briefly exist twice — the shift view's hero card
fades out beside its replacement. Count and visibility assertions retry through that, but
a strict locator fails at once on two matches, so a model locating something that is
replaced in place excludes the one leaving: `.and(page.locator(':not([data-leaving])'))`.

## Tech choices

`hono` + `@hono/node-server` (correct static serving is the driver; zero transitive deps),
`zod` for untrusted input only, `ws`, `@tanstack/react-router` (code-based routes),
`motion` (client only; ~19 KB gzip in the main chunk, ~28 KB in the lazily loaded
feature chunk — see [Motion](#motion)).

Declined on purpose: ORM/query builder, migration tool, socket.io, `nanoid`,
reconnecting-socket wrapper, icon library. **Keep zod out of the client bundle** — runtime
constants live in [constants.ts](src/shared/constants.ts) so the client's only edge into
schema modules is `import type`; `check:bundle` enforces it.

Icons are vendored path data in [icons.tsx](src/components/icons.tsx) — a couple of KB, no
dependency, nothing to build. Mostly Phosphor (MIT), with the grill from Material Design
Icons (Apache-2.0) and three from Lucide (ISC), of which only `shift` is wired up; Lucide alone
has neither an oven nor a grill, which is what settled it. Two rules keep the table honest: `STATIONS` in
[types.ts](src/model/types.ts) stays `{id, label}` because that module is server-reachable, so
the id→glyph map lives on the client side of the boundary; and every glyph is sized in `em`,
so a call site sets its size with `font-size` and one `<Icon>` serves a 15px row and a heading
with no size prop to thread through. `StartIcon` is the exception that proves it — the one
composed, self-coloured mark in the app.

## Gotchas

- `base: '/'` in `vite.config.ts`, not `'./'` — room URLs are nested. Only breaks on a
  *direct reload* of `/r/<id>`.
- The menu is authored in [menu.ts](src/data/menu.ts) as a template. Dev rooms keep
  following it, so editing it and restarting updates open rooms in place.
  `MENU_FOLLOW_TEMPLATE` is off under `NODE_ENV=production`. A menu edited in the app
  clears `follows_template` **and** `template_id` — `refreshFollowedMenus()` selects on
  both, and leaving either set means the next restart silently reverts the user's work.
- `docs/menu.schema.json` and `docs/menu-prompt.md` are generated by `pnpm gen:schema`;
  a test fails when they drift. The JSON examples inside `docs/menu-format.md` are parsed
  and validated by that same suite, so the prose cannot rot either.
- `steps` is sparse — missing means `{state:'todo', cookId:null}` via `recordOf`.
- Basic auth covers the socket via a cookie (browsers can't set headers on a `WebSocket`).
  Two call sites, one shared check function — keep it that way.
- **One replica only**: SQLite is a single writer and the fan-out is in-process.
- `dev:all` is [scripts/dev-all.mjs](scripts/dev-all.mjs), not a shell one-liner: npm and
  pnpm both run scripts through cmd.exe on Windows, where `;` separates arguments and
  `&` runs the next command instead of backgrounding. The old one-liner started Vite
  without the server, so every `/api` call came back ECONNREFUSED through the proxy.
  It also sets `DEV_CLIENT_URL`, so :8080 redirects page loads to Vite instead of serving
  `dist/` — otherwise :8080 serves whatever the last `pnpm build` or e2e run built, and
  looks like the app while showing old code.
- `pnpm test` quotes its glob with **double** quotes: scripts run through cmd.exe on
  Windows, which does not strip single quotes, so `'src/**/*.test.ts'` reached Node as a
  literal and matched nothing — reported as a green run of zero tests. Node expands the
  pattern itself, so it must arrive unexpanded but unquoted.
- Playwright browsers are **not** downloaded by `pnpm install` — pnpm blocks install
  scripts, and `playwright` downloads its browsers from one. `pnpm e2e:install` is the
  explicit step; keep it out of `onlyBuiltDependencies` so a plain install stays light.
- pnpm (pinned by `packageManager`, enabled via corepack in the Dockerfile and
  compose). It blocks install scripts by default: a new dep with a postinstall stays
  silently unbuilt until it is listed in `pnpm.onlyBuiltDependencies` — `esbuild` is
  there for that reason. Its `node_modules` is strict, so anything imported has to be
  a real dependency; nothing transitive is hoisted into reach.
