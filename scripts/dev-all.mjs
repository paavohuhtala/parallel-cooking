// Runs the API server and Vite side by side and makes one Ctrl-C stop both.
//
// This used to be a single shell line (`trap 'kill 0' ...; node --watch ... &
// vite`), which only holds on POSIX: both npm and pnpm run scripts through
// cmd.exe on Windows, where `;` is an argument separator rather than a command
// one and `&` means "run the next command", not "background this one". The
// server silently never started and every /api call came back ECONNREFUSED
// through the Vite proxy. Plain Node keeps it to zero dependencies.
import { spawn } from 'node:child_process'

const isWindows = process.platform === 'win32'

const children = []
let shuttingDown = false

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  process.exitCode = code
  for (const { child } of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    // A shim spawns the real node as a grandchild, so child.kill() would reach
    // only the shim and leave the port held. taskkill /T takes the whole tree.
    if (isWindows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
}

// `shell` is only for the .bin shims, which are .CMD files on Windows and so
// cannot be spawned directly. Node itself is spawned without one, which also
// keeps args away from the shell (DEP0190).
function start(name, command, args, { shell = false, env = {} } = {}) {
  const child = spawn(command, args, { stdio: 'inherit', shell, env: { ...process.env, ...env } })
  child.on('error', (err) => {
    console.error(`[dev:all] could not start ${name}: ${err.message}`)
    shutdown(1)
  })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.error(`[dev:all] ${name} exited (${signal ?? code}); stopping the other`)
    shutdown(code ?? 1)
  })
  children.push({ name, child })
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0))

// The server would otherwise also serve the client from dist/, which is only as
// fresh as the last `pnpm build` or e2e run — so :8080 looked like the app and
// showed yesterday's code. It redirects page loads to Vite instead; the port is
// pinned with strictPort in vite.config.ts, so it cannot drift from this one.
start('server', 'node', ['--watch', 'src/server/main.ts'], {
  env: { DEV_CLIENT_URL: 'http://localhost:5173' },
})
start('vite', 'vite', [], { shell: isWindows })
