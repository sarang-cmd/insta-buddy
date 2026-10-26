import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const siteRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: siteRoot,
  base: '/',
  publicDir: 'public',
  server: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443 },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(siteRoot, 'index.html'),
        demo: resolve(siteRoot, 'demo.html'),
        terms: resolve(siteRoot, 'terms.html'),
        privacy: resolve(siteRoot, 'privacy.html'),
      },
    },
  },
})
