#!/bin/zsh

set -u

FACTORY_GITHUB_KEYCHAIN_SERVICE="com.app-press.factory.github-token"
FACTORY_GITHUB_KEYCHAIN_ACCOUNT="$(/usr/bin/id -un)"
FACTORY_BUN_PATH="${FACTORY_BUN_PATH:-/opt/homebrew/bin/bun}"
FACTORY_SERVER_PATH="$(cd -- "$(dirname -- "$0")" && pwd)/server.js"
unset GITHUB_TOKEN
unset T3_ACCESS_TOKEN

# The stable service uses the same-host T3 server unless the operator provides
# an explicit endpoint through the LaunchAgent environment.
if [[ -z "${T3_BASE_URL:-}" ]]; then
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
exec "${FACTORY_BUN_PATH}" "${FACTORY_SERVER_PATH}"
