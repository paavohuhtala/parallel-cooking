import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).default(8080),
  DATA_DIR: z.string().min(1).default('./data'),
  NODE_ENV: z.string().default('development'),
  BASIC_AUTH_USER: z.string().min(1).optional(),
  BASIC_AUTH_PASS: z.string().min(1).optional(),
  /** '1' or '0'; defaults to on outside production. */
  MENU_FOLLOW_TEMPLATE: z.enum(['0', '1']).optional(),
  DEV_CLIENT_URL: z.url().optional(),
})

function read() {
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`)
  }
  const env = parsed.data

  // Fail closed. Half-configured auth in a cluster is the failure you do not
  // want to discover by finding the app open to the world.
  const user = env.BASIC_AUTH_USER
  const pass = env.BASIC_AUTH_PASS
  if (Boolean(user) !== Boolean(pass)) {
    throw new Error(
      'BASIC_AUTH_USER and BASIC_AUTH_PASS must be set together, or neither (open, for local dev).',
    )
  }

  const production = env.NODE_ENV === 'production'

  return {
    port: env.PORT,
    dataDir: env.DATA_DIR,
    production,
    auth: user && pass ? { user, pass } : null,
    /**
     * When set, rooms keep tracking the code template their menu came from, so
     * editing `src/data/menu.ts` shows up on the next server restart. Off in
     * production: a redeploy must never rewrite a dinner in progress.
     */
    followTemplate: env.MENU_FOLLOW_TEMPLATE
      ? env.MENU_FOLLOW_TEMPLATE === '1'
      : !production,
    /**
     * Origin of a Vite dev server. When set, this process leaves the client to
     * it and redirects page loads there instead of serving `dist/`, which in
     * development is whatever the last `pnpm build` or e2e run left behind.
     */
    devClientUrl: env.DEV_CLIENT_URL?.replace(/\/$/, '') ?? null,
  }
}

export const config = read()
export type Config = ReturnType<typeof read>
