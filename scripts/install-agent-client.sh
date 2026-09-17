#!/bin/sh

set -eu

usage() {
  cat >&2 <<'EOF'
Usage: install-agent-client.sh --url URL (--token-file PATH | --token-stdin) [options]

Options:
  --machine-id ID  Record the machine label in the Factory env file.
  --prefix PATH    Install the binary below PATH (default: $HOME/.local).
  --dry-run        Print planned actions without writing or running doctor.
EOF
}

fail() {
  echo "install-agent-client: $*" >&2
  exit 1
}

shell_quote() {
  escaped=$(printf '%s' "$1" | sed "s/'/'\\\\''/g")
  printf "'%s'" "$escaped"
}

home=${HOME:-}
[ -n "$home" ] || fail "HOME must be set."

factory_url=
token_file=
token_mode=
machine_id=
prefix="$home/.local"
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)
      [ "$#" -ge 2 ] || fail "--url requires a value."
      factory_url=$2
      shift 2
      ;;
    --token-file)
      [ "$#" -ge 2 ] || fail "--token-file requires a value."
      [ -z "$token_mode" ] || fail "choose exactly one token source."
      token_file=$2
      token_mode=file
      shift 2
      ;;
    --token-stdin)
      [ -z "$token_mode" ] || fail "choose exactly one token source."
      token_mode=stdin
      shift
      ;;
    --machine-id)
      [ "$#" -ge 2 ] || fail "--machine-id requires a value."
      machine_id=$2
      shift 2
      ;;
    --prefix)
      [ "$#" -ge 2 ] || fail "--prefix requires a value."
      prefix=$2
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      fail "unknown option: $1"
      ;;
  esac
done

[ -n "$factory_url" ] || fail "--url is required."
[ -n "$token_mode" ] || fail "provide --token-file or --token-stdin."
case "$factory_url" in
  *[[:space:]]*) fail "--url must be a single line." ;;
esac
case "$machine_id" in
  *[[:space:]]*) fail "--machine-id must be a single word." ;;
esac

script_directory=$(cd "$(dirname "$0")" 2>/dev/null && pwd -P) || fail "could not locate installer."
binary_source=${FACTORY_BINARY:-$script_directory/../factory}
if [ ! -x "$binary_source" ]; then
  binary_source=${FACTORY_BINARY:-$script_directory/../factory-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/arm64/arm64/; s/aarch64/arm64/; s/x86_64/x64/')}
fi
[ -x "$binary_source" ] || fail "compiled factory binary not found; set FACTORY_BINARY or use the target tarball."

skill_source=${FACTORY_SKILL_SOURCE:-$script_directory/../skills/software-factory}
hook_source=${FACTORY_HOOK_SOURCE:-$script_directory/factory-session-brief-hook.sh}
[ -d "$skill_source" ] || fail "software-factory skill directory not found: $skill_source"
[ -f "$hook_source" ] || fail "session hook script not found: $hook_source"

config_directory="$home/.config/factory"
token_destination="$config_directory/access-token"
env_destination="$config_directory/env"
installed_binary="$prefix/bin/factory"
claude_settings="$home/.claude/settings.json"
codex_hooks="$home/.codex/hooks.json"
installed_hook="$config_directory/factory-session-brief-hook.sh"
codex_binary=${CODEX_BIN:-}
if [ -n "$codex_binary" ]; then
  case "$codex_binary" in
    */*) [ -x "$codex_binary" ] || codex_binary= ;;
    *) codex_binary=$(command -v "$codex_binary" 2>/dev/null || true) ;;
  esac
else
  codex_binary=$(command -v codex 2>/dev/null || true)
fi
if [ -n "$codex_binary" ]; then
  codex_available=1
else
  codex_available=0
fi

if [ "$dry_run" -eq 1 ]; then
  echo "Would install binary: $binary_source -> $installed_binary"
  echo "Would write environment: $env_destination"
  echo "Would copy token from: $token_mode${token_file:+ ($token_file)} -> $token_destination"
  [ -n "$machine_id" ] && echo "Would record machine label: $machine_id"
  echo "Would install skill: $skill_source -> $home/.codex/skills/software-factory/"
  echo "Would install skill: $skill_source -> $home/.claude/skills/software-factory/"
  echo "Would install hook: $hook_source -> $installed_hook"
  echo "Would merge hooks: $claude_settings and $codex_hooks"
  if [ "$codex_available" -eq 1 ]; then
    echo "Would run: $installed_binary hooks trust-codex --json"
  else
    echo "Codex CLI not found; run \"$installed_binary hooks trust-codex --json\" after installing Codex."
  fi
  echo "Would run: $installed_binary doctor"
  exit 0
fi

if [ "$token_mode" = file ]; then
  [ -f "$token_file" ] || fail "token file does not exist: $token_file"
  token=$(cat "$token_file") || fail "could not read token file."
else
  token=$(cat) || fail "could not read token from stdin."
fi
[ -n "$token" ] || fail "token is empty."

umask 077
mkdir -p \
  "$prefix/bin" \
  "$config_directory" \
  "$home/.claude" \
  "$home/.codex" \
  "$home/.codex/skills/software-factory" \
  "$home/.claude/skills/software-factory"

cp "$binary_source" "$installed_binary"
chmod 755 "$installed_binary"
cp -R "$skill_source/." "$home/.codex/skills/software-factory/"
cp -R "$skill_source/." "$home/.claude/skills/software-factory/"
cp "$hook_source" "$installed_hook"
chmod 755 "$installed_hook"

token_temporary=$(mktemp "$config_directory/access-token.XXXXXX") || fail "could not create token file."
env_temporary=$(mktemp "$config_directory/env.XXXXXX") || fail "could not create environment file."
trap 'rm -f "$token_temporary" "$env_temporary"' 0 1 2 3 15
printf '%s' "$token" > "$token_temporary"
chmod 600 "$token_temporary"
mv "$token_temporary" "$token_destination"

{
  printf 'FACTORY_URL=%s\n' "$(shell_quote "$factory_url")"
  printf 'FACTORY_ACCESS_TOKEN_FILE=%s\n' "$(shell_quote "$token_destination")"
  # Hooks run with a minimal PATH, so name the binary explicitly.
  printf 'FACTORY_CLI=%s\n' "$(shell_quote "$installed_binary")"
  if [ -n "$machine_id" ]; then
    printf 'FACTORY_MACHINE_ID=%s\n' "$(shell_quote "$machine_id")"
  fi
} > "$env_temporary"
chmod 600 "$env_temporary"
mv "$env_temporary" "$env_destination"

if [ ! -e "$claude_settings" ]; then
  printf '{}\n' > "$claude_settings"
fi

FACTORY_URL=$factory_url FACTORY_ACCESS_TOKEN_FILE=$token_destination \
  "$installed_binary" hooks install \
    --script-path "$installed_hook" \
    --claude-settings "$claude_settings" \
    --codex-hooks "$codex_hooks" \
    --json

if [ "$codex_available" -eq 1 ]; then
  set +e
  FACTORY_URL=$factory_url FACTORY_ACCESS_TOKEN_FILE=$token_destination CODEX_BIN=$codex_binary \
    "$installed_binary" hooks trust-codex --json
  trust_status=$?
  set -e
  if [ "$trust_status" -ne 0 ]; then
    echo "Could not trust the Codex SessionStart hook; run \"$installed_binary hooks trust-codex --json\" later." >&2
  fi
else
  echo "Codex CLI not found; run \"$installed_binary hooks trust-codex --json\" after installing Codex."
fi

set +e
FACTORY_URL=$factory_url FACTORY_ACCESS_TOKEN_FILE=$token_destination \
  "$installed_binary" doctor
doctor_status=$?
set -e
exit "$doctor_status"
