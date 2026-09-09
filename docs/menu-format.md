# The menu format

A menu is a multi-course dinner broken into atomic steps and the dependencies between
them, so the app can show what can start *now* and which chain decides when food reaches
the table.

This document is the reference for writing one by hand or generating one with an LLM.
Two companion files are generated from the code and should not be edited:

| File | What it is |
| --- | --- |
| [menu.schema.json](menu.schema.json) | JSON Schema, generated from the zod validator that actually runs |
| [menu-prompt.md](menu-prompt.md) | A ready-to-paste conversion prompt |

A running instance also serves the schema at **`GET /api/menus/schema.json`**, so an agent
can be pointed straight at a URL. Both files are regenerated with `pnpm gen:schema`, and a
test fails if they drift from the source.

**All user-visible text is in Finnish.** Field names are English.

## The shape

Three levels: **ruokalaji** (course) → **osa** (component — one dish or side) → **vaihe**
(step). Steps form a directed acyclic graph; each step names, in `deps`, the steps that
must be `done` before it can start.

```
Course ─┬─ Component ─┬─ Step ──deps──▶ Step
        │             └─ Step
        └─ Component ─── Step
```

Dependencies cross components freely, and normally do: plating the soup waits on both the
soup being hot and the bowls being on the table.

## How to split a recipe into steps

These are the rules the hand-written menu in [`src/data/menu.ts`](../src/data/menu.ts) was
transcribed under. They are the part that matters — get the granularity wrong and the app
either can't parallelise anything or drowns you in trivia.

- A step is **atomic** if one cook must finish it in one go.
- A chain of steps where each feeds exactly one successor is **merged into a single step**
  (peeling *and* chopping the onion is one step, not two).
- A step is **kept separate** when it forks (its output feeds two branches), when it joins
  two branches, when the station changes, or when a long unattended wait lets another cook
  get on with something else meanwhile.
- Cooking times belong in `detail` when they matter for the cooking itself. **There are
  deliberately no durations on steps** — do not invent them.
- Gather serving work (laying the table, plating, carrying out) into its own component,
  and let it depend on every finishing step of the course.

## Fields

### Menu

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | The dinner's name. |
| `courses` | yes | At least one. |
| `components` | — | Flat form only. |
| `steps` | — | Flat form only. |

### Course (ruokalaji)

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | |
| `id` | — | Derived from `name` when omitted. |
| `order` | — | 1-based; defaults to position in the array. |
| `note` | — | Shown under the course heading. |
| `components` | — | Nested form. |

### Component (osa)

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | |
| `id` | — | Derived from `name`. |
| `courseId` | — | Flat form only; nested takes it from the enclosing course. |
| `ingredients` | — | Free strings, as you would write a shopping list. |
| `note` | — | |
| `steps` | — | Nested form. |

### Step (vaihe)

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | Short imperative: *"Kuori ja pilko sipuli"*. |
| `id` | — | Derived from `title`. |
| `componentId` | — | Flat form only. |
| `detail` | — | The full instruction, including times. |
| `station` | — | `liesi` \| `uuni` \| `grilli` \| `muu`. Defaults to `muu`. |
| `deps` | — | Step ids **or step titles**. Defaults to `[]`. |
| `uses` | — | Ingredients this step consumes; use the component's exact strings. |
| `holdPoint` | — | `true` when the step can be finished well ahead of service. |

**`station`** names only contended equipment. Bench work, cold prep and plating are all
`muu`. **`holdPoint`** marks the boundary between "can be done in the afternoon" and
last-minute work: everything downstream of one is last-minute.

## Two accepted shapes

Import accepts either. Export always writes the flat one, with every id filled in.

### Nested — recommended for writing

No `courseId` or `componentId` anywhere, and no ids unless you want to pin them.

```json
{
  "name": "Illallinen",
  "courses": [
    {
      "name": "Alkupala: kantarellikeitto",
      "components": [
        {
          "name": "Kantarellikeitto",
          "ingredients": ["kantarelleja (n. 500 g)", "voita", "iso sipuli"],
          "steps": [
            {
              "title": "Puhdista ja hienonna kantarellit",
              "uses": ["kantarelleja (n. 500 g)"]
            },
            { "title": "Kuori ja pilko sipuli", "uses": ["iso sipuli"] },
            {
              "title": "Paahda sienet ja ruskista voissa",
              "detail": "Paahda kuivaksi, lisää voi, anna ruskistua muutama minuutti.",
              "station": "liesi",
              "deps": ["Puhdista ja hienonna kantarellit"],
              "uses": ["voita"]
            },
            {
              "title": "Kuullota sipulit sienten kanssa",
              "station": "liesi",
              "deps": ["Paahda sienet ja ruskista voissa", "Kuori ja pilko sipuli"]
            }
          ]
        }
      ]
    }
  ]
}
```

Note the last step: a **join**, waiting on two branches that different cooks can work in
parallel. That is the whole point of the format.

### Flat — what export writes

Every entity carries an explicit id and points at its parent.

```json
{
  "name": "Illallinen",
  "courses": [{ "id": "alkupala", "order": 1, "name": "Alkupala: kantarellikeitto" }],
  "components": [
    {
      "id": "keitto",
      "courseId": "alkupala",
      "name": "Kantarellikeitto",
      "ingredients": ["kantarelleja (n. 500 g)", "voita"]
    }
  ],
  "steps": [
    {
      "id": "puhdista",
      "componentId": "keitto",
      "title": "Puhdista ja hienonna kantarellit",
      "station": "muu",
      "deps": []
    },
    {
      "id": "paahda",
      "componentId": "keitto",
      "title": "Paahda sienet ja ruskista voissa",
      "station": "liesi",
      "deps": ["puhdista"],
      "uses": ["voita"]
    }
  ]
}
```

Mixing the two — nested courses *and* top-level `components`/`steps` — is accepted, but
the nested content wins and the import reports that it ignored the rest.

## Dependencies by title

`deps` entries are matched against step ids first, then against step titles
(case- and whitespace-insensitive). This is what makes the nested form practical for an
LLM: there is no id table to keep consistent across three arrays.

A title matching **two** steps is left unresolved and reported rather than guessed, and
then shows up as a dangling reference. Keep step titles unique within a menu.

## What import checks

Shape is checked against the schema; anything past that is checked semantically. Errors
block the import, warnings do not.

| | Meaning |
| --- | --- |
| **Error** | duplicate id, a component or step pointing at a parent that does not exist, a step depending on itself, an unresolvable dependency, a dependency cycle, a menu with no steps |
| **Warning** | a course with no components, a component with no steps, a `uses` entry missing from its component's `ingredients` (offered as a one-click fix in the editor) |

Ids are generated from names by lowercasing, folding `ä`/`ö`/`å` to ASCII and replacing
everything else with `-`; collisions get `-2`, `-3`. Ids you write explicitly are always
kept, even when a generated one would have wanted the same name.

## Converting a recipe with an LLM

Paste [menu-prompt.md](menu-prompt.md) followed by the recipe, and import the JSON that
comes back. The editor has a **Kopioi LLM-kehote** button that puts the same text on your
clipboard.
