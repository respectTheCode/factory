#!/usr/bin/env bash

set -euo pipefail

repository_root=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$repository_root"

bun_path=${BUN_BIN:-$(command -v bun 2>/dev/null || true)}
if [[ -z "$bun_path" || ! -x "$bun_path" ]]; then
  echo "Bun is required to build the Factory client." >&2
  exit 1
fi

revision=$(git rev-parse --short HEAD)
if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  revision+="-dirty"
fi

output_directory="$repository_root/dist/client"
mkdir -p "$output_directory"

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/factory-client-build.XXXXXX")
trap 'rm -rf "$temporary_directory"' EXIT

build_target() {
  target_name=$1
  bun_target=$2
  os_name=$3
  architecture=$4
  binary="$output_directory/factory-$os_name-$architecture"
  tarball="$output_directory/factory-$os_name-$architecture.tar.gz"
  staging="$temporary_directory/$target_name"

  rm -rf "$staging"
  mkdir -p \
    "$staging/skills/software-factory" \
    "$staging/scripts"

  "$bun_path" build --compile ./src/client.ts \
    --target "$bun_target" \
    --outfile "$binary" \
    --define "FACTORY_CLIENT_REVISION=\"$revision\"" \
    --define "import.meta.main=true"

  cp -R "$repository_root/skills/software-factory/." \
    "$staging/skills/software-factory/"
  cp "$repository_root/scripts/factory-session-brief-hook.sh" \
    "$staging/scripts/factory-session-brief-hook.sh"
  cp "$repository_root/scripts/install-agent-client.sh" \
    "$staging/scripts/install-agent-client.sh"
  cp "$binary" "$staging/factory"
  chmod 755 "$staging/factory" "$staging/scripts/install-agent-client.sh"

  tar -czf "$tarball" \
    -C "$staging" \
    factory \
    skills/software-factory \
    scripts/factory-session-brief-hook.sh \
    scripts/install-agent-client.sh

  echo "built $binary"
  echo "packaged $tarball"
}

build_target darwin-arm64 bun-darwin-arm64 darwin arm64
build_target darwin-x64 bun-darwin-x64 darwin x64
build_target linux-x64 bun-linux-x64 linux x64
build_target linux-arm64 bun-linux-arm64 linux arm64
