import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = process.env.PROXY_TARGET ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  // Absolute, not './': room URLs are nested (/r/<id>), and relative asset
  // paths would resolve against that segment instead of the site root.
  base: '/',
  server: {
    // dev:all redirects :8080 page loads here, so a busy port must be an error
    // rather than a silent move to 5174 — usually it is a dev server left over.
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target },
      '/healthz': { target },
      '/ws': { target, ws: true },
    },
  },
})
