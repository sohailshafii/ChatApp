import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend lives entirely under `/api` (REST + the `/api/ws` WebSocket); see
// issue #75. Same-origin in production; in dev we proxy `/api` to the server
// (:8080) so cookies stay first-party. Because client routes no longer share the
// API's path prefix, the SPA fallback serves `index.html` for everything else —
// so hard reload / deep link to `/conversations/:id` just works (no bypass hack).
const API_TARGET = 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // ws:true upgrades the `/api/ws` WebSocket connection through the proxy.
      '/api': { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
});
