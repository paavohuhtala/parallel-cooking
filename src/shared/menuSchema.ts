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
      'Where the work physically happens. Only name equipment several dishes might ' +
      'compete for; bench work, cold prep and plating are all "muu". ' +
      'liesi = stovetop, uuni = oven, grilli = grill, muu = anything else.',
  })

const StepSchema = z
  .object({
    id: Id.optional().meta({
      description: 'Optional; derived from the title when omitted.',
    }),
    componentId: Id.optional().meta({
      description: 'Flat form only; the nested form takes it from the enclosing component.',
    }),
    title: Title.meta({
      description: 'A short imperative, in Finnish. E.g. "Kuori ja pilko sipuli".',
    }),
    detail: z.string().max(4000).optional().meta({
      description:
        'The full instruction, in Finnish. Cooking times belong here — steps have no ' +
        'duration field.',
    }),
    station: StationSchema,
    deps: z
      .array(z.string().trim().min(1))
      .default([])
      .meta({
        description:
          'Steps that must be finished before this one may start. Either a step id or a ' +
          'step title verbatim; titles are resolved to ids on import, and a title ' +
          'matching two steps is an error rather than a guess.',
      }),
    uses: z.array(z.string().trim().min(1)).optional().meta({
      description:
        "Ingredients this step consumes, spelled exactly as in the component's " +
        'ingredients list.',
    }),
    holdPoint: z.boolean().optional().meta({
      description:
        'True when the step can be finished well ahead of service. Everything ' +
        'downstream of a hold point is last-minute work.',
    }),
  })
  .meta({
    id: 'Step',
    title: 'Vaihe (step)',
    description: 'One atomic piece of work: what one cook must finish in one go.',
  })

const ComponentSchema = z
  .object({
    id: Id.optional(),
    courseId: Id.optional().meta({
      description: 'Flat form only; the nested form takes it from the enclosing course.',
    }),
    name: z.string().trim().min(1).max(120),
    ingredients: z.array(z.string().trim().min(1)).default([]),
    note: z.string().max(2000).optional(),
    steps: z.array(StepSchema).optional().meta({
      description: 'Nested form. Omit when the steps live at the root of the menu instead.',
    }),
  })
  .meta({
    id: 'Component',
    title: 'Osa (component)',
    description: 'One part of a course — in practice one dish or side.',
  })

const CourseSchema = z
  .object({
    id: Id.optional(),
    order: z.number().int().positive().optional().meta({
      description: 'Optional; defaults to the course position in the array.',
    }),
    name: z.string().trim().min(1).max(120),
    note: z.string().max(2000).optional(),
    components: z.array(ComponentSchema).optional().meta({
      description: 'Nested form. Omit when the components live at the root of the menu.',
    }),
  })
  .meta({ id: 'Course', title: 'Ruokalaji (course)', description: 'One course of the dinner.' })

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
      description: 'Flat form. Use either this or the components nested inside courses.',
    }),
    steps: z.array(StepSchema).optional().meta({
      description: 'Flat form. Use either this or the steps nested inside components.',
    }),
  })
  .meta({
    id: 'Menu',
    title: 'Menu',
    description:
      'A multi-course dinner broken into atomic steps and the dependencies between ' +
      'them. Write it nested or flat. All content text (names, titles, details, ' +
      'ingredients) is in Finnish; field names and station values are not.',
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
