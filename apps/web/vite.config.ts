import type { IncomingMessage } from 'node:http';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend's REST + WebSocket endpoints. Same-origin in production; in dev we
// proxy them to the server (:8080) so cookies stay first-party and the SPA
// fallback doesn't swallow API paths. Keep this list in sync as new top-level
// API paths are added. See REQUIREMENTS.md §security.
const API_TARGET = 'http://localhost:8080';

// `/conversations/:id` is both a client route (React Router) and an API path.
// A top-level page navigation (hard reload / deep link) would otherwise be
// proxied to the API and render raw JSON. Detect HTML navigations by their
// Accept header and serve the SPA shell instead, so React Router takes over;
// the page's own fetch (no `text/html`) still proxies to the API.
function spaAwareApiProxy(target: string) {
  return {
    target,
    changeOrigin: true,
    bypass(req: IncomingMessage) {
      if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
        return '/index.html';
      }
    },
  };
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': { target: API_TARGET, changeOrigin: true },
      '/conversations': spaAwareApiProxy(API_TARGET),
      '/bots': { target: API_TARGET, changeOrigin: true },
      '/push': { target: API_TARGET, changeOrigin: true },
      // WebSocket messaging (§3): ws:true upgrades the connection through the proxy.
      '/ws': { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
});
