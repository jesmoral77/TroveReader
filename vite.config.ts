import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'

/** Serves ./demo at /demo during `vite dev` only (browser development backend). */
function demoFiles(): Plugin {
  const root = join(__dirname, 'demo')
  return {
    name: 'trove-demo-files',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/demo', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^([/\\])+/, '')
        const file = join(root, rel)
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Length', statSync(file).size)
        createReadStream(file).pipe(res)
      })
    },
  }
}

const host = process.env.TAURI_DEV_HOST

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react(), demoFiles()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'es2022',
    minify: !process.env.TAURI_ENV_DEBUG ? 'oxc' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 4000,
  },
  worker: { format: 'es' },
})
