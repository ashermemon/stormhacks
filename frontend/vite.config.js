import { defineConfig } from 'vite';

// In dev, the page is served by Vite; forward /ws to the game server so the
// frontend can use the same page-relative ws URL as in production.
// To run against a local backend instead, use: 'ws://localhost:8765'
const BACKEND = 'wss://konstantin-macbook-6.miku-harmonic.ts.net';

export default defineConfig({
  server: {
    proxy: {
      '/ws': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
});
