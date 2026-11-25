import { defineConfig } from 'vite'

// The dashboard talks to M2 only (REST + WebSocket). In development Vite proxies to the M2 service.
export default defineConfig({
  server: {
    port: 5180,
    proxy: {
      '/api': 'http://127.0.0.1:8010',
      '/m1': 'http://127.0.0.1:8010',
      '/ws': { target: 'ws://127.0.0.1:8010', ws: true },
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
})
