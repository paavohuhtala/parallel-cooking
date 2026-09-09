# Parallel Cooking

Suunnittelutyökalu monen ruokalajin illallisen kokkaamiseen usean parin käsien voimin.
Jokainen ruokalaji on pilkottu atomisiin vaiheisiin riippuvuuksineen, joten yhdellä
silmäyksellä näkee mitä voi aloittaa *juuri nyt*, mikä odottaa jotain muuta, ja mikä
ketju ratkaisee milloin ruoka on pöydässä.

The app is in Finnish; the code, comments and this README are in English.

```
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

Recipes are hard-coded in [src/data/menu.ts](src/data/menu.ts); progress lives in
`localStorage` under `parallel-cooking/v1`.

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

## Adding the remaining courses

Only course 1 is transcribed so far, from [reseptit.md](reseptit.md). To add another,
append to the three arrays in [src/data/menu.ts](src/data/menu.ts) — a `Course`, its
`Component`s, and their `Step`s. Nothing else needs touching: the graph, the board, the
ordering and the layout all derive from the data. Bad references and dependency
cycles are caught at load and reported in a banner rather than crashing.
