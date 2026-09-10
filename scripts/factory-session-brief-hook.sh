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

agent_id=$(json_field agent_id)
[ -z "$agent_id" ] || exit 0

cwd=$(json_field cwd)
if [ -z "$cwd" ]; then
  cwd=${PWD:-}
fi
[ -n "$cwd" ] || exit 0

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

database=${FACTORY_DB:-$checkout/factory.sqlite}
[ -f "$database" ] || exit 0

bun_path=$(command -v bun 2>/dev/null || true)
if [ ! -x "$bun_path" ] && [ -x /opt/homebrew/bin/bun ]; then
  bun_path=/opt/homebrew/bin/bun
fi
if [ ! -x "$bun_path" ] && [ -n "${HOME:-}" ] && [ -x "$HOME/.bun/bin/bun" ]; then
  bun_path=$HOME/.bun/bin/bun
fi
[ -x "$bun_path" ] || exit 0

workspace_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$cwd")
origin=$(git -C "$workspace_root" remote get-url origin 2>/dev/null || true)
branch=$(git -C "$workspace_root" branch --show-current 2>/dev/null || true)

run_brief() {
  selector=$1
  selector_value=$2
  cd "$checkout" 2>/dev/null || return 1
  if [ -n "$branch" ]; then
    "$bun_path" run src/cli.ts project brief "$selector" "$selector_value" \
      --branch-name "$branch" --database "$database" 2>/dev/null
  else
    "$bun_path" run src/cli.ts project brief "$selector" "$selector_value" \
      --database "$database" 2>/dev/null
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

preamble="Factory brief for this checkout (injected by SessionStart hook; full rules in the software-factory skill):"
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
