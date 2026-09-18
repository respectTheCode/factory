#!/bin/bash

set -euo pipefail

FACTORY_REPOSITORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FACTORY_BUN_PATH="$(command -v bun)"
FACTORY_SERVICE_ROOT="${HOME}/Library/Application Support/Factory"
FACTORY_RELEASES_DIR="${FACTORY_SERVICE_ROOT}/releases"
FACTORY_LOG_ROOT="${HOME}/Library/Logs/Factory"
FACTORY_LAUNCH_AGENT="${HOME}/Library/LaunchAgents/com.app-press.factory.plist"
FACTORY_DATABASE_PATH="${FACTORY_DB:-${FACTORY_REPOSITORY_DIR}/factory.sqlite}"
FACTORY_WORKTREE_SUFFIX=""
if [[ -n "$(git -C "${FACTORY_REPOSITORY_DIR}" status --porcelain)" ]]; then
  FACTORY_WORKTREE_SUFFIX="-dirty"
fi
FACTORY_RELEASE_ID="$(date +%Y%m%dT%H%M%S)-$(git -C "${FACTORY_REPOSITORY_DIR}" rev-parse --short HEAD)${FACTORY_WORKTREE_SUFFIX}-$$"
FACTORY_RELEASE_DIR="${FACTORY_RELEASES_DIR}/${FACTORY_RELEASE_ID}"
FACTORY_USER_DOMAIN="gui/$(id -u)"
FACTORY_SERVICE_TARGET="${FACTORY_USER_DOMAIN}/com.app-press.factory"

if [[ ! -f "${FACTORY_DATABASE_PATH}" ]]; then
  echo "Factory database does not exist: ${FACTORY_DATABASE_PATH}" >&2
  exit 1
fi

mkdir -p "${FACTORY_RELEASES_DIR}" "${FACTORY_LOG_ROOT}"
install -d -m 0700 "${FACTORY_SERVICE_ROOT}/secrets"
FACTORY_STAGE_DIR="$(mktemp -d "${FACTORY_SERVICE_ROOT}/.deploy.XXXXXX")"
FACTORY_PLIST_STAGE="$(mktemp "${FACTORY_SERVICE_ROOT}/.launch-agent.XXXXXX")"
trap 'rm -rf "${FACTORY_STAGE_DIR}"; rm -f "${FACTORY_PLIST_STAGE}"' EXIT

cd "${FACTORY_REPOSITORY_DIR}"
bun run build
bash scripts/package-user-service.sh "${FACTORY_STAGE_DIR}"

FACTORY_ESCAPE_SED_REPLACEMENT='s/[&|\\]/\\&/g'
FACTORY_BUN_ESCAPED="$(printf '%s' "${FACTORY_BUN_PATH}" | sed "${FACTORY_ESCAPE_SED_REPLACEMENT}")"
FACTORY_SERVICE_ROOT_ESCAPED="$(printf '%s' "${FACTORY_SERVICE_ROOT}" | sed "${FACTORY_ESCAPE_SED_REPLACEMENT}")"
FACTORY_DATABASE_ESCAPED="$(printf '%s' "${FACTORY_DATABASE_PATH}" | sed "${FACTORY_ESCAPE_SED_REPLACEMENT}")"
FACTORY_LOG_ROOT_ESCAPED="$(printf '%s' "${FACTORY_LOG_ROOT}" | sed "${FACTORY_ESCAPE_SED_REPLACEMENT}")"

sed \
  -e "s|__BUN_PATH__|${FACTORY_BUN_ESCAPED}|g" \
  -e "s|__SERVICE_ROOT__|${FACTORY_SERVICE_ROOT_ESCAPED}|g" \
  -e "s|__DATABASE_PATH__|${FACTORY_DATABASE_ESCAPED}|g" \
  -e "s|__LOG_ROOT__|${FACTORY_LOG_ROOT_ESCAPED}|g" \
  scripts/com.app-press.factory.plist.template > "${FACTORY_PLIST_STAGE}"
plutil -lint "${FACTORY_PLIST_STAGE}"

mv "${FACTORY_STAGE_DIR}" "${FACTORY_RELEASE_DIR}"
ln -sfn "${FACTORY_RELEASE_DIR}" "${FACTORY_SERVICE_ROOT}/current"
install -m 0644 "${FACTORY_PLIST_STAGE}" "${FACTORY_LAUNCH_AGENT}"

launchctl bootout "${FACTORY_SERVICE_TARGET}" 2>/dev/null || true
for FACTORY_BOOTOUT_ATTEMPT in {1..40}; do
  if ! launchctl print "${FACTORY_SERVICE_TARGET}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

FACTORY_BOOTSTRAPPED=false
for FACTORY_BOOTSTRAP_ATTEMPT in {1..20}; do
  if launchctl bootstrap "${FACTORY_USER_DOMAIN}" "${FACTORY_LAUNCH_AGENT}" 2>/dev/null; then
    FACTORY_BOOTSTRAPPED=true
    break
  fi
  sleep 0.25
done

if [[ "${FACTORY_BOOTSTRAPPED}" != true ]]; then
  launchctl bootstrap "${FACTORY_USER_DOMAIN}" "${FACTORY_LAUNCH_AGENT}"
fi

echo "Deployed Factory release ${FACTORY_RELEASE_ID}"
echo "Service: ${FACTORY_SERVICE_TARGET}"
echo "Database: ${FACTORY_DATABASE_PATH}"
echo "Logs: ${FACTORY_LOG_ROOT}"
