import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// Builds the real renderer into the marketing site's public folder.
// A separate base is used here so the root app build keeps base './' for Electron.
export default defineConfig({
  root: repoRoot,
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./public/app', import.meta.url)),
    emptyOutDir: true,
  },
})
