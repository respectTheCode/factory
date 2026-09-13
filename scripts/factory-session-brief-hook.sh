#!/bin/sh

# SessionStart context loader for Claude Code and Codex CLI. Every failure is
# intentionally silent so this hook cannot block or report on a session.

client=${1:-}
case "$client" in
  claude|codex) ;;
  *) exit 0 ;;
esac

payload=$(cat 2>/dev/null || true)

json_field() {
  field=$1
  printf '%s' "$payload" | python3 -c '
import json
import sys

try:
    value = json.load(sys.stdin).get(sys.argv[1])
except (AttributeError, json.JSONDecodeError, TypeError, ValueError):
    value = ""

if value is None:
    value = ""
elif not isinstance(value, str):
    value = str(value)
print(value, end="")
' "$field" 2>/dev/null || true
}

source=$(json_field source)
case "$source" in
  resume|compact) exit 0 ;;
esac

agent_id=$(json_field agent_id)
[ -z "$agent_id" ] || exit 0

cwd=$(json_field cwd)
if [ -z "$cwd" ]; then
  cwd=${PWD:-}
fi
[ -n "$cwd" ] || exit 0

factory_env=${FACTORY_ENV_FILE:-}
if [ -z "$factory_env" ] && [ -n "${HOME:-}" ]; then
  factory_env="$HOME/.config/factory/env"
fi
if [ -n "$factory_env" ] && [ -f "$factory_env" ]; then
  set -a
  . "$factory_env" 2>/dev/null || exit 0
  set +a
fi

factory_url=${FACTORY_URL:-}
factory_cli=${FACTORY_CLI:-}
if [ -z "$factory_cli" ]; then
  factory_cli=$(command -v factory 2>/dev/null || true)
fi

if [ -n "$factory_cli" ]; then
  [ -x "$factory_cli" ] || exit 0
else
  script_dir=$(cd "$(dirname "$0")" 2>/dev/null && pwd -P) || exit 0
  default_checkout=$(cd "$script_dir/.." 2>/dev/null && pwd -P) || exit 0
  checkout=${FACTORY_CHECKOUT:-$default_checkout}

  if command -v realpath >/dev/null 2>&1; then
    checkout=$(realpath "$checkout" 2>/dev/null || printf '%s' "$checkout")
  elif [ -d "$checkout" ]; then
    checkout=$(cd "$checkout" 2>/dev/null && pwd -P) || exit 0
  fi

  [ -d "$checkout" ] || exit 0
  [ -f "$checkout/src/cli.ts" ] || exit 0

  if [ -z "$factory_url" ]; then
    database=${FACTORY_DB:-$checkout/factory.sqlite}
    [ -f "$database" ] || exit 0
  fi

  bun_path=$(command -v bun 2>/dev/null || true)
  if [ ! -x "$bun_path" ] && [ -x /opt/homebrew/bin/bun ]; then
    bun_path=/opt/homebrew/bin/bun
  fi
  if [ ! -x "$bun_path" ] && [ -n "${HOME:-}" ] && [ -x "$HOME/.bun/bin/bun" ]; then
    bun_path=$HOME/.bun/bin/bun
  fi
  [ -x "$bun_path" ] || exit 0
fi

workspace_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$cwd")
origin=$(git -C "$workspace_root" remote get-url origin 2>/dev/null || true)
branch=$(git -C "$workspace_root" branch --show-current 2>/dev/null || true)

run_brief() {
  selector=$1
  selector_value=$2
  if [ -n "$factory_cli" ]; then
    if [ -n "$branch" ]; then
      "$factory_cli" project brief "$selector" "$selector_value" \
        --branch-name "$branch" 2>/dev/null
    else
      "$factory_cli" project brief "$selector" "$selector_value" 2>/dev/null
    fi
  else
    cd "$checkout" 2>/dev/null || return 1
    if [ -n "$factory_url" ]; then
      if [ -n "$branch" ]; then
        FACTORY_URL="$factory_url" FACTORY_ACCESS_TOKEN_FILE="${FACTORY_ACCESS_TOKEN_FILE:-}" \
          "$bun_path" run src/cli.ts project brief "$selector" "$selector_value" \
          --branch-name "$branch" 2>/dev/null
      else
        FACTORY_URL="$factory_url" FACTORY_ACCESS_TOKEN_FILE="${FACTORY_ACCESS_TOKEN_FILE:-}" \
          "$bun_path" run src/cli.ts project brief "$selector" "$selector_value" 2>/dev/null
      fi
    elif [ -n "$branch" ]; then
      "$bun_path" run src/cli.ts project brief "$selector" "$selector_value" \
        --branch-name "$branch" --database "$database" 2>/dev/null
    else
      "$bun_path" run src/cli.ts project brief "$selector" "$selector_value" \
        --database "$database" 2>/dev/null
    fi
  fi
}

if [ -n "$origin" ]; then
  if brief=$(run_brief --git-origin-url "$origin"); then
    :
  else
    brief=$(run_brief --workspace-root "$workspace_root") || exit 0
  fi
else
  brief=$(run_brief --workspace-root "$workspace_root") || exit 0
fi
[ -n "$brief" ] || exit 0

preamble="Factory brief for this checkout (SessionStart hook). Act on it; full rules are in the software-factory skill."
context=$(printf '%s\n\n%s' "$preamble" "$brief") || exit 0

if [ "$client" = "claude" ]; then
  output=$(printf '%s' "$context" | python3 -c '
import json
import sys

context = sys.stdin.read()
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": context,
    }
}))
' 2>/dev/null) || exit 0
  [ -n "$output" ] || exit 0
  printf '%s\n' "$output"
else
  printf '%s\n' "$context"
fi
