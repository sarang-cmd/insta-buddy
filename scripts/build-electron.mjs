/** Bundles the Electron main + preload processes with esbuild. */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const watch = process.argv.includes('--watch')

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'info',
  sourcemap: true,
  minify: false,
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
}

await Promise.all([
  build({ ...shared, entryPoints: [path.join(root, 'electron/main.ts')], outfile: path.join(root, 'electron/dist/main.cjs') }),
  build({ ...shared, entryPoints: [path.join(root, 'electron/preload.ts')], outfile: path.join(root, 'electron/dist/preload.cjs') }),
])

if (watch) console.log('build-electron: one-shot (rerun after changes)')
console.log('electron bundles written to electron/dist')
