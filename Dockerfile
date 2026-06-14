# syntax=docker/dockerfile:1
#
# Single-origin production image for ChatApp: the Fastify server serves the built
# web SPA at the root and the API under /api (#75). Multi-stage — a build stage
# with the full toolchain, then a slim runtime carrying only the bundle, the SPA,
# and the pruned production node_modules.

# ---------- Build stage ----------
FROM node:22-slim AS build
WORKDIR /app

# Toolchain for native deps (argon2). Present only here; the runtime copies the
# already-compiled binding out of node_modules.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install against the lockfile. Copy only manifests first so this layer caches
# until a package.json / package-lock.json changes.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

# Sources + the shared TS base config.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web

# Build the SPA (Vite -> apps/web/dist) and bundle the server (esbuild ->
# apps/server/dist, with the .sql migrations copied in). Both read
# @chatapp/shared as TS source, so there is no separate shared build step.
RUN npm run build -w @chatapp/web \
  && npm run build:bundle -w @chatapp/server

# Strip dev dependencies; only the bundle's runtime externals remain.
RUN npm prune --omit=dev

# ---------- Runtime stage ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app

# Pruned dependency tree + build outputs. packages/shared/package.json is kept so
# the node_modules/@chatapp/shared symlink (unused — the bundle inlined it) does
# not dangle.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist

EXPOSE 8080
USER node

CMD ["node", "apps/server/dist/index.js"]
