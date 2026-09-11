# Mössömestari

Suunnittelutyökalu monen ruokalajin illallisen kokkaamiseen usean parin käsien voimin.
Jokainen ruokalaji on pilkottu atomisiin vaiheisiin riippuvuuksineen, joten yhdellä
silmäyksellä näkee mitä voi aloittaa *juuri nyt*, mikä odottaa jotain muuta, ja mikä
ketju ratkaisee milloin ruoka on pöydässä.

The app is in Finnish; the code, comments and this README are in English.

It is a real-time multi-user app: everyone opens the same `/r/<id>` link and sees the
same kitchen. The server is authoritative and the client applies its own changes
optimistically, so tapping a button feels instant but the server decides what is true.

Development needs **two** processes: the Node server, and Vite proxying `/api` and `/ws`
to it. `pnpm dev` alone will start the client and every API call will fail with
`ECONNREFUSED`.

```
pnpm install
pnpm dev:all      # both, in one terminal (Ctrl-C stops both)

pnpm dev:server   # or separately: API + WebSocket on :8080
pnpm dev          #                Vite on :5173, proxying to it

pnpm build        # type-check both projects + production build into dist/
pnpm test         # reducer tests (node:test)
pnpm start        # single process serving dist/ + /api + /ws on :8080
```

`docker compose up` does the same with both in containers.

## The three views

| View | What it's for |
| --- | --- |
| **Resepti** | The menu as you'd read it — course → dish → steps, with ingredients and per-dish progress. |
| **Graafi** | The dependency DAG, laid out left to right, with unparallelisable runs collapsed into multi-step cards (below). Fits itself to the canvas; drag to pan, scroll to zoom. Selecting a step fades everything that isn't a direct neighbour. |
| **Keittiötaulu** | Kanban: Odottaa / Voi aloittaa / Työn alla / Valmis, in fixed card-width columns. Optional swimlanes by cook, station, or dish. Drag cards between columns. |

All three share a step detail panel and the **Seuraavaksi** strip — ready work, ordered
by how much still hangs off it.

### Layout

The page is an app shell: the header, banners and **Seuraavaksi** strip sit *outside* the
scroll container, and a single `.scroller` holds the view. That means the board can be
much wider than the window — it scrolls sideways under a header that always spans the
viewport, rather than dragging the header off to the left. The grouping chips and the
swimlane titles stay pinned to the left edge while it scrolls.

The detail panel is a real side column next to the scroller, so it never scrolls away
horizontally either. Below 900px there isn't a column to spare, so it becomes a modal
sheet over the page with a backdrop — which is also the only thing that reads properly
over a board that scrolls sideways underneath it.

## The model

See [src/model/types.ts](src/model/types.ts). A `Menu` is courses → components (dishes)
→ steps, where each `Step` names the steps it depends on.

```
Course ─┬─ Component ─┬─ Step ──deps──▶ Step
        │             └─ Step
        └─ Component ─── Step
```

There are deliberately **no duration estimates**. Cooking times live in the step's
`detail` text when they matter for the cooking itself ("paahdetaan kunnes rapeita",
"n. 200 asteessa").

`station` is only for equipment that can be contended: `liesi`, `uuni`, `grilli`, and
`muu` for everything else (bench work, cold prep, plating). Steps on `muu` don't show a
station badge at all, so the badge always means something. `holdPoint: true` marks a
step that can be finished hours ahead.

### How steps were split

The decomposition rules, so later courses stay consistent with the first:

- A step is **atomic** if one cook must finish it in one go.
- A chain where each step feeds exactly one successor is **merged** into a single node.
  Peeling and chopping the onion is one step, not two.
- A step is **kept separate** when it forks (its output feeds two branches — roasting
  the chanterelles, since a quarter is set aside for garnish), when it joins two
  branches, when the station changes, or when a long unattended wait lets someone else
  get on with something in the meantime.

### Status and the undo rules

What you record per step is just `todo | active | done`. `blocked` vs. `ready` is
*derived* from the graph — a `todo` step is ready when every dependency is `done`.

Transitions are validated in `checkTransition` ([src/state/graph.ts](src/state/graph.ts))
so the board can never describe something physically impossible:

- You cannot **start** or **complete** a step whose dependencies aren't all done.
- You cannot **undo** a completed step while anything downstream of it is `active` or
  `done` — undo those first. The disabled button's tooltip names exactly which ones.
- `active → todo` ("Palauta") is always allowed; nothing can depend on a step *having
  been started*.

### Starting a step assigns it

"Aloita" — and dragging a card into **Työn alla** — asks *Kuka ottaa tämän?* and records
the cook, so the board shows who is on what. It skips the question when the step already
has a cook, or when there is only one cook in the kitchen. You can also start a step
with nobody on it, or reassign it later from the detail panel.

### Collapsing chains in the graph

Drawn one node per step, a recipe is mostly long single-file trains — seven soup steps
in a row that no second cook can help with. The graph therefore contracts every
**maximal run of privately-connected steps** into one multi-step card
([src/state/chains.ts](src/state/chains.ts)).

Two steps share a card when the edge between them is private in *both* directions —
the earlier step hands off to exactly one successor, and that successor waits for
nothing else — and they belong to the same dish. So a fork (roasting the chanterelles,
a quarter of which is set aside) and a fan-in (plating, which waits on four things) both
stay their own cards; only the runs that genuinely cannot be split get folded up.

The result for the starter is 19 steps drawn as 14 cards over 5 columns instead of 10,
which is the actual shape of the parallelisable work. Each row in a card is still its own
step — it shows its own status and cook, and clicking it opens that step. The card's
stripe rolls the run up: done when every step is, active when any step is. The
**Yhdistä peräkkäiset vaiheet** toggle turns the contraction off to see every step as a
separate node.

### Ordering the work

`buildIndex` computes, for every step, the **length of the longest chain of steps** from
it to the end of the menu. That's a structural depth, not a time estimate, and it gives
two things: the ordering of the **Seuraavaksi** strip — ready work that sits on the
longest chain should be picked up before work that has slack — and the longest chain
itself, drawn in red in the graph to show the spine of the menu.

That chain is deliberately *not* labelled on individual steps. Without durations it is a
count of steps rather than of minutes, so it says nothing about which work actually takes
the longest, and ties between equally long chains are broken arbitrarily. As an ordering
it is still useful; as a per-step badge it would claim more than it knows.

## Writing a menu

Three ways in, all producing the same document:

**The editor.** *Uusi keittiö* on the landing page lists every menu a kitchen can start
from — the ones authored in code and the ones you have written or imported — as one choice,
because starting from either is the same act with a different source. **Muokkaa** on one of
your own opens a keyboard-first outliner over course → dish → step: Enter starts the next
row at the same level, ↑/↓ move between rows, Alt+↑/↓ reorder, and Backspace on an empty row
deletes it. Tab is left alone — it moves between controls, as everywhere else, and never
changes the document.

Rows are created, moved and deleted at their own level. The three levels are three
different kinds of thing rather than three depths of one thing — a dish is a noun, a step is
a verb — so an outliner's usual promote/demote between levels would be a category error
here.

A new step automatically waits on the one above it in the same dish, so typing a recipe top
to bottom produces a correct dependency chain and you only edit the exceptions — the forks
and the joins. A step whose dependencies you have edited by hand is never re-linked again.

Saving is explicit rather than per keystroke: a half-typed menu is routinely invalid, and
every save is broadcast to everyone connected to a kitchen using that menu. Drafts are kept
in `sessionStorage` meanwhile.

A kitchen can be fixed while it is running, from **✏️ Muokkaa menua** in the top bar.
Removing a step that somebody has already started asks first, and names what will be lost.
Starting a kitchen from a library menu *copies* it, so editing the library entry afterwards
never touches a dinner in progress.

**Import and export.** Every menu exports as JSON and imports back, which is how a menu
moves between two instances of the app. Import is deliberately forgiving — see
[docs/menu-format.md](docs/menu-format.md).

A recipe is the unit a model converts well, so a four-course dinner arrives as four separate
documents. **Tuo ja yhdistä** in the editor appends one to the menu already open, re-keying
any ids that collide, which is how the pieces become one menu.

**In code.** [src/data/menu.ts](src/data/menu.ts) is still a menu template, and appending a
`Course`, its `Component`s and their `Step`s there works as it always did. Nothing else
needs touching: the graph, the board, the ordering and the layout all derive from the data.
Bad references and dependency cycles are caught at load and reported in a banner rather
than crashing.

### Converting a recipe with an LLM

[docs/menu-format.md](docs/menu-format.md) is the reference: the field table, both accepted
shapes, and the rules for splitting a recipe into steps that are worth parallelising.
[docs/menu-prompt.md](docs/menu-prompt.md) is a ready-to-paste prompt — the editor's
**Kopioi LLM-kehote** button copies the same text. The JSON Schema is checked in as
[docs/menu.schema.json](docs/menu.schema.json) and served by a running instance at
`GET /api/menus/schema.json`, generated from the same zod schema that validates an import,
so it cannot describe a format the server would reject.

Both are regenerated with `pnpm gen:schema`, and a test fails if they fall behind.


## Architecture

One process serves the built client, a small REST API and a WebSocket endpoint; state
lives in SQLite. The whole thing is one container.

### Rooms

A **room** is one kitchen: a menu plus who is cooking and how far along everything is.
Rooms are created explicitly from the landing page and shared by link — there is no
implicit default room and nothing is seeded. Resetting a kitchen is not a thing you do;
you make a new room from the same menu, which keeps the finished one around.

A room **copies** its menu into its own row at creation, so editing one room's menu will
never disturb another. Menu *templates* still live in code
([src/shared/templates.ts](src/shared/templates.ts)); see below.

### Commands in, snapshots out

The client sends an intent — "start this step as this cook" — and the server replies with
the entire new state and a version number. State is a couple of kilobytes, so there is no
reason to diff it, and carrying it whole means the server can *delete* records (pruning
steps a menu no longer has) without the protocol needing tombstones.

The load-bearing piece is [src/shared/apply.ts](src/shared/apply.ts): one pure
`applyCommand(index, state, envelope)` that runs on **both** sides. The client's visible
state is always `pending.reduce(applyCommand, confirmed)`, so rolling back a rejected
command is dropping it from the queue and recomputing — there is no hand-written inverse
per mutation. Two properties make that work:

- **Purity.** Timestamps and generated ids travel inside the envelope, never read from
  the ambient clock during apply. The server overwrites the client's `at` with its own, so
  a browser with a wrong clock can produce a briefly wrong optimistic time but can never
  persist one.
- **Idempotency.** `add_cook` carries a client-generated UUID and no-ops if it already
  exists; everything else is an assignment. That is what makes it safe for a client to
  replay its pending queue after a reconnect. The server also remembers recent command
  ids and acknowledges a replay without re-applying it.

Server rejections (unmet dependencies, undoing something already built on, claiming a step
another cook holds) go back to the originating client only, which shows a banner and rolls
the optimistic change back.

### The isomorphic boundary

`checkTransition` and `buildIndex` have to run on the client *and* the server, so this is
one package with two TypeScript projects rather than a workspace (three, counting the
e2e tests). Server-reachable
modules are `src/shared/**`, `src/model/**`, `src/state/graph.ts` and `src/data/menu.ts`;
they may not import React or DOM APIs, and their relative imports must carry explicit
`.ts` extensions. [tsconfig.server.json](tsconfig.server.json) has no DOM lib and no
`jsx`, and lists those paths explicitly — so a stray `document.` in shared code fails
`pnpm build` instead of at runtime.

The server has no build step: Node 24 runs the `.ts` files directly by stripping types.
That is why `erasableSyntaxOnly` is on.

### Editing the menu while developing

The starter menu is authored in [src/data/menu.ts](src/data/menu.ts). A room created in
development keeps *following* the template it came from, so editing that file and letting
`node --watch` restart the server updates the room's menu in place, pruning progress only
for steps that no longer exist. `MENU_FOLLOW_TEMPLATE` controls it; it defaults **off**
under `NODE_ENV=production`, so a redeploy can never rewrite a dinner in progress. The
first in-app edit of a menu clears the flag, so the editor and the template loop cannot
fight over the same row.

## Tests

`pnpm test` runs the reducer tests with `node:test` — `applyCommand` is the whole
mutation surface, so it is worth testing directly. `pnpm e2e` runs the browser tests with
Playwright. Chromium has to be downloaded once first:

```
pnpm e2e:install       # playwright install chromium
pnpm e2e               # the suite, fully parallel
pnpm e2e:ui            # the Playwright UI, for writing tests
pnpm e2e:report        # the HTML report from the last run
```

### A backend per worker

There is no `webServer` in [playwright.config.ts](playwright.config.ts). One shared
server would be wrong twice over: the app is deliberately single-replica, so every worker
would contend on one SQLite file, and every worker would see every other worker's rooms.

Instead [e2e-tests/server.ts](e2e-tests/server.ts) starts a **real server process with a
real database per worker** — the same `node src/server/main.ts` that `pnpm start` runs,
pointed at a fresh `DATA_DIR` under the system temp directory and a port the OS picked.
A worker-scoped fixture in [e2e-tests/pcTest.ts](e2e-tests/pcTest.ts) owns that process
and hands its URL to `baseURL`, so `page.goto('/')` and the `request` fixture both reach
the worker's own server. The database is deleted when the worker finishes.

Within a worker the database *is* shared between tests, which is fine because the room is
the unit of isolation: the `room` fixture creates one per test, named after the test.
Two full suites can run at the same time without colliding.

The client is built once in [e2e-tests/globalSetup.ts](e2e-tests/globalSetup.ts) and
served from `dist/` by those servers, exactly as in production — no dev server and no
proxy, so the WebSocket needs no test-only wiring.

| Variable | Meaning |
| --- | --- |
| `E2E_SKIP_BUILD=1` | Reuse the existing `dist/` instead of rebuilding it. |
| `E2E_SERVER_LOG=1` | Pipe each server's output through, prefixed with its port. |
| `E2E_KEEP_DATA=1` | Keep the temporary `DATA_DIR`s for inspection. |

### Page objects

Tests talk to the UI through page objects in [e2e-tests/pom/](e2e-tests/pom/), not through
raw selectors. A model exposes locators as `readonly` fields and higher-level moves as
methods; `expect*` methods assert, `ensure*` methods make something true. Locators are
built in the constructor body rather than in field initialisers — `useDefineForClassFields`
is on, so a field initialiser would run before the constructor could store `page`.

The REST API is used only to *arrange* a test ([testApiClient.ts](e2e-tests/testApiClient.ts));
everything a cook does goes through a page object. Finnish text the tests match on lives in
[labels.ts](e2e-tests/labels.ts) and [defaultMenu.ts](e2e-tests/defaultMenu.ts), so
editing the menu does not mean grepping the specs.

CI needs `pnpm exec playwright install --with-deps chromium` before `pnpm e2e`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP + WebSocket port. |
| `DATA_DIR` | `./data` | Where `app.db` lives. |
| `NODE_ENV` | `development` | `production` turns template-following off. |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | unset | Set **both** to require basic auth; set neither for open local dev. Setting exactly one is a startup error. |
| `MENU_FOLLOW_TEMPLATE` | `1` outside production | Whether rooms track their code template. |
| `DEV_CLIENT_URL` | unset | Origin of a Vite dev server. When set, the server redirects page loads there instead of serving `dist/`. `pnpm dev:all` sets it. |
| `PROXY_TARGET` | `http://localhost:8080` | Where the Vite dev server proxies `/api` and `/ws`. |

Basic auth covers the WebSocket too. Browsers cannot set headers on a `WebSocket` and are
inconsistent about replaying cached credentials on an upgrade, so a successful HTTP
request also sets an `HttpOnly` cookie derived from the credentials, and the upgrade
accepts either that or an `Authorization` header. `/healthz` is always open — the kubelet
sends no credentials.

## Deployment

`Dockerfile` builds a single image that serves everything. [k8s/](k8s/) has manifests for
a one-replica Deployment with a PVC — **one** replica on purpose: SQLite is a single
writer and the WebSocket fan-out is in-process, so a second replica would contend on the
volume and split every room in half. Scaling out means changing both of those first.
