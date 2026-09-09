/*
 * The conversion prompt, as a plain string so the editor's "copy prompt" button
 * and `docs/menu-prompt.md` are literally the same text. No zod here — this one
 * is safe in the client bundle.
 *
 * English, like every other machine- and developer-facing text in the repo:
 * models follow instructions in English considerably more reliably than in
 * Finnish. The *output* is Finnish, because the app's UI is, and the prompt says
 * so repeatedly — that split is the one thing worth being emphatic about here.
 *
 * The decomposition rules are the load-bearing part. They are the same ones the
 * hand-written menu in `src/data/menu.ts` was transcribed under, and they are
 * what stops a model emitting a flat list of thirty sequential steps that no
 * second cook can help with.
 */
export const MENU_PROMPT = `Convert the recipe below into a Parallel Cooking menu (JSON).

A menu has three levels: course → component (one dish or side) → step. Steps form
a directed acyclic graph: each step lists, in \`deps\`, the steps that must be
finished before it can start. The point of the format is to show what several
cooks can do at the same time, so the dependencies are the substance — a flat
list of sequential steps is a failed conversion.

## How to split the recipe into steps

- A step is atomic if one cook must finish it in one go.
- Merge a chain where each step feeds exactly one successor into a single step:
  peeling and chopping the onion is one step, not two.
- Keep a step separate when it forks (its output feeds two branches), when it
  joins two branches, when the station changes, or when a long unattended wait
  lets another cook get on with something else meanwhile.
- Put cooking times in \`detail\` when they matter. Do NOT invent duration
  estimates — steps have no duration field, by design.
- Set \`holdPoint: true\` on a step that can be finished well ahead of service.
  Everything downstream of one is last-minute work.
- Gather serving work (laying the table, plating, carrying out) into its own
  component, and let it depend on every finishing step of the course.

## Fields

- \`station\` is one of exactly these four values. They are fixed identifiers, not
  translatable text:
  - \`"liesi"\` — stovetop / hob
  - \`"uuni"\` — oven
  - \`"grilli"\` — grill
  - \`"muu"\` — everything else: bench work, cold prep, plating. This is the
    default; only name equipment that several dishes might compete for.
- \`deps\` may reference either a step's \`id\` or its \`title\` verbatim. Titles are
  easier and are resolved on import. Keep titles unique within the menu — a
  reference matching two steps is reported as an error rather than guessed.
- \`uses\` lists the ingredients this particular step consumes. Use exactly the
  same strings as the component's \`ingredients\` list.
- \`id\` is optional everywhere. Leave ids out; they are derived from the names.

## Shape

Write the nested form: courses contain components, components contain steps.
Then \`courseId\` and \`componentId\` are not needed at all.

\`\`\`json
{
  "name": "Illallinen",
  "courses": [
    {
      "name": "Alkupala",
      "components": [
        {
          "name": "Kantarellikeitto",
          "ingredients": ["kantarelleja (n. 500 g)", "voita", "iso sipuli"],
          "steps": [
            { "title": "Puhdista ja hienonna kantarellit", "uses": ["kantarelleja (n. 500 g)"] },
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
\`\`\`

Note the last step: a join, waiting on two branches that different cooks can
work on in parallel. Look for those.

## Language

**All content is written in Finnish** — \`name\`, \`title\`, \`detail\`, \`note\` and
\`ingredients\`. The app's interface is Finnish and this text is shown in it
directly. Field names and the \`station\` values stay exactly as spelled above.
If the recipe below is in another language, translate it into Finnish.

Reply with the JSON document only: no commentary, and no text outside it.

Recipe:
`
