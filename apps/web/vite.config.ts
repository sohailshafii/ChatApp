import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend's REST + WebSocket endpoints. Same-origin in production; in dev we
// proxy them to the server (:8080) so cookies stay first-party and the SPA
// fallback doesn't swallow API paths. Keep this list in sync as new top-level
// API paths are added. See REQUIREMENTS.md §security.
const API_TARGET = 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': { target: API_TARGET, changeOrigin: true },
      '/conversations': { target: API_TARGET, changeOrigin: true },
      '/bots': { target: API_TARGET, changeOrigin: true },
      '/push': { target: API_TARGET, changeOrigin: true },
      // WebSocket messaging (§3): ws:true upgrades the connection through the proxy.
      '/ws': { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
});
