#!/usr/bin/env bash
set -euo pipefail

# Build and exercise a disposable pilot container. This script never points at
# a production database and removes only the uniquely named container/volume it
# creates. The built image is intentionally retained for local inspection.
smoke_image="${FACTORY_SMOKE_IMAGE:-factory:st-162-smoke}"
smoke_suffix="${FACTORY_SMOKE_ID:-$(date +%s)-$$}"
smoke_revision="${FACTORY_SMOKE_REVISION:-local-dirty}"
smoke_container="factory-st162-smoke-${smoke_suffix}"
smoke_volume="factory-st162-smoke-${smoke_suffix}"
smoke_container_created=false
smoke_volume_created=false

cleanup() {
  if [[ "$smoke_container_created" == true ]]; then
    docker rm --force "$smoke_container" >/dev/null 2>&1 || true
  fi
  if [[ "$smoke_volume_created" == true ]]; then
    docker volume rm "$smoke_volume" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if docker container inspect "$smoke_container" >/dev/null 2>&1; then
  echo "Refusing to reuse existing smoke-test container: $smoke_container" >&2
  exit 1
fi
if docker volume inspect "$smoke_volume" >/dev/null 2>&1; then
  echo "Refusing to reuse existing smoke-test volume: $smoke_volume" >&2
  exit 1
fi

docker build \
  --platform linux/amd64 \
  --build-arg "FACTORY_REVISION=${smoke_revision}" \
  --tag "$smoke_image" \
  .
docker volume create "$smoke_volume" >/dev/null
smoke_volume_created=true

# The initializer is an explicit one-off command. Normal service startup below
# still requires the snapshot and therefore cannot silently create a database.
docker run --rm \
  --platform linux/amd64 \
  --entrypoint bun \
  --env FACTORY_ENVIRONMENT=pilot \
  --env FACTORY_DB=/data/factory.sqlite \
  --mount "type=volume,source=${smoke_volume},target=/data" \
  "$smoke_image" \
  scripts/init-pilot.ts --database /data/factory.sqlite

smoke_container_id="$(docker run --detach \
  --platform linux/amd64 \
  --name "$smoke_container" \
  --init \
  --env FACTORY_ENVIRONMENT=pilot \
  --env FACTORY_REQUIRE_EXISTING_DB=true \
  --env FACTORY_HOST=0.0.0.0 \
  --env FACTORY_PORT=3101 \
  --env FACTORY_DB=/data/factory.sqlite \
  --mount "type=volume,source=${smoke_volume},target=/data" \
  "$smoke_image")"
smoke_container_created=true

wait_for_health() {
  local health_status
  for _ in $(seq 1 60); do
    health_status="$(docker inspect --format '{{.State.Health.Status}}' "$smoke_container_id" 2>/dev/null || true)"
    if [[ "$health_status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$health_status" == "unhealthy" ]]; then
      docker logs "$smoke_container_id"
      return 1
    fi
    sleep 1
  done
  docker logs "$smoke_container_id"
  echo "Timed out waiting for the Factory readiness healthcheck." >&2
  return 1
}

assert_http_ok() {
  local path="$1"
  docker exec "$smoke_container_id" bun -e "fetch('http://127.0.0.1:3101${path}').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"
}

wait_for_health
[[ "$(docker exec "$smoke_container_id" id -u)" == "1000" ]]
assert_http_ok /healthz
assert_http_ok /readyz
assert_http_ok /version
assert_http_ok /main.js

# A restart against the same named volume proves the service does not depend
# on an ephemeral container filesystem for the seeded snapshot.
docker restart "$smoke_container_id" >/dev/null
wait_for_health
assert_http_ok /readyz

echo "Container smoke passed: $smoke_image ($smoke_volume was removed on exit)."
