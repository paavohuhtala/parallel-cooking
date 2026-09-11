import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * One real server per Playwright worker, each with its own SQLite file, so
 * tests can run fully parallel without sharing a room table. This is why there
 * is no `webServer` in the Playwright config: that would give every worker the
 * same process, and the app is deliberately single-replica (SQLite is a single
 * writer and the socket fan-out is in-process), so sharing one would serialise
 * the suite and let one test's rooms show up in another's.
 *
 * The server has no build step — Node runs the .ts entry directly — so this
 * spawns exactly what `pnpm start` does.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ENTRY = path.join(REPO_ROOT, 'src', 'server', 'main.ts')

const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 5_000
const POLL_INTERVAL_MS = 50
/** A lost race for a reserved port is worth retrying; a broken server is not. */
const START_ATTEMPTS = 3

export interface BackendServer {
  readonly url: string
  readonly port: number
  readonly dataDir: string
  /** Everything the process has written so far, for failure messages. */
  output: () => string
  stop: () => Promise<void>
}

export interface BackendOptions {
  /** Extra environment for the server process; wins over the defaults. */
  env?: Record<string, string>
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Ask the OS for a free port and hand it straight back. There is a window in
 * which somebody else can take it before the server binds, which is what
 * `START_ATTEMPTS` is for.
 */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close()
        reject(new Error('Could not read the probe socket address.'))
        return
      }
      const { port } = address
      probe.close(() => resolve(port))
    })
  })
}

async function healthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1_000) })
    return res.ok
  } catch {
    return false
  }
}

const running = (child: ChildProcess): boolean =>
  child.exitCode === null && child.signalCode === null

async function terminate(child: ChildProcess): Promise<void> {
  if (!running(child)) return
  child.kill('SIGTERM')
  const hard = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS)
  try {
    await once(child, 'exit')
  } finally {
    clearTimeout(hard)
  }
}

/**
 * The developer's own shell must not decide what a test server does, so the
 * variables the server reads are cleared before ours are put back.
 */
function serverEnv(port: number, dataDir: string, overrides: Record<string, string>) {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of [
    'PORT',
    'DATA_DIR',
    'NODE_ENV',
    'BASIC_AUTH_USER',
    'BASIC_AUTH_PASS',
    'MENU_FOLLOW_TEMPLATE',
    'DEV_CLIENT_URL',
  ]) {
    delete env[key]
  }
  return {
    ...env,
    PORT: String(port),
    DATA_DIR: dataDir,
    NODE_ENV: 'test',
    // A test asserts on the menu its room was created from. Following the code
    // template on boot is a development convenience, not something to test
    // against.
    MENU_FOLLOW_TEMPLATE: '0',
    ...overrides,
  }
}

type Attempt =
  | { ok: true; server: BackendServer }
  | { ok: false; message: string; portTaken: boolean }

async function launch(options: BackendOptions): Promise<Attempt> {
  const port = await reservePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'parallel-cooking-e2e-'))
  const url = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, [ENTRY], {
    cwd: REPO_ROOT,
    env: serverEnv(port, dataDir, options.env ?? {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  const record = (chunk: string) => {
    output += chunk
    if (process.env.E2E_SERVER_LOG === '1') process.stdout.write(`[server:${port}] ${chunk}`)
  }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', record)
  child.stderr.on('data', record)

  const cleanUp = () => {
    if (process.env.E2E_KEEP_DATA === '1') return
    // Windows keeps the SQLite handles until the process is really gone, hence
    // the retries.
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }

  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!running(child)) break
    if (await healthy(url)) {
      return {
        ok: true,
        server: {
          url,
          port,
          dataDir,
          output: () => output,
          stop: async () => {
            await terminate(child)
            cleanUp()
          },
        },
      }
    }
    await delay(POLL_INTERVAL_MS)
  }

  // Read the reason before killing it, or every failure looks like an exit.
  const why = running(child)
    ? 'did not answer /healthz in time'
    : `exited with code ${child.exitCode}`
  await terminate(child)
  cleanUp()
  return {
    ok: false,
    message: `Server on port ${port} ${why}.\n${output}`,
    portTaken: output.includes('EADDRINUSE'),
  }
}

export async function startBackend(options: BackendOptions = {}): Promise<BackendServer> {
  let last = ''
  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
    const result = await launch(options)
    if (result.ok) return result.server
    last = result.message
    // Anything other than a lost port race will fail again the same way.
    if (!result.portTaken) break
  }
  throw new Error(`Could not start the e2e backend.\n${last}`)
}
