import { build } from 'vite'
import { REPO_ROOT } from './server.ts'

/**
 * Every worker's server serves `dist/`, the same way production does, so the
 * client is built once here rather than per worker. Testing the built bundle
 * also means there is no Vite dev server and no proxy in the picture: one
 * origin per worker, which is what makes the WebSocket work without any
 * test-only wiring.
 *
 * Set `E2E_SKIP_BUILD=1` to reuse an existing `dist/` while iterating on tests.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SKIP_BUILD === '1') {
    console.log('[e2e] E2E_SKIP_BUILD=1, using the existing dist/')
    return
  }
  const started = Date.now()
  await build({ root: REPO_ROOT, logLevel: 'warn' })
  console.log(`[e2e] client built in ${Date.now() - started} ms`)
}
