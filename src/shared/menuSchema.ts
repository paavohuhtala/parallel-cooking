import { z } from 'zod'
import type { LooseMenu } from './menuDoc.ts'

/*
 * Shape validation for an untrusted menu document — and nothing else. What the
 * fields *mean* (filling in ids, resolving dependencies written as titles,
 * cross-checking the graph) lives in `menuDoc.ts`, which is deliberately free of
 * zod so the editor can validate a draft on every keystroke.
 *
 * Like `protocol.ts`, this module pulls zod in, so the client must reach it
 * through `import type` only — `pnpm check:bundle` fails the build if it leaks.
 *
 * One schema serves both jobs. An import is a loose document; a save from the
 * editor is a canonical one, which is just a loose document with every optional
 * field already filled in. Normalising the canonical form is the identity (there
 * is a test), so there is no second schema to keep in step.
 */

const Title = z.string().trim().min(1).max(160)
const Id = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z0-9_-]+$/, 'Tunnus saa sisältää vain kirjaimia, numeroita, - ja _.')

const StationSchema = z
  .enum(['liesi', 'uuni', 'grilli', 'muu'])
  .default('muu')
  .meta({
    description:
      'Missä työ fyysisesti tapahtuu. Vain rajallinen välineistö kannattaa nimetä; ' +
      'kaikki muu (penkkityö, kylmävalmistelu, annostelu) on "muu".',
  })

const StepSchema = z
  .object({
    id: Id.optional().meta({
      description: 'Valinnainen. Puuttuessa se johdetaan otsikosta.',
    }),
    componentId: Id.optional().meta({
      description: 'Vain litteässä muodossa; sisäkkäisessä se tulee ympäröivästä osasta.',
    }),
    title: Title.meta({ description: 'Lyhyt käskymuoto, esim. "Kuori ja pilko sipuli".' }),
    detail: z.string().max(4000).optional().meta({
      description:
        'Koko ohjeteksti. Kypsennysajat kuuluvat tänne — vaiheilla ei ole kestoa.',
    }),
    station: StationSchema,
    deps: z
      .array(z.string().trim().min(1))
      .default([])
      .meta({
        description:
          'Vaiheet, joiden on oltava valmiita ennen tätä. Joko vaiheen tunnus tai ' +
          'sen otsikko sellaisenaan — otsikot ratkaistaan tunnuksiksi tuonnissa.',
      }),
    uses: z.array(z.string().trim().min(1)).optional().meta({
      description: 'Tämän vaiheen kuluttamat ainekset; poimittu osan ainesluettelosta.',
    }),
    holdPoint: z.boolean().optional().meta({
      description:
        'Tosi, kun vaiheen voi tehdä hyvissä ajoin valmiiksi. Kaikki tämän jälkeen ' +
        'tuleva on viime hetken työtä.',
    }),
  })
  .meta({ id: 'Step', title: 'Vaihe', description: 'Yksi atominen työsuoritus.' })

const ComponentSchema = z
  .object({
    id: Id.optional(),
    courseId: Id.optional().meta({
      description: 'Vain litteässä muodossa; sisäkkäisessä se tulee ympäröivästä ruokalajista.',
    }),
    name: z.string().trim().min(1).max(120),
    ingredients: z.array(z.string().trim().min(1)).default([]),
    note: z.string().max(2000).optional(),
    steps: z.array(StepSchema).optional().meta({
      description: 'Sisäkkäinen muoto. Jätä pois, jos vaiheet ovat menun juuressa.',
    }),
  })
  .meta({
    id: 'Component',
    title: 'Osa',
    description: 'Yksi ruokalajin osa — käytännössä yksi ruoka tai lisuke.',
  })

const CourseSchema = z
  .object({
    id: Id.optional(),
    order: z.number().int().positive().optional().meta({
      description: 'Valinnainen. Puuttuessa se on ruokalajin järjestysnumero taulukossa.',
    }),
    name: z.string().trim().min(1).max(120),
    note: z.string().max(2000).optional(),
    components: z.array(ComponentSchema).optional().meta({
      description: 'Sisäkkäinen muoto. Jätä pois, jos osat ovat menun juuressa.',
    }),
  })
  .meta({ id: 'Course', title: 'Ruokalaji', description: 'Yksi tarjoiltava ruokalaji.' })

/**
 * Both accepted shapes in one object rather than a union of two: a root `anyOf`
 * generates a JSON Schema that reads badly, whereas one object whose nested and
 * flat halves are each optional reads as "here is the shape, these parts are
 * optional" — which is what an agent needs.
 */
export const MenuDocSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    courses: z.array(CourseSchema).min(1),
    components: z.array(ComponentSchema).optional().meta({
      description: 'Litteä muoto. Käytä joko tätä tai ruokalajien sisäkkäisiä osia.',
    }),
    steps: z.array(StepSchema).optional().meta({
      description: 'Litteä muoto. Käytä joko tätä tai osien sisäkkäisiä vaiheita.',
    }),
  })
  .meta({
    id: 'Menu',
    title: 'Menu',
    description:
      'Monen ruokalajin illallinen, purettuna vaiheiksi ja niiden välisiksi ' +
      'riippuvuuksiksi. Kirjoita joko sisäkkäisessä tai litteässä muodossa.',
  })

export type MenuDocInput = z.infer<typeof MenuDocSchema>

/** The parsed document is exactly what the normalizer consumes. */
const _assignable: (doc: MenuDocInput) => LooseMenu = (doc) => doc
void _assignable

export const UpdateMenuSchema = z.object({
  /** The version the editor last saw; a mismatch is a 409 rather than a clobber. */
  expectedVersion: z.number().int().nonnegative(),
  menu: MenuDocSchema,
})

export const ImportMenuSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  /** Validate and report without writing anything — the import preview. */
  dryRun: z.boolean().optional(),
  doc: MenuDocSchema,
})

export const CreateMenuSchema = z.union([
  z.object({ name: z.string().trim().min(1).max(120) }),
  z.object({ name: z.string().trim().max(120).optional(), templateId: z.string().min(1) }),
  z.object({ name: z.string().trim().max(120).optional(), fromMenuId: z.string().min(1) }),
  z.object({ name: z.string().trim().max(120).optional(), fromRoomId: z.string().min(1) }),
])
