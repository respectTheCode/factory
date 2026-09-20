#!/usr/bin/env bash
set -euo pipefail

# This script runs on the Dokploy host, outside the Factory container. It is
# intentionally limited to the two fixed ST-162 pilot and ST-165 production
# deployment profiles on the existing Compose project. A deployment is allowed
# to proceed only after the app publishes and verifies a fresh backup on its
# configured share.

readonly COMPOSE_PROJECT="factory-pilot-st162-ewgahg"
readonly COMPOSE_SERVICE="factory"

selected_environment="${FACTORY_DEPLOY_ENVIRONMENT:-pilot}"
case "$selected_environment" in
  pilot)
    expected_environment="pilot"
    ;;
  production)
    expected_environment="production"
    ;;
  *)
    echo "pilot-predeploy-backup: FACTORY_DEPLOY_ENVIRONMENT must be pilot or production." >&2
    exit 1
    ;;
esac

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
  die "could not inspect the ${expected_environment} factory health."
[[ "$health_status" == "healthy" ]] ||
  die "${expected_environment} factory is not healthy."

# The endpoint is checked from inside the running service so this remains valid
# when the Compose service shares its network namespace with the Tailscale sidecar.
current_sha="$(docker exec --env "FACTORY_EXPECTED_ENVIRONMENT=${expected_environment}" "$factory_container" bun -e '
  const response = await fetch("http://127.0.0.1:3000/version");
  if (!response.ok) throw new Error("version endpoint failed");
  const payload = await response.json();
  if (payload?.environment !== Bun.env.FACTORY_EXPECTED_ENVIRONMENT) throw new Error("wrong environment");
  if (typeof payload?.revision !== "string" || !/^[0-9a-f]{40}$/i.test(payload.revision)) {
    throw new Error("invalid revision");
  }
  process.stdout.write(payload.revision.toLowerCase());
' 2>/dev/null)" || die "${expected_environment} /version could not be verified."
[[ "$current_sha" =~ ^[0-9a-f]{40}$ ]] || die "${expected_environment} /version did not report a commit SHA."
expected_running_sha="${FACTORY_PILOT_EXPECTED_RUNNING_SHA:-}"
if [[ -n "$expected_running_sha" ]]; then
  [[ "$expected_running_sha" =~ ^[0-9a-f]{40}$ ]] || die "expected running SHA was invalid."
  expected_running_sha_lower="$(printf '%s' "$expected_running_sha" | tr '[:upper:]' '[:lower:]')"
  [[ "$current_sha" == "$expected_running_sha_lower" ]] || die "${expected_environment} revision changed during the backup gate."
fi

# Use the same human-authenticated application operation as the dashboard. The
# mounted operator secret stays inside the container and never enters logs.
docker exec "$factory_container" bun -e '
  const base = "http://127.0.0.1:3000";
  const secretFile = Bun.env.FACTORY_OPERATOR_SECRET_FILE;
  if (!secretFile) throw new Error("operator secret file is not configured");
  const secret = (await Bun.file(secretFile).text()).trim();
  const login = await fetch(base + "/session/login", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({secret}), signal: AbortSignal.timeout(10000),
  });
  if (!login.ok) throw new Error("pre-deployment backup login failed");
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("pre-deployment backup session missing");
  try {
    const response = await fetch(base + "/api/backups.create", {
      method: "POST", headers: {"Content-Type": "application/json", Cookie: cookie},
      body: JSON.stringify({trigger: "pre-deploy"}), signal: AbortSignal.timeout(100000),
    });
    const payload = await response.json();
    const backup = payload?.result?.data;
    if (!response.ok || !backup?.id) throw new Error("app-managed pre-deployment backup failed");
    console.log("pilot-predeploy-backup: " + JSON.stringify({id:backup.id, createdAt:backup.createdAt, sizeBytes:backup.sizeBytes}));
  } finally {
    await fetch(base + "/session/logout", {method:"POST",headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)}).catch(()=>{});
  }
' || die "app-managed pre-deployment backup failed; deployment blocked."
