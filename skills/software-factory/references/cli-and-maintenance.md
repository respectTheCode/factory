# Factory CLI and maintenance reference

Read this for task creation/edits, archive/restore, backups, or database maintenance. The entrypoint owns the reporting loop.

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

Agent-facing read bounds:

- `project list` caps Projects at 50; `project context` caps Tasks at 50;
  `project portfolio` caps Projects at 50; `project attention` caps items at 100; and
  local-only `credential list` caps credential records at 50 without exposing token values.
- `task status` and `subtask status` cap Subtask rows at 100; `project t3-status` caps sources
  at 20; GitHub check/workflow runs cap at 50 each; and session-detail findings cap at 50.
- `subtask history` caps reports at 100 and accepts `--tail N` or `--since ISO_TIMESTAMP`.
  Use the returned `--cursor` to continue a page. History cursors use the timestamp and report
  ID together, so equal timestamps remain stable.

All bounded list reads accept `--limit` up to their route cap and emit `truncated: true`, a
non-null `nextCursor`, and a stderr warning when rows were omitted. `--limit` exact-cap and
empty reads are complete and report `truncated: false` with `nextCursor: null`. Cursors are
scoped to their command and Task/Subtask target. `task detail --summary` and
`project context --compact` retain IDs, states, reasons, and count fields while omitting long
free-text values and expanded link/history content.

Tasks and Subtasks expose both an internal UUID `id` and a durable human-readable `simpleId`.
Tasks use `T-<number>` and Subtasks use `ST-<number>`. Every `--task-id`, `--subtask-id`,
`--task-ids`, and `--subtask-ids` flag accepts either form; prefer the simple reference when
communicating with Kevin or another agent. UUIDs remain the relationship keys, and simple IDs
are never reused after deletion. CLI and project-brief JSON output retain both values; the brief's
commands use the simple references.

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

Remote mode uses `FACTORY_URL` and `FACTORY_ACCESS_TOKEN_FILE` and omits `--database`.
Credential administration is local-only and runs on the service host with the service's
database:

```bash
bun run src/cli.ts doctor --json
bun run src/cli.ts credential create --machine-id mac-studio --project-ids "PROJECT_ID|OTHER_ID" \
  --json --database "$FACTORY_DB"   # prints the token once; store it in the machine's 0600 file
bun run src/cli.ts credential list --json --database "$FACTORY_DB"
bun run src/cli.ts credential revoke --machine-id mac-studio --json --database "$FACTORY_DB"
```

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
