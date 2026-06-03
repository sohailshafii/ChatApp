import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Auth (and future API) calls are same-origin in production; in dev we
      // proxy them to the backend so cookies stay first-party. See REQUIREMENTS.md §security.
      '/auth': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
