# syntax=docker/dockerfile:1.7
# One Dockerfile, one target per deployable: api, worker, web, guest.
#   docker build -f infrastructure/docker/Dockerfile --target api -t hotel-api .
# Images run as a non-root user, contain production dependencies only, and hold no secrets
# (configuration comes from the environment / secret manager at runtime).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# ---- dependencies + build ---------------------------------------------------------------
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm build

# Self-contained production bundles for the Node services.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --legacy --filter @hotel/api --prod /out/api && \
    pnpm deploy --legacy --filter @hotel/worker --prod /out/worker

# ---- api --------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
USER node
EXPOSE 48100
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||48100)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---- worker -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/worker ./
USER node
CMD ["node", "dist/main.js"]

# ---- migrate (one-off task run before each deploy; uses the owner role) -----------------
FROM build AS migrate
WORKDIR /repo/packages/database
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/seed/run.js"]

# ---- web --------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS web
ENV NODE_ENV=production PORT=43100 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 43100
CMD ["node", "apps/web/server.js"]

# ---- guest ------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS guest
ENV NODE_ENV=production PORT=43200 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/guest/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/guest/.next/static ./apps/guest/.next/static
COPY --from=build --chown=node:node /repo/apps/guest/public ./apps/guest/public
USER node
EXPOSE 43200
CMD ["node", "apps/guest/server.js"]
