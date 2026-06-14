import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

// Single-origin production serving (#75): the server serves the built web SPA at
// the root while the API lives under /api. In dev/test this is skipped entirely
// (Vite serves the SPA), so behaviour there is unchanged.

// Decide whether an unmatched request should fall back to the SPA's index.html
// (client-side routing) or get a JSON 404. Only GET navigations outside the
// server's own namespaces fall back; anything under /api (REST + /api/ws) or the
// /healthz probe keeps a real 404 so a mistyped endpoint never returns HTML.
export function isSpaFallback(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const pathname = url.split('?', 1)[0] ?? url;
  if (pathname === '/healthz') return false;
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  return true;
}

// Registers static file serving for the SPA plus the index.html fallback, but
// only when a built web dist directory is actually present (production image).
// Returns whether it was enabled, for logging.
export function registerSpa(
  app: FastifyInstance,
  webDistDir: string | undefined,
): boolean {
  if (!webDistDir || !existsSync(path.join(webDistDir, 'index.html'))) {
    return false;
  }

  // wildcard:false serves real files by path and lets misses fall through to the
  // notFound handler, where we serve index.html for SPA routes (the canonical
  // @fastify/static SPA recipe).
  app.register(fastifyStatic, { root: webDistDir, wildcard: false });

  app.setNotFoundHandler((request, reply) => {
    if (isSpaFallback(request.method, request.url)) {
      return reply.sendFile('index.html');
    }
    return reply
      .code(404)
      .send({ error: { code: 'not_found', message: 'Not found' } });
  });

  return true;
}
