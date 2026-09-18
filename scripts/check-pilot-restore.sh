#!/usr/bin/env bash
set -euo pipefail

readonly COMPOSE_PROJECT="factory-pilot-st162-ewgahg"
readonly COMPOSE_SERVICE="factory"
readonly RESTORE_PREFIX="factory-pilot-st163-restore-"
readonly SOURCE_VOLUME="factory-pilot-st162-data"
readonly RESTORE_DATABASE="/restore/latest/factory.sqlite"
readonly RESTORE_MANIFEST="/restore/latest/factory.sqlite.manifest.json"

die() {
  echo "check-pilot-restore: $1" >&2
  exit 1
}

[[ "$#" -eq 1 ]] || die "usage: bash scripts/check-pilot-restore.sh factory-pilot-st163-restore-<id>"
restore_volume="$1"
[[ "$restore_volume" =~ ^factory-pilot-st163-restore-[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "volume must be a new ${RESTORE_PREFIX}* volume."
[[ "$restore_volume" != "$SOURCE_VOLUME" ]] || die "refusing the live pilot volume."
command -v docker >/dev/null 2>&1 || die "docker is required."
command -v date >/dev/null 2>&1 || die "date is required."

volume_name="$(docker volume inspect --format '{{.Name}}' "$restore_volume" 2>/dev/null)" || die "restored volume does not exist; run the Dokploy native restore first."
[[ "$volume_name" == "$restore_volume" ]] || die "restored volume identity could not be confirmed."
attached_containers="$(docker ps -a --filter "volume=${restore_volume}" --format '{{.ID}}' 2>/dev/null)" || die "could not confirm restored volume is unused."
[[ -z "$attached_containers" ]] || die "refusing a restored volume attached to an existing container."

running_factory_listing="$({
  docker ps \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
    --filter "label=com.docker.compose.service=${COMPOSE_SERVICE}" \
    --filter status=running \
    --format '{{.ID}}'
} 2>/dev/null)" || die "could not inspect running pilot containers."
factory_containers=()
while IFS= read -r candidate; do
  [[ -z "$candidate" ]] && continue
  [[ "$candidate" =~ ^[0-9a-f]+$ ]] || die "docker returned an invalid container id."
  factory_containers+=("$candidate")
done <<<"$running_factory_listing"
[[ "${#factory_containers[@]}" -eq 1 ]] || die "expected exactly one running pilot factory container."
factory_container="${factory_containers[0]}"

health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$factory_container" 2>/dev/null)" || die "could not inspect the pilot factory health."
[[ "$health_status" == "healthy" ]] || die "pilot factory is not healthy."

image_id="$(docker inspect --format '{{.Image}}' "$factory_container" 2>/dev/null)" || die "could not resolve the running pilot image."
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die "running pilot image is not an immutable image ID."
docker image inspect "$image_id" >/dev/null 2>&1 || die "running pilot image is unavailable locally."

source_sha="$(docker exec "$factory_container" bun -e '
  const response = await fetch("http://127.0.0.1:3000/version");
  if (!response.ok) throw new Error("version endpoint failed");
  const payload = await response.json();
  if (payload?.environment !== "pilot") throw new Error("wrong environment");
  if (typeof payload?.revision !== "string" || !/^[0-9a-f]{40}$/i.test(payload.revision)) throw new Error("invalid revision");
  process.stdout.write(payload.revision.toLowerCase());
' 2>/dev/null)" || die "pilot /version could not be verified."
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || die "pilot /version did not report a commit SHA."
started_at="$(date +%s)" || die "could not start restore timing."

# Dokploy has already restored this volume. Verify it read-only with the
# running image; the script deliberately never downloads an image or archive.
docker run --rm --pull=never --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m --user bun --entrypoint bun \
  --mount "type=volume,source=${restore_volume},target=/restore,readonly" \
  "$image_id" scripts/backup-snapshot.ts verify \
  --database "$RESTORE_DATABASE" --manifest "$RESTORE_MANIFEST" \
  >/dev/null 2>/dev/null || die "restored snapshot verification failed."

manifest_summary="$(docker run --rm --pull=never --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m --user bun --entrypoint bun \
  --mount "type=volume,source=${restore_volume},target=/restore,readonly" \
  "$image_id" -e '
    const manifest = JSON.parse(await Bun.file("/restore/latest/factory.sqlite.manifest.json").text());
    const collections = manifest?.state?.collections;
    if (!collections || typeof collections !== "object" || Array.isArray(collections)) throw new Error("manifest collections are missing");
    const counts = {};
    for (const [key, value] of Object.entries(collections)) {
      if (!Number.isInteger(value?.count) || value.count < 0) throw new Error("manifest count is invalid");
      counts[key] = value.count;
    }
    const hashes = {
      snapshotSha256: manifest?.snapshot?.sha256,
      contentDigest: manifest?.state?.contentDigest,
      durableIdsDigest: manifest?.state?.durableIdsDigest,
    };
    for (const [key, value] of Object.entries(hashes)) {
      if (typeof value !== "string" || !/^[0-9a-f]{32,128}$/i.test(value)) throw new Error(`manifest ${key} is invalid`);
      hashes[key] = value.toLowerCase();
    }
    process.stdout.write(JSON.stringify({ counts, hashes }));
  ' 2>/dev/null)" || die "restored manifest counts could not be read."

suffix="${restore_volume#"${RESTORE_PREFIX}"}"
drill_volume="factory-pilot-st163-drill-${suffix}"
drill_container="factory-pilot-st163-drill-${suffix}"
if docker container inspect "$drill_container" >/dev/null 2>&1; then die "refusing to reuse existing drill container: ${drill_container}"; fi
if docker volume inspect "$drill_volume" >/dev/null 2>&1; then die "refusing to reuse existing drill volume: ${drill_volume}"; fi

# Keep the fresh drill volume for inspection. Cleanup removes only the created
# container and the in-volume temporary operator secret; the restored volume stays.
docker volume create "$drill_volume" >/dev/null || die "could not create the fresh drill volume."
docker run --rm --pull=never --network none --user root --entrypoint bun \
  --mount "type=volume,source=${restore_volume},target=/source,readonly" \
  --mount "type=volume,source=${drill_volume},target=/restore" \
  "$image_id" -e '
    import { chmod, chown, copyFile, mkdir } from "node:fs/promises";
    await mkdir("/restore/latest", { recursive: true });
    await copyFile("/source/latest/factory.sqlite", "/restore/latest/factory.sqlite");
    await copyFile("/source/latest/factory.sqlite.manifest.json", "/restore/latest/factory.sqlite.manifest.json");
    await chmod("/restore/latest/factory.sqlite", 0o660);
    await chmod("/restore/latest/factory.sqlite.manifest.json", 0o640);
    await chmod("/restore", 0o770);
    await chmod("/restore/latest", 0o770);
    await chown("/restore", 1000, 1000);
    await chown("/restore/latest", 1000, 1000);
    await chown("/restore/latest/factory.sqlite", 1000, 1000);
    await chown("/restore/latest/factory.sqlite.manifest.json", 1000, 1000);
  ' >/dev/null 2>/dev/null || die "could not copy the verified database into the fresh drill volume."

drill_container_created=false
drill_volume_created=true
cleanup() {
  exit_status=$?
  if [[ "$drill_container_created" == true ]]; then docker rm --force "$drill_container" >/dev/null 2>&1 || true; fi
  if [[ "$drill_volume_created" == true ]]; then
    docker run --rm --pull=never --network none --user root --entrypoint bun \
      --mount "type=volume,source=${drill_volume},target=/restore" \
      "$image_id" -e '
        import { unlink } from "node:fs/promises";
        await unlink("/restore/operator-secret").catch(() => undefined);
      ' >/dev/null 2>/dev/null || true
  fi
  exit "$exit_status"
}
trap cleanup EXIT

docker run --rm --pull=never --network none --user root --entrypoint bun \
  --mount "type=volume,source=${drill_volume},target=/restore" \
  "$image_id" -e '
    import { randomUUID } from "node:crypto";
    import { chmod, chown, writeFile } from "node:fs/promises";
    const path = "/restore/operator-secret";
    await writeFile(path, randomUUID() + randomUUID());
    await chmod(path, 0o600);
    await chown(path, 1000, 1000);
  ' >/dev/null 2>/dev/null || die "could not generate the isolated operator secret."

docker run --detach --pull=never --name "$drill_container" --init --network none \
  --env FACTORY_ENVIRONMENT=pilot --env FACTORY_REQUIRE_EXISTING_DB=true \
  --env FACTORY_HOST=127.0.0.1 --env FACTORY_PORT=3101 \
  --env FACTORY_DB=/restore/latest/factory.sqlite \
  --env FACTORY_OPERATOR_NAME=st163-restore-drill \
  --env FACTORY_OPERATOR_SECRET_FILE=/restore/operator-secret \
  --mount "type=volume,source=${drill_volume},target=/restore" \
  "$image_id" >/dev/null || die "could not start the isolated restore service."
drill_container_created=true

ready=false
for _ in $(seq 1 60); do
  if docker exec "$drill_container" bun -e '
    const response = await fetch("http://127.0.0.1:3101/readyz");
    if (!response.ok) process.exit(1);
  ' >/dev/null 2>/dev/null; then
    ready=true
    break
  fi
  running="$(docker inspect --format '{{.State.Running}}' "$drill_container" 2>/dev/null || true)"
  [[ "$running" == true ]] || break
  sleep 1
done
[[ "$ready" == true ]] || die "isolated restore service did not become ready."

version_summary="$(docker exec --env "EXPECTED_REVISION=${source_sha}" "$drill_container" bun -e '
  const readiness = await fetch("http://127.0.0.1:3101/readyz");
  if (!readiness.ok) throw new Error("readyz failed");
  const response = await fetch("http://127.0.0.1:3101/version");
  if (!response.ok) throw new Error("version failed");
  const payload = await response.json();
  if (payload?.environment !== "pilot") throw new Error("wrong environment");
  if (payload?.revision !== Bun.env.EXPECTED_REVISION) throw new Error("revision mismatch");
  process.stdout.write(JSON.stringify({ environment: payload.environment, revision: payload.revision }));
' 2>/dev/null)" || die "isolated restore /readyz or /version check failed."

elapsed_seconds=$(( $(date +%s) - started_at ))
docker exec \
  --env "ST163_SOURCE_REVISION=${source_sha}" \
  --env "ST163_IMAGE_ID=${image_id}" \
  --env "ST163_ELAPSED_SECONDS=${elapsed_seconds}" \
  --env "ST163_MANIFEST_SUMMARY=${manifest_summary}" \
  "$drill_container" bun -e '
    const summary = JSON.parse(Bun.env.ST163_MANIFEST_SUMMARY ?? "{}");
    const report = {
      schemaVersion: 1,
      sourceRevision: Bun.env.ST163_SOURCE_REVISION,
      imageId: Bun.env.ST163_IMAGE_ID,
      elapsedSeconds: Number(Bun.env.ST163_ELAPSED_SECONDS),
      manifest: summary,
      checkedAt: new Date().toISOString(),
    };
    await Bun.write("/restore/st163-restore-report.json", `${JSON.stringify(report)}\n`);
  ' >/dev/null 2>/dev/null || die "could not write the durable restore report."

echo "check-pilot-restore: image=${image_id} revision=${source_sha} elapsed_seconds=${elapsed_seconds} manifest=${manifest_summary} version=${version_summary} drill_volume=${drill_volume}"
