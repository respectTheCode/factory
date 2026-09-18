#!/usr/bin/env bash
set -euo pipefail

# This script runs on the Dokploy host, outside the Factory container. It is
# intentionally limited to the ST-162 pilot Compose project. A deployment is
# allowed to proceed only after a fresh local snapshot and its manifest verify.

readonly COMPOSE_PROJECT="factory-pilot-st162-ewgahg"
readonly COMPOSE_SERVICE="factory"
readonly SOURCE_DATABASE="/data/factory.sqlite"
readonly PREDEPLOY_ROOT="/data/predeploy"

die() {
  echo "pilot-predeploy-backup: $1" >&2
  exit 1
}

[[ "$#" -eq 0 ]] || die "does not accept arguments."
command -v docker >/dev/null 2>&1 || die "docker is required."
command -v date >/dev/null 2>&1 || die "date is required."

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

[[ "${#factory_containers[@]}" -eq 1 ]] ||
  die "expected exactly one running pilot factory container."
factory_container="${factory_containers[0]}"

health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$factory_container" 2>/dev/null)" ||
  die "could not inspect the pilot factory health."
[[ "$health_status" == "healthy" ]] ||
  die "pilot factory is not healthy."

# The endpoint is checked from inside the running service so this remains valid
# when the Compose service shares its network namespace with the Tailscale sidecar.
current_sha="$(docker exec "$factory_container" bun -e '
  const response = await fetch("http://127.0.0.1:3000/version");
  if (!response.ok) throw new Error("version endpoint failed");
  const payload = await response.json();
  if (payload?.environment !== "pilot") throw new Error("wrong environment");
  if (typeof payload?.revision !== "string" || !/^[0-9a-f]{40}$/i.test(payload.revision)) {
    throw new Error("invalid revision");
  }
  process.stdout.write(payload.revision.toLowerCase());
' 2>/dev/null)" || die "pilot /version could not be verified."
[[ "$current_sha" =~ ^[0-9a-f]{40}$ ]] || die "pilot /version did not report a commit SHA."
expected_running_sha="${FACTORY_PILOT_EXPECTED_RUNNING_SHA:-}"
if [[ -n "$expected_running_sha" ]]; then
  [[ "$expected_running_sha" =~ ^[0-9a-f]{40}$ ]] || die "expected running SHA was invalid."
  [[ "$current_sha" == "${expected_running_sha,,}" ]] || die "pilot revision changed during the backup gate."
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)-$(date +%s)-$$" ||
  die "could not generate a unique snapshot timestamp."
[[ "$timestamp" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+-[0-9]+$ ]] ||
  die "generated snapshot name was invalid."

snapshot_directory="${PREDEPLOY_ROOT}/${timestamp}"
snapshot_database="${snapshot_directory}/factory.sqlite"
snapshot_manifest="${snapshot_database}.manifest.json"

# Create the directory before invoking the snapshot helper. The ownership marker
# is written only after both backup and manifest verification succeed, so failed
# attempts never count toward retention.
docker exec --env "FACTORY_PREDEPLOY_DIR=${snapshot_directory}" "$factory_container" bun -e '
  import { mkdir } from "node:fs/promises";
  const directory = Bun.env.FACTORY_PREDEPLOY_DIR;
  if (!directory) throw new Error("missing snapshot directory");
  await mkdir("/data/predeploy", { recursive: true });
  await mkdir(directory);
' >/dev/null 2>/dev/null || die "could not prepare the pre-deployment snapshot directory."

docker exec "$factory_container" bun scripts/backup-snapshot.ts \
  backup \
  --database "$SOURCE_DATABASE" \
  --output "$snapshot_database" \
  >/dev/null 2>/dev/null || die "consistent pre-deployment snapshot failed."

docker exec "$factory_container" bun scripts/backup-snapshot.ts \
  verify \
  --database "$snapshot_database" \
  --manifest "$snapshot_manifest" \
  >/dev/null 2>/dev/null || die "pre-deployment snapshot verification failed."

# Read only the manifest's durable count and database/snapshot hash fields. Do
# not print the manifest wholesale: it may contain sensitive credential hashes.
manifest_summary="$(docker exec --env "FACTORY_PREDEPLOY_MANIFEST=${snapshot_manifest}" "$factory_container" bun -e '
  const path = Bun.env.FACTORY_PREDEPLOY_MANIFEST;
  if (!path) throw new Error("missing snapshot manifest");
  const manifest = JSON.parse(await Bun.file(path).text());
  const collections = manifest?.state?.collections;
  if (!collections || typeof collections !== "object" || Array.isArray(collections)) {
    throw new Error("manifest collections are missing");
  }
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
' 2>/dev/null)" || die "pre-deployment manifest counts could not be read."

docker exec --env "FACTORY_PREDEPLOY_DIR=${snapshot_directory}" "$factory_container" bun -e '
  const directory = Bun.env.FACTORY_PREDEPLOY_DIR;
  if (!directory) throw new Error("missing snapshot directory");
  await Bun.write(`${directory}/.factory-st163-predeploy`, "factory-st163\n");
' >/dev/null 2>/dev/null || die "could not mark the verified pre-deployment snapshot."

# Prune only directories that this script created, and only after the new
# snapshot has passed verification. The marker prevents removal of unrelated
# data placed below /data/predeploy by an operator or another backup job.
retention_summary="$(docker exec "$factory_container" bun -e '
  import { readdir, rm, stat } from "node:fs/promises";
  const root = "/data/predeploy";
  const ownedName = /^[0-9]{8}T[0-9]{6}Z-[0-9]+-[0-9]+$/;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      process.stdout.write(JSON.stringify({ retained: 0, pruned: 0 }));
      process.exit(0);
    }
    throw error;
  }
  const owned = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !ownedName.test(entry.name)) continue;
    const directory = `${root}/${entry.name}`;
    try {
      const marker = await Bun.file(`${directory}/.factory-st163-predeploy`).text();
      if (marker !== "factory-st163\n") continue;
      const metadata = await stat(directory);
      owned.push({ directory, modified: metadata.mtimeMs });
    } catch {
      continue;
    }
  }
  owned.sort((left, right) => right.modified - left.modified);
  let pruned = 0;
  for (const item of owned.slice(10)) {
    await rm(item.directory, { recursive: true, force: false });
    pruned += 1;
  }
  process.stdout.write(JSON.stringify({ retained: Math.min(owned.length, 10), pruned }));
' 2>/dev/null)" || die "pre-deployment snapshot retention failed."

echo "pilot-predeploy-backup: revision=${current_sha} snapshot=${snapshot_database} manifest=${manifest_summary} retention=${retention_summary}"
