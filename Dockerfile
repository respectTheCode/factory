# syntax=docker/dockerfile:1

# Pin both the Bun release and the platform manifest.  The amd64 manifest was
# verified with `docker buildx imagetools inspect oven/bun:1.3.14`.
FROM --platform=linux/amd64 oven/bun:1.3.14@sha256:50317d83cd5a5ae1d8b35b3379c69f57ce1a0dbf4def91f0965653d767851834 AS build

WORKDIR /app
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ARG FACTORY_REVISION

COPY . .
RUN bun install --frozen-lockfile

RUN bun scripts/build-revision.ts
RUN bun run build
USER bun
RUN FACTORY_REVISION= bun test \
      tests/transport/factory-server-config.test.ts \
      tests/transport/factory-human-session.test.ts \
      tests/transport/serialized-writes.test.ts \
      tests/transport/factory-server-runtime.test.ts \
      tests/persistence/backup-snapshot.test.ts \
      tests/persistence/backup-loop.test.ts

FROM --platform=linux/amd64 oven/bun:1.3.14@sha256:50317d83cd5a5ae1d8b35b3379c69f57ce1a0dbf4def91f0965653d767851834 AS runtime

WORKDIR /app
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 \
    NODE_ENV=production \
    FACTORY_ENVIRONMENT=production \
    FACTORY_HOST=0.0.0.0 \
    FACTORY_PORT=3101 \
    FACTORY_DB=/data/factory.sqlite \
    FACTORY_REQUIRE_EXISTING_DB=true \
    FACTORY_REVISION_FILE=/app/REVISION

LABEL org.opencontainers.image.title="Software Factory" \
      org.opencontainers.image.description="Private, single-writer Factory service"

COPY --from=build --chown=bun:bun /app/REVISION ./REVISION
COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock ./
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/src ./src
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/scripts/init-pilot.ts ./scripts/init-pilot.ts
COPY --from=build --chown=bun:bun /app/scripts/backup-snapshot.ts ./scripts/backup-snapshot.ts
COPY --from=build --chown=bun:bun /app/scripts/backup-loop.ts ./scripts/backup-loop.ts

RUN mkdir -p /data /backups && chown bun:bun /data /backups

VOLUME ["/data"]
EXPOSE 3101
STOPSIGNAL SIGTERM

# Readiness includes the existing-database check and is suitable for a
# single-writer restart gate.  Bun is used for the probe so the runtime image
# needs no curl or wget dependency.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (Bun.env.FACTORY_PORT || '3101') + '/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

USER bun
ENTRYPOINT ["bun", "src/server.ts"]
