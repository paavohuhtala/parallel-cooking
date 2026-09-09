# CLAUDE.md

## Purpose

Planner for cooking a multi-course dinner with several pairs of hands. Dishes are broken
into atomic steps with dependencies, so you see what can start *now* and which chain
decides when food reaches the table. Real-time and multi-user: everyone opens the same
`/r/<id>` link and sees the same kitchen.

**UI is in Finnish; code, comments and docs are in English.**

## Commands

```
pnpm dev:all    # server (:8080) + Vite (:5173) — Ctrl-C stops both
pnpm dev        # Vite alone; needs dev:server or /api gets ECONNREFUSED
pnpm build      # tsc -b (both projects) + vite build
pnpm test       # node:test, reducer tests
pnpm start      # production: one process serving dist/ + /api + /ws
pnpm check:bundle
```

No linter; `tsc -b` is the gate. Env vars and deployment are in [README.md](README.md).

## Architecture

One process serves the built client, a REST API and a WebSocket; SQLite (`node:sqlite`)
stores state as JSON. REST does room management, the socket carries everything *inside* a
room. A **room** is one kitchen, created explicitly and shared by link; it owns a copy of
its menu. Nothing is seeded, there is no default room, and there is no reset — you create
a new room from the same menu.

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

### Isomorphic boundary

One package, two TS projects (not a workspace) because `checkTransition` and
`buildIndex` run on both sides. Server-reachable: `src/shared/**`, `src/model/**`,
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

## Tech choices

`hono` + `@hono/node-server` (correct static serving is the driver; zero transitive deps),
`zod` for untrusted input only, `ws`, `@tanstack/react-router` (code-based routes).

Declined on purpose: ORM/query builder, migration tool, socket.io, `nanoid`,
reconnecting-socket wrapper. **Keep zod out of the client bundle** — runtime constants live
in [constants.ts](src/shared/constants.ts) so the client's only edge into schema modules is
`import type`; `check:bundle` enforces it.

## Gotchas

- `base: '/'` in `vite.config.ts`, not `'./'` — room URLs are nested. Only breaks on a
  *direct reload* of `/r/<id>`.
- The menu is authored in [menu.ts](src/data/menu.ts) as a template. Dev rooms keep
  following it, so editing it and restarting updates open rooms in place.
  `MENU_FOLLOW_TEMPLATE` is off under `NODE_ENV=production`.
- `steps` is sparse — missing means `{state:'todo', cookId:null}` via `recordOf`.
- Basic auth covers the socket via a cookie (browsers can't set headers on a `WebSocket`).
  Two call sites, one shared check function — keep it that way.
- **One replica only**: SQLite is a single writer and the fan-out is in-process.
- `dev:all` is [scripts/dev-all.mjs](scripts/dev-all.mjs), not a shell one-liner: npm and
  pnpm both run scripts through cmd.exe on Windows, where `;` separates arguments and
  `&` runs the next command instead of backgrounding. The old one-liner started Vite
  without the server, so every `/api` call came back ECONNREFUSED through the proxy.
- `pnpm test` quotes its glob with **double** quotes: scripts run through cmd.exe on
  Windows, which does not strip single quotes, so `'src/**/*.test.ts'` reached Node as a
  literal and matched nothing — reported as a green run of zero tests. Node expands the
  pattern itself, so it must arrive unexpanded but unquoted.
- pnpm (pinned by `packageManager`, enabled via corepack in the Dockerfile and
  compose). It blocks install scripts by default: a new dep with a postinstall stays
  silently unbuilt until it is listed in `pnpm.onlyBuiltDependencies` — `esbuild` is
  there for that reason. Its `node_modules` is strict, so anything imported has to be
  a real dependency; nothing transitive is hoisted into reach.
