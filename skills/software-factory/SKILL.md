---
name: software-factory
description: Keep Software Factory tasks and subtasks current during coding, planning, review, and delivery work in Factory-tracked projects. Use at work start and handoff to resolve context, record evidence and blockers, and leave verification to the human.
---

# Software Factory

Codex and Claude share this operating loop. Check Factory at the start of work in a tracked
project and reconcile the affected records before the final handoff. A review-only request
permits reads and proposed corrections, not status mutations. When implementation or data
maintenance is authorized, updating its Factory records is part of that work.

Set `FACTORY_REPORTER=codex` for Codex or `FACTORY_REPORTER=claude` for Claude. Use that
identity for reports; do not copy another client's attribution from an example.

Use the CLI from the Factory checkout so agent updates share the same SQLite
state as the PWA. The CLI emits one stable JSON object per command with
`schemaVersion: 1`. Each SQLite client refreshes persisted state before its operation, so a
running PWA and a CLI/skill can share the database without requiring a server restart.

Set the database explicitly when working outside the default local database:

```bash
FACTORY_CHECKOUT="${FACTORY_CHECKOUT:-/Users/agent/Projects/factory}"
FACTORY_DB="${FACTORY_DB:-$FACTORY_CHECKOUT/factory.sqlite}"
export T3_BASE_URL="${T3_BASE_URL:-http://127.0.0.1:3773}"
export T3_ACCESS_TOKEN_FILE="${T3_ACCESS_TOKEN_FILE:-$HOME/Library/Application Support/Factory/secrets/t3-read-token}"
```

The read-only token file is operator-provisioned with mode `0600`, and T3 reads are read-only.
Never print, echo, or paste the token into a handoff.

Check database integrity and persisted record counts before or after maintenance:

```bash
bun run src/cli.ts database check --database "$FACTORY_DB" --json
```

Common operations:

```bash
bun run src/cli.ts project list --json --database "$FACTORY_DB"
bun run src/cli.ts project list --git-origin-url "git@github.com:org/repository.git" \
  --json --database "$FACTORY_DB"
bun run src/cli.ts project attention --json --database "$FACTORY_DB"
bun run src/cli.ts project context \
  --workspace-root "/absolute/path/to/repository" \
  --git-origin-url "git@github.com:org/repository.git" \
  --branch-name "GRA-143-preview-environments" --json --database "$FACTORY_DB"
bun run src/cli.ts project brief \
  --workspace-root "/absolute/path/to/repository" \
  --branch-name "GRA-143-preview-environments" --json --database "$FACTORY_DB"
bun run src/cli.ts project create --name "Project name" --database "$FACTORY_DB"
bun run src/cli.ts project create --name "Project name" \
  --git-origin-url "git@github.com:org/repository.git" --database "$FACTORY_DB"
bun run src/cli.ts project update --project-id PROJECT_ID \
  --git-origin-url "git@github.com:org/repository.git" --database "$FACTORY_DB"
bun run src/cli.ts project status --project-id PROJECT_ID --json --database "$FACTORY_DB"
bun run src/cli.ts project t3-status --project-id PROJECT_ID --json --database "$FACTORY_DB"
bun run src/cli.ts project portfolio --json --database "$FACTORY_DB"
bun run src/cli.ts project link --project-id PROJECT_ID --system notion --stable-id PRO-1412 --url "https://…" --database "$FACTORY_DB"
bun run src/cli.ts task create --project-id PROJECT_ID --name "Task name" --database "$FACTORY_DB"
bun run src/cli.ts task create --project-id PROJECT_ID --name "Task name" \
  --branch-name "GRA-143-preview-environments" --database "$FACTORY_DB"
bun run src/cli.ts task update --task-id TASK_ID \
  --title "Task title" --description "What success looks like" \
  --acceptance-criteria "First check|Second check" \
  --branch-name "GRA-143-preview-environments" --database "$FACTORY_DB"
bun run src/cli.ts task update --task-id TASK_ID \
  --pull-request-url "https://github.com/org/repository/pull/123" \
  --database "$FACTORY_DB"
bun run src/cli.ts task detail --task-id TASK_ID --json --database "$FACTORY_DB"
bun run src/cli.ts task state --task-id TASK_ID --state active --database "$FACTORY_DB"
bun run src/cli.ts task state --task-id TASK_ID --state blocked \
  --reason "What is blocking the work and what must be checked" --database "$FACTORY_DB"
bun run src/cli.ts task reorder --project-id PROJECT_ID --state planned \
  --task-ids TASK_ID_2\|TASK_ID_1 --database "$FACTORY_DB"
bun run src/cli.ts task status --task-id TASK_ID --json --database "$FACTORY_DB"
bun run src/cli.ts task github-status --task-id TASK_ID --json --database "$FACTORY_DB"
bun run src/cli.ts task archive --task-id TASK_ID --state released --database "$FACTORY_DB"
bun run src/cli.ts task restore --task-id TASK_ID --database "$FACTORY_DB"
bun run src/cli.ts task link --task-id TASK_ID --system linear --stable-id GRA-143 --url "https://…" --database "$FACTORY_DB"
bun run src/cli.ts subtask create --task-id TASK_ID --name "Subtask name" --description "What must be checked" --database "$FACTORY_DB"
bun run src/cli.ts subtask update --subtask-id SUBTASK_ID \
  --title "Subtask title" --description "What must be checked" \
  --pull-request-url "https://github.com/org/repository/pull/124" \
  --database "$FACTORY_DB"
bun run src/cli.ts subtask report --json --subtask-id SUBTASK_ID --state in_progress --reporter "$FACTORY_REPORTER" --evidence "What changed" --database "$FACTORY_DB"
bun run src/cli.ts subtask report --json --subtask-id SUBTASK_ID --state backlog \
  --reason "What I need to check before starting" --reporter "$FACTORY_REPORTER" --database "$FACTORY_DB"
bun run src/cli.ts subtask reorder --task-id TASK_ID --state planned \
  --subtask-ids SUBTASK_ID_2\|SUBTASK_ID_1 --database "$FACTORY_DB"
bun run src/cli.ts subtask status --json --task-id TASK_ID --database "$FACTORY_DB"
bun run src/cli.ts subtask github-status --subtask-id SUBTASK_ID --json --database "$FACTORY_DB"
bun run src/cli.ts subtask history --subtask-id SUBTASK_ID --json --database "$FACTORY_DB"
bun run src/cli.ts subtask archive --subtask-id SUBTASK_ID --state wont_do --database "$FACTORY_DB"
bun run src/cli.ts subtask restore --subtask-id SUBTASK_ID --database "$FACTORY_DB"
bun run src/cli.ts session auto-link --project-id PROJECT_ID --task-id TASK_ID \
  --branch-name "GRA-143-preview-environments" --json --database "$FACTORY_DB"
bun run src/cli.ts session link --thread-id THREAD_ID --project-id PROJECT_ID \
  --task-id TASK_ID --json --database "$FACTORY_DB"
bun run src/cli.ts session unlink --thread-id THREAD_ID --association-id ASSOCIATION_ID \
  --json --database "$FACTORY_DB"
```

After taking a backup, remove a project only when its ID has been checked; removal cascades
its Tasks, Subtasks, Status Reports, Verifications, and Tracker Links:

```bash
bun run src/cli.ts project remove --project-id PROJECT_ID --confirm --database "$FACTORY_DB"
```

Create a point-in-time SQLite backup before maintenance or any larger batch of updates:

```bash
bun run src/cli.ts database backup --database "$FACTORY_DB" \
  --output "backups/factory-$(date +%Y-%m-%d).sqlite" --json
```

Backups refuse to replace an existing file unless `--overwrite` is explicit. The command
creates missing parent directories and leaves the live database unchanged. Keep backups on
storage separate from the live checkout; restore is an operator action after stopping the
Factory server.

Task planning lists use a pipe separator when passed through one shell flag:

```bash
bun run src/cli.ts task create --project-id PROJECT_ID --name "Task name" \
  --objective "What success looks like" --priority high --owner kevin \
  --branch-name "GRA-143-preview-environments" \
  --acceptance-criteria "First check|Second check" \
  --dependencies "Prerequisite A|Prerequisite B" \
  --repository-links "https://github.com/app-press/factory" \
  --database "$FACTORY_DB"
```

Task and Subtask edits accept any combination of their editable fields. `--title` updates the
stored `name`; Task `--description` updates its stored `objective`, while Subtask `--description`
updates its stored `description`. A blank description clears it. Task edits also retain the
existing `--branch-name` update and accept `--pull-request-url` (or the shorter `--pr`) to attach
or replace a canonical GitHub PR URL. Pass an empty PR URL to clear it. At least one edit field is
required, and titles must not be blank. `--acceptance-criteria` replaces the Task's criteria,
using `|` between entries; an empty value clears them.

The `task github-status` and `subtask github-status` reads fetch the linked private GitHub PR and
the Actions runs for its exact head commit. They are read-only observations and never change
Factory Work State or human Verification. The Factory server reads `GITHUB_TOKEN` (or `GH_TOKEN`)
from its process environment; credentials are not stored in SQLite or emitted in CLI output. A
missing token, denied private-repository access, or unavailable GitHub service is reported as an
explicit status instead of being treated as passing.

Agents may change acceptance criteria only during the planning phase. Run `task status` first and
make the edit only when the Task state is `planned`, before implementation begins. The CLI rejects
criteria edits once the Task is active, blocked, awaiting verification, completed, or archived.

Agents may directly move Tasks between `backlog`, `planned`, `active`,
`awaiting_verification`, and `blocked` with `task state`, and may
reorder Tasks or Subtasks within one state. Moving into `blocked` or
`awaiting_verification` requires `--reason`; direct state changes never rewrite
Subtasks. Completed is set by human verification in the Factory dashboard and
cannot be assigned by an agent through this CLI. State changes are durable and
remain `schemaVersion: 1` in CLI output.

Agents may report `backlog`, `not_started`, `in_progress`, `blocked`, or `complete`.
Reports are append-only. Reports for `blocked` and `complete` require `--reason`
describing the blocker or the verification check. A complete report remains
`awaiting_verification` until a human accepts it in the Factory dashboard. The
noninteractive CLI intentionally refuses verification so an agent cannot
self-approve its work; rejected or deferred verification reasons remain a
human-only PWA concern.

## Agent operating loop

Session-start hooks inject `project brief` as the session's bounded starting context. It is
capped at 8000 characters by default with a truncation notice when the cap is reached. A
truncated brief is never a complete record; run `task detail` for the full Task record. The
brief is a starting point, not a substitute for the loop below.

For coding work, resolve the current checkout before reading or reporting Factory work. First
resolve the Project without a branch filter and inspect its existing Tasks. Then use the branch
filter when it identifies the work. The CLI
normalizes common HTTPS, SSH URL, and SCP-style Git origins plus absolute workspace roots.
`project context` fails closed when every supplied Project identity does not resolve to exactly
one Project, or when a supplied branch matches zero or multiple Tasks:

```bash
REPO_CHECKOUT="$(git rev-parse --show-toplevel)"
GIT_ORIGIN="$(git -C "$REPO_CHECKOUT" remote get-url origin 2>/dev/null || true)"
GIT_BRANCH="$(git -C "$REPO_CHECKOUT" branch --show-current)"
export T3_BASE_URL="${T3_BASE_URL:-http://127.0.0.1:3773}"
export T3_ACCESS_TOKEN_FILE="${T3_ACCESS_TOKEN_FILE:-$HOME/Library/Application Support/Factory/secrets/t3-read-token}"
cd "$FACTORY_CHECKOUT"
if [[ -n "$GIT_ORIGIN" ]]; then
  CONTEXT_SELECTOR=(--git-origin-url "$GIT_ORIGIN")
else
  CONTEXT_SELECTOR=(--workspace-root "$REPO_CHECKOUT")
fi
bun run src/cli.ts project context "${CONTEXT_SELECTOR[@]}" \
  --json --database "$FACTORY_DB"
# For a task-specific branch, resolve its unique Task as well:
if [[ -n "$GIT_BRANCH" ]]; then
  bun run src/cli.ts project context "${CONTEXT_SELECTOR[@]}" \
    --branch-name "$GIT_BRANCH" --json --database "$FACTORY_DB"
fi
# Continue below only after selecting the correct PROJECT_ID and TASK_ID.
bun run src/cli.ts project t3-status --project-id PROJECT_ID \
  --json --database "$FACTORY_DB"
if [[ -n "$GIT_BRANCH" ]]; then
  bun run src/cli.ts session auto-link --project-id PROJECT_ID --task-id TASK_ID \
    --branch-name "$GIT_BRANCH" --json --database "$FACTORY_DB"
fi
bun run src/cli.ts project attention "${CONTEXT_SELECTOR[@]}" \
  --json --database "$FACTORY_DB"
bun run src/cli.ts task detail --task-id TASK_ID --json --database "$FACTORY_DB"
bun run src/cli.ts subtask history --subtask-id SUBTASK_ID --json --database "$FACTORY_DB"
```

Immediately after `project context` resolves exactly one Project and Task, run `session auto-link`
with those IDs and the current branch. The command reads current T3 activity and adds an idempotent
Factory Work Association only when exactly one running T3 thread has that branch. Use
`project t3-status --project-id ... --json` as the quick way to confirm the connection state is
`connected`.
Treat `linked` as success. If it returns `unmatched` or `ambiguous`, create no association, continue
only with the resolved Factory work, and name the missing or candidate thread IDs in the handoff; do
not guess. Any transport state (`not_configured`, `unreachable`, `authentication_failed`,
`permission_denied`, `incompatible`, `invalid_response`, or `unavailable`) also creates no
association. Continue with the resolved Factory work only, report the exact status string in the
handoff so Kevin can fix the service or credential, and never retry by guessing a thread ID or by
using `session link` to work around it.

A Code Session may have zero, one, or many Work Associations. Automatic Task association does not
replace existing associations. When the agent selects a specific Subtask, run `session auto-link`
again with `--subtask-id`; this adds the Subtask association idempotently. Use explicit `session
link` or the PWA's collapsed **Manage associations** section only as a fallback. Remove one
association with its `--association-id`; never remove unrelated associations. Association changes
are Factory metadata only and never change T3, Work State, Status Reports, or Verification.

If the checkout has no Git remote, the normalized absolute workspace root remains sufficient. Workspace matching removes trailing
slashes and lexical dot segments; it does not resolve symlinks. Stored or remote relative roots
are not Project identities: correct their metadata to an absolute root rather than guessing. If the
checkout is detached and `git branch --show-current` is empty, omit the branch-filtered command
and automatic session association.

A missing branch match on `main`, `master`, or a maintenance branch does not mean the Project is
missing. Use the successful Project-only result to inspect Task details and histories. Select an
existing Task only when the user's stated scope or explicit Task ID identifies it unambiguously;
do not rewrite historical branch names to make a resolver pass. For authorized new work with no
existing matching outcome, create a bounded Task and reportable Subtasks after checking for
duplicates. If the intended Task remains ambiguous, report the candidates and leave those records
unchanged. A missing or duplicate Project identity still fails closed: ask Kevin to resolve it.

Session association is optional metadata, not a prerequisite for reporting resolved work. T3
observes only sessions available through its API; a Codex or Claude session outside T3 may have
no match. Never claim it was linked, invent its identity, or let that failure suppress the work
report.

When work starts, submit `in_progress`. Submit `blocked` with the blocker in `--evidence`, or
submit `complete` only when the evidence is ready for Kevin to review. Reports are observations,
not approval; never attempt to verify from an agent process. After reporting, read the Task
status again and include the returned `report.id` in any handoff or summary.

For an authorized Task with no Subtasks, use `task state --state active` at work start and
create a concrete reportable Subtask for the outcome before submitting a status report. There
is no Task-level `report` command. Do not create artificial progress for a read-only inspection.

Before appending, read the latest report. Append when the state, evidence, blocker, or concrete
human check changed; an unchanged observation is a no-op. Include the observed revision or PR,
checks actually run, and remaining checks. Distinguish implementation, merge, deployment, and
human acceptance. Historical evidence is not a fresh deployment or production check. On a
metadata-only correction, use `subtask update` rather than manufacturing a new progress report.

After child reports, inspect the parent. Automatic rollup uses all in-scope, non-archived
Subtasks: any blocker makes it blocked; all complete reports awaiting acceptance or already
accepted make it awaiting verification; partially delivered work remains active. Only current
human-accepted complete reports can yield completed. Adding, removing, archiving, or restoring
scope recomputes automatic parents and their display order; manual holds remain deliberate.

Avoid redundant `task state` writes: they create a manual hold. When an obsolete hold prevents
the parent from reflecting its Subtasks, use `task resume-rollup --task-id ... --json` (the UI
calls this **Use subtask status**) and inspect the returned status. This releases the hold without
creating reports or accepting anything. Preserve a hold that represents an unresolved decision
or blocker. Never archive unfinished work to make a parent look ready, reopen an accepted
Subtask merely to refresh its timestamp, or manufacture a report to release a parent hold.

Keep titles, descriptions, PR links, and remaining Subtasks aligned with the authorized scope.
Do not temporarily reset a started Task to `planned` to bypass the acceptance-criteria guard;
record a changed scope in the description and hand off any criteria change for human review.
The final handoff names affected Task/Subtask IDs, new report IDs, remaining work, and any
unresolved Factory or session association failure. A session ending alone is never evidence
that its work completed.

## Local installation

The maintained source is `skills/software-factory/SKILL.md` in the Factory checkout. Install the
same content for both local agents at `~/.codex/skills/software-factory/SKILL.md` and
`~/.claude/skills/software-factory/SKILL.md`, then compare their hashes with the source. Factory
service deployment does not install agent skills. New sessions must discover the installed
skill; an existing session's already-loaded instructions are not proof of adoption. Remote
agents need their own supported client and installation; these local paths do not configure them.

Tracker links can be attached through the CLI, PWA, or tRPC API. They remain references to the
source item in Linear or Notion; Factory does not push updates to either system.

The resolved context includes Project Tracker Links plus matching Task planning, Subtasks, and
Task Tracker Links. Branch names are Factory context only; matching a Linear or Notion
identifier does not update that external system.

Use `released` when the work shipped and `wont_do` when it is intentionally abandoned. These
Archive States remain visible in the project and history, disappear from Attention, and can be
restored without deleting Status Reports or Verifications. Archiving a Subtask does not archive
its parent Task.
