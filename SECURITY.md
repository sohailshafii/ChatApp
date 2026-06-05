# Security

## Accepted dependency advisories

Tracked here so they aren't re-litigated on every `npm install`. Re-evaluate
when the fix becomes non-breaking, or when our usage changes.

### Vitest / Vite / esbuild dev-tooling chain — accepted 2026-06-05

`npm audit` reports 5 advisories (4 moderate, 1 critical), **all** in the
`vitest → @vitest/mocker → vite → esbuild` / `vite-node` chain:

| Advisory | Severity | Affected |
|---|---|---|
| Vitest UI server can read & execute arbitrary files (GHSA — `vitest`) | critical | `vitest <= 4.1.0-beta.6` |
| Vite path traversal in optimized-deps `.map` handling | moderate | `vite <= 6.4.1` |
| esbuild dev server lets any site read responses (GHSA-67mh-4wv8-2f99) | moderate | `esbuild <= 0.24.2` |
| Transitive via the above (`@vitest/mocker`, `vite-node`) | moderate | — |

**Why accepted (not currently exploitable in this project):**

- **Dev-only.** Vitest, Vite, and esbuild are dev/test dependencies. Production
  artifacts ship none of them — the server `build` excludes test files
  (`tsconfig.build.json`), and Vite is a build tool, not a runtime dependency.
- **The critical needs the Vitest UI server.** It applies only when running
  `vitest --ui` with that server reachable. We run `vitest run` everywhere
  (CI and local); the UI server is never started.
- **The dev-server advisories are local-only.** The esbuild/Vite issues require
  a malicious web page to reach a developer's *local* dev server. They are not a
  deployed/production attack surface.

**Why not fixed yet:** there is no non-breaking fix. Clearing them requires
`vitest` 2 → 4 (both `apps/server` and `apps/web`) **and** `vite` 5 → 7/8
(`apps/web`) — breaking majors that touch the web bundler. Deferred as a
deliberate, low-risk-for-now call; do the upgrade as its own coordinated PR
(verify both test suites, all typechecks, and the web build) when convenient.

**Fix when ready:**

```bash
# Bump in apps/server/package.json and apps/web/package.json:
#   "vitest": "^4"   (both)        "vite": "^7"  (apps/web)
npm install
npm run typecheck && npm test && npm run build -w @chatapp/web
npm audit   # expect: 0 vulnerabilities
```
