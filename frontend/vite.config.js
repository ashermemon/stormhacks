import { defineConfig } from 'vite';

// In dev, the page is served by Vite; forward /ws to the game server so the
// frontend can use the same page-relative ws URL as in production.
export default defineConfig({
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8765', ws: true },
    },
  },
});
