import type { FastifyInstance } from 'fastify';

// Liveness probe. Intentionally does not touch the database — it answers
// "is the process up and serving HTTP", which is what Fly's health check and
// the dev loop want. A DB-readiness probe can come later as /readyz.
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ status: 'ok' }));
}
