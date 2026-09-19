#!/bin/zsh

set -u

FACTORY_GITHUB_KEYCHAIN_SERVICE="com.app-press.factory.github-token"
FACTORY_GITHUB_KEYCHAIN_ACCOUNT="$(/usr/bin/id -un)"
FACTORY_BUN_PATH="${FACTORY_BUN_PATH:-/opt/homebrew/bin/bun}"
FACTORY_SERVER_PATH="$(cd -- "$(dirname -- "$0")" && pwd)/src/server.js"
FACTORY_SERVICE_ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
unset GITHUB_TOKEN
unset T3_ACCESS_TOKEN

# The multi-source registry is an operator-managed secret-sidecar. Preserve
# an explicitly supplied path; otherwise adopt the packaged service-root file
# when present. The server reads credential files, so this launcher never
# reads or prints their contents.
if [[ -z "${FACTORY_T3_SOURCES_FILE+x}" ]] && [[ -s "${FACTORY_SERVICE_ROOT}/secrets/t3-sources.json" ]]; then
  export FACTORY_T3_SOURCES_FILE="${FACTORY_SERVICE_ROOT}/secrets/t3-sources.json"
fi

# The stable service uses the same-host T3 server unless the operator provides
# an explicit endpoint through the LaunchAgent environment.
if [[ -z "${FACTORY_T3_SOURCES_FILE:-}" ]] && [[ -z "${T3_BASE_URL:-}" ]]; then
  export T3_BASE_URL="http://127.0.0.1:3773"
fi

if FACTORY_GITHUB_TOKEN="$(/usr/bin/security find-generic-password \
  -s "${FACTORY_GITHUB_KEYCHAIN_SERVICE}" \
  -a "${FACTORY_GITHUB_KEYCHAIN_ACCOUNT}" \
  -w 2>/dev/null)"; then
  if [[ -n "${FACTORY_GITHUB_TOKEN}" ]]; then
    export GITHUB_TOKEN="${FACTORY_GITHUB_TOKEN}"
  fi
else
  echo "Factory: GitHub token is not available from the login Keychain; GitHub status reads are disabled." >&2
  unset GITHUB_TOKEN
fi

unset FACTORY_GITHUB_TOKEN

# Human verification requires an operator secret file. The server refuses a
# half-configured operator, so only export the pair when the file exists.
FACTORY_OPERATOR_SECRET_PATH="${FACTORY_SERVICE_ROOT}/secrets/operator-secret"
if [[ -s "${FACTORY_OPERATOR_SECRET_PATH}" ]]; then
  export FACTORY_OPERATOR_NAME="${FACTORY_OPERATOR_NAME:-kevin}"
  export FACTORY_OPERATOR_SECRET_FILE="${FACTORY_OPERATOR_SECRET_PATH}"
else
  echo "Factory: operator secret ${FACTORY_OPERATOR_SECRET_PATH} is missing; human verification is disabled." >&2
  unset FACTORY_OPERATOR_NAME
  unset FACTORY_OPERATOR_SECRET_FILE
fi
unset FACTORY_OPERATOR_SECRET_PATH
unset FACTORY_SERVICE_ROOT

# Report the deployed release through GET /version so clients and humans can
# see which build is serving.
if [[ -z "${FACTORY_REVISION:-}" ]]; then
  export FACTORY_REVISION="$(basename "$(cd -- "$(dirname -- "$0")" && pwd -P)")"
fi

exec "${FACTORY_BUN_PATH}" "${FACTORY_SERVER_PATH}"
