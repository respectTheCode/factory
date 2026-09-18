#!/bin/bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 RELEASE_STAGE_DIR" >&2
  exit 2
fi

FACTORY_REPOSITORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FACTORY_STAGE_DIR="$1"

if [[ ! -d "${FACTORY_STAGE_DIR}" ]]; then
  echo "Release stage directory does not exist: ${FACTORY_STAGE_DIR}" >&2
  exit 1
fi

cd "${FACTORY_REPOSITORY_DIR}"
mkdir -p "${FACTORY_STAGE_DIR}/src" "${FACTORY_STAGE_DIR}/dist" \
  "${FACTORY_STAGE_DIR}/src/web/fonts" "${FACTORY_STAGE_DIR}/src/web/icons"

# Keep the bundled entrypoints under src/ so import.meta.dir retains the same
# source-relative asset and worker layout as an unbundled checkout.
bun build ./src/server.ts --target bun --outfile "${FACTORY_STAGE_DIR}/src/server.js"
bun build ./src/backup-worker.ts --target bun --outfile "${FACTORY_STAGE_DIR}/src/backup-worker.ts"
install -m 0755 scripts/factory-service-launcher.sh \
  "${FACTORY_STAGE_DIR}/factory-service-launcher.sh"

cp dist/main.css dist/main.js dist/service-worker.js "${FACTORY_STAGE_DIR}/dist/"
cp src/web/icon.svg src/web/index.html src/web/manifest.webmanifest \
  "${FACTORY_STAGE_DIR}/src/web/"
cp src/web/fonts/*.woff2 "${FACTORY_STAGE_DIR}/src/web/fonts/"
cp src/web/fonts/LICENSE.txt "${FACTORY_STAGE_DIR}/src/web/fonts/"
cp src/web/icons/*.png "${FACTORY_STAGE_DIR}/src/web/icons/"
