# SessionStart project briefs

The Factory SessionStart hook loads the project brief for the checkout where a
Claude Code or Codex CLI session starts. It resolves the checkout's Git origin,
workspace root, and current branch, then calls the read-only `project brief`
command. A brief is injected only when exactly one Factory Project matches.

Install or update both client configurations with:

```sh
bun run scripts/install-session-hooks.ts
```

The installer merges one `SessionStart` command group into the existing files;
it does not replace existing groups. Claude settings must already exist because
that file is user-managed. A missing Codex `~/.codex/hooks.json` starts from an
empty configuration. Use `--dry-run` to inspect the JSON report without writing,
and `--json` for the stable machine-readable report.

## When the hook fires

The Factory group uses the matcher `"startup|clear"`, so it injects the brief
once per fresh context: on `startup` for a new session and on `clear` after
`/clear`. It does not inject on `resume` or `compact`: the original brief is
already in the resumed transcript, and the compacted summary retains the
Factory IDs. The shell script also skips those two sources as a belt-and-braces
guard if an installed group has no matcher.

Changing the Factory group changes Codex's hook hash. After reinstalling the
hook, rerun `bun run scripts/trust-codex-session-hook.ts` so Codex trusts the
new definition.

On agent machines the hook runs the compiled `factory` binary instead of a
checkout. It sources `~/.config/factory/env` when present, then uses
`FACTORY_CLI` or a `factory` found on `PATH`; only when neither exists does it
fall back to `bun run src/cli.ts` in the checkout. `scripts/install-agent-client.sh`
installs the hook and merges both client configurations through
`factory hooks install`, then records the Codex trust hash through
`factory hooks trust-codex` when the Codex CLI is present. Run that trust
command again after any change to the hook definition.

The hook uses these environment overrides:

- `FACTORY_CHECKOUT` — Factory checkout containing `src/cli.ts`; by default it
  is the checkout one directory above this script.
- `FACTORY_DB` — Factory SQLite database; by default it is
  `$FACTORY_CHECKOUT/factory.sqlite`. Ignored when `FACTORY_URL` is set.
- `FACTORY_URL` and `FACTORY_ACCESS_TOKEN_FILE` — remote mode. When
  `FACTORY_URL` is set the hook passes no `--database` flag and the brief
  exports these two variables instead of `FACTORY_DB`, so the session's
  commands run against the remote service with the machine credential.

The hook locates Bun through `command -v bun`, `/opt/homebrew/bin/bun`, and then
`$HOME/.bun/bin/bun`. It passes the Git-origin selector first when an origin is
available, and falls back to the workspace-root selector only when that call
fails. It passes `--branch-name` when the checkout has a current branch.

## Client output contracts

Claude Code's `SessionStart` hook reference says successful hook stdout becomes
session context and documents the structured
`hookSpecificOutput.additionalContext` form:

<https://code.claude.com/docs/en/hooks>

This hook emits that JSON form when invoked with `claude`.

Codex's hooks documentation says `SessionStart` plain stdout is added as extra
developer context and also documents the corresponding
`hookSpecificOutput.additionalContext` JSON shape:

<https://developers.openai.com/codex/hooks>

This hook emits the preamble and markdown as plain stdout when invoked with
`codex`. The installer uses the client-specific command, so each configuration
gets the appropriate form without changing the other client's global hooks.

## Silent and non-blocking behavior

The hook exits successfully with empty stdout when the payload has an
`agent_id`, has no usable `cwd` (after the `$PWD` fallback), Bun cannot be
found, the Factory checkout or database is missing, the brief command fails,
or the command prints nothing. CLI stderr is discarded. The brief command's
8000-character output cap remains the CLI's responsibility.

The hook never reports status, creates or updates Factory records, sends
notifications, or blocks a session. It is context loading only. It is distinct
from the reporting hooks deferred in
[`docs/reviews/2026-09-04-tool-fixes-and-hooks.md`](reviews/2026-09-04-tool-fixes-and-hooks.md).

## Trusting the Codex hook

Codex skips an untrusted non-managed hook. Trust is tied to the exact hook
definition, so the hash changes whenever that definition changes, including when
the installer changes the Codex `additionalContextLimit` of 4000 tokens. After
installing or updating the hook, record its current hash with:

```sh
bun run scripts/trust-codex-session-hook.ts
```

The alternative is to review and trust the hook through `/hooks` inside an
interactive Codex session. `--dangerously-bypass-hook-trust` is reserved for
one-off automation and should not replace recording trust for the installed
hook.

## Verification

Run the script directly with a SessionStart-shaped payload. Use a tracked
checkout for the first command and an untracked directory for the second:

```sh
printf '%s\n' '{"session_id":"check-tracked","cwd":"/absolute/path/to/tracked-checkout","hook_event_name":"SessionStart","source":"startup"}' \
  | bash scripts/factory-session-brief-hook.sh claude

printf '%s\n' '{"session_id":"check-untracked","cwd":"/absolute/path/to/untracked-directory","hook_event_name":"SessionStart","source":"startup"}' \
  | bash scripts/factory-session-brief-hook.sh codex
```

The tracked case prints the client-specific context payload when the checkout
matches exactly one Project. The untracked case should produce no output and
exit 0. The same silent result is expected for ambiguous Project matches and
for unavailable local prerequisites.

Codex records trusted hook hashes in `~/.codex/config.toml` under
`[hooks.state]`. It may prompt you to review and trust this hook the first time
the installed command is new or changes.
