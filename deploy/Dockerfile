# ==========================================================
# LÉLU — PRODUCTION IMAGE
#
# Two stages, on purpose:
#
#   build    installs dependencies and runs the real production
#            build (`tsc -b && vite build`). `VITE_*` values are
#            inlined into the bundle here, so the client-visible ones
#            must be present in `.env` BEFORE this stage runs.
#
#   runtime  copies the built app and runs `bun server.ts` — the same
#            entry point `bun run serve` uses. Server-only secrets are
#            NOT baked in: `.env`/`.env.local` are deleted from the
#            runtime layer and supplied at run time (compose
#            `env_file`, or systemd `EnvironmentFile`).
#
# Build:
#   docker build -f deploy/Dockerfile -t lelu:1.1 .
# Run:
#   docker compose -f deploy/docker-compose.yml up -d
# ==========================================================

FROM oven/bun:1.4-debian AS build
WORKDIR /app

# Dependencies first, so a source change does not re-resolve them.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
# The build reads .env for the VITE_ (client-visible) values it inlines.
RUN bun run build

# ---- runtime -----------------------------------------------------------
FROM oven/bun:1.4-debian AS runtime

# curl is used only by the container healthcheck below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The whole app, because `server.ts` mounts real plugins that import real
# application code — this is a runtime, not a static bundle server.
COPY --from=build /app /app

# NEVER ship secrets in the image. Anything needed server-side arrives at
# run time; anything needed at build time is already inlined in dist/.
RUN rm -f /app/.env /app/.env.local /app/.env.production /app/.env.development

# Runtime state that must survive a restart (see docs/CONTABO_DEPLOYMENT.md).
RUN mkdir -p /app/data && chown -R bun:bun /app/data

ENV NODE_ENV=production \
    PORT=4173

USER bun
EXPOSE 4173

# A real readiness probe: `dist/` missing or the router wedged both fail here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/env-check" > /dev/null || exit 1

# Signals reach node directly (no shell), so SIGTERM stops the listener
# instead of leaving a shell alive and the server orphaned.
STOPSIGNAL SIGTERM
CMD ["bun", "server.ts"]
