import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = process.env.PROXY_TARGET ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  // Absolute, not './': room URLs are nested (/r/<id>), and relative asset
  // paths would resolve against that segment instead of the site root.
  base: '/',
  server: {
    proxy: {
      '/api': { target },
      '/healthz': { target },
      '/ws': { target, ws: true },
    },
  },
})
