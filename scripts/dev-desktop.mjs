/**
 * Desktop dev loop: start Vite, wait for the port, then launch Electron.
 * Ctrl-C tears both down.
 */
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = Number(process.env.PORT ?? 5173)

const waitForPort = (port, timeoutMs = 60_000) =>
  new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const socket = createConnection({ port, host: '127.0.0.1' })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - started > timeoutMs) reject(new Error(`Vite did not start on :${port}`))
        else setTimeout(tick, 250)
      })
    }
    tick()
  })

const run = (cmd, args, env) =>
  spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' })

const build = run(process.execPath, [path.join(root, 'scripts/build-electron.mjs')])
await new Promise((resolve, reject) => build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('electron build failed')))))

const vite = run('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT)], {})
let electron

const shutdown = () => {
  electron?.kill()
  vite.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
vite.on('exit', (code) => {
  if (code) shutdown()
})

await waitForPort(PORT)
console.log('vite is up, launching electron…')
electron = run('npx', ['electron', '.'], { ELECTRON_DEV: '1', VITE_DEV_SERVER_URL: `http://localhost:${PORT}` })
electron.on('exit', shutdown)
