// Production bundle for the server (used by the Docker image, not the change gate).
//
// Why bundle: `@chatapp/shared` is consumed as raw TypeScript source (its
// package.json `main` points at `./src/index.ts`), which `tsx`/Vite handle in
// dev but plain `node` cannot. esbuild inlines our own workspace source — the
// server's `src` plus `@chatapp/shared` (and any undeclared transitive like
// `zod`) — into the output, while leaving real npm dependencies external so they
// resolve from `node_modules` at runtime (no native rebuilds, smaller bundle).
//
// Two entry points keep the original `dist` layout: `dist/index.js` (server) and
// `dist/db/migrate.js` (the migration runner invoked by Fly's release command).

import { build } from 'esbuild';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

// Start from a clean dist so a prior `tsc` (per-file) build can't leave stale
// modules alongside the bundle.
rmSync(`${here}dist`, { recursive: true, force: true });

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

// Externalize declared npm dependencies (resolved from node_modules at runtime);
// bundle everything else — crucially `@chatapp/shared`, the whole reason we bundle.
const external = Object.keys(pkg.dependencies).filter(
  (dep) => dep !== '@chatapp/shared',
);

await build({
  entryPoints: ['src/index.ts', 'src/db/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'info',
});

// Migrations are read from disk at runtime (migrate.ts resolves ./migrations
// relative to its own location), so they are not bundled — ship the .sql files
// next to the emitted dist/db/migrate.js.
cpSync(`${here}src/db/migrations`, `${here}dist/db/migrations`, {
  recursive: true,
});
