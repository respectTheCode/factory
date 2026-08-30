---
name: software-factory
description: Use the Software Factory CLI to create and inspect project work, report subtask status, and leave human verification to the PWA.
---

# Software Factory

Use the CLI from the Factory checkout so agent updates share the same SQLite
state as the PWA. The CLI emits one stable JSON object per command with
`schemaVersion: 1`. Each SQLite client refreshes persisted state before its operation, so a
running PWA and a CLI/skill can share the database without requiring a server restart.

Set the database explicitly when working outside the default local database:

```bash
FACTORY_CHECKOUT="${FACTORY_CHECKOUT:-/Users/agent/Projects/factory}"
FACTORY_DB="${FACTORY_DB:-$FACTORY_CHECKOUT/factory.sqlite}"
```

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
  --git-origin-url "git@github.com:org/repository.git" \
  --branch-name "GRA-143-preview-environments" --json --database "$FACTORY_DB"
bun run src/cli.ts project create --name "Project name" --database "$FACTORY_DB"
bun run src/cli.ts project create --name "Project name" \
  --git-origin-url "git@github.com:org/repository.git" --database "$FACTORY_DB"
bun run src/cli.ts project update --project-id PROJECT_ID \
  --git-origin-url "git@github.com:org/repository.git" --database "$FACTORY_DB"
bun run src/cli.ts project status --project-id PROJECT_ID --json --database "$FACTORY_DB"
bun run src/cli.ts project portfolio --json --database "$FACTORY_DB"
bun run src/cli.ts project link --project-id PROJECT_ID --system notion --stable-id PRO-1412 --url "https://…" --database "$FACTORY_DB"
bun run src/cli.ts task create --project-id PROJECT_ID --name "Task name" --database "$FACTORY_DB"
bun run src/cli.ts task create --project-id PROJECT_ID --name "Task name" \
  --branch-name "GRA-143-preview-environments" --database "$FACTORY_DB"
bun run src/cli.ts task update --task-id TASK_ID \
  --title "Task title" --description "What success looks like" \
  --acceptance-criteria "First check|Second check" \
  --branch-name "GRA-143-preview-environments" --database "$FACTORY_DB"
bun run src/cli.ts task detail --task-id TASK_ID --json --database "$FACTORY_DB"
bun run src/cli.ts task state --task-id TASK_ID --state active --database "$FACTORY_DB"
bun run src/cli.ts task state --task-id TASK_ID --state blocked \
  --reason "What is blocking the work and what must be checked" --database "$FACTORY_DB"
bun run src/cli.ts task reorder --project-id PROJECT_ID --state planned \
  --task-ids TASK_ID_2\|TASK_ID_1 --database "$FACTORY_DB"
bun run src/cli.ts task status --task-id TASK_ID --json --database "$FACTORY_DB"
bun run src/cli.ts task archive --task-id TASK_ID --state released --database "$FACTORY_DB"
bun run src/cli.ts task restore --task-id TASK_ID --database "$FACTORY_DB"
bun run src/cli.ts task link --task-id TASK_ID --system linear --stable-id GRA-143 --url "https://…" --database "$FACTORY_DB"
bun run src/cli.ts subtask create --task-id TASK_ID --name "Subtask name" --description "What must be checked" --database "$FACTORY_DB"
bun run src/cli.ts subtask update --subtask-id SUBTASK_ID \
  --title "Subtask title" --description "What must be checked" --database "$FACTORY_DB"
bun run src/cli.ts subtask report --json --subtask-id SUBTASK_ID --state in_progress --reporter codex --evidence "What changed" --database "$FACTORY_DB"
bun run src/cli.ts subtask report --json --subtask-id SUBTASK_ID --state backlog \
  --reason "What I need to check before starting" --reporter codex --database "$FACTORY_DB"
bun run src/cli.ts subtask reorder --task-id TASK_ID --state planned \
  --subtask-ids SUBTASK_ID_2\|SUBTASK_ID_1 --database "$FACTORY_DB"
bun run src/cli.ts subtask status --json --task-id TASK_ID --database "$FACTORY_DB"
bun run src/cli.ts subtask history --subtask-id SUBTASK_ID --json --database "$FACTORY_DB"
bun run src/cli.ts subtask archive --subtask-id SUBTASK_ID --state wont_do --database "$FACTORY_DB"
bun run src/cli.ts subtask restore --subtask-id SUBTASK_ID --database "$FACTORY_DB"
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
existing `--branch-name` update; at least one edit field is required, and titles must not be
blank. `--acceptance-criteria` replaces the Task's criteria, using `|` between entries; an empty
value clears them.

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

For coding work, resolve the current checkout before reading or reporting Factory work. The CLI
normalizes common HTTPS, SSH URL, and SCP-style Git origins. `project context` fails closed when
the origin matches zero or multiple Projects, or when a supplied branch matches zero or multiple
Tasks:

```bash
REPO_CHECKOUT="$(git rev-parse --show-toplevel)"
GIT_ORIGIN="$(git -C "$REPO_CHECKOUT" remote get-url origin)"
GIT_BRANCH="$(git -C "$REPO_CHECKOUT" branch --show-current)"
cd "$FACTORY_CHECKOUT"
bun run src/cli.ts project context --git-origin-url "$GIT_ORIGIN" \
  --branch-name "$GIT_BRANCH" --json --database "$FACTORY_DB"
bun run src/cli.ts project attention --git-origin-url "$GIT_ORIGIN" \
  --json --database "$FACTORY_DB"
bun run src/cli.ts task detail --task-id TASK_ID --json --database "$FACTORY_DB"
bun run src/cli.ts subtask history --subtask-id SUBTASK_ID --json --database "$FACTORY_DB"
```

If the checkout is detached and `git branch --show-current` is empty, omit `--branch-name` and
inspect the returned Project Tasks. Do not infer a Project or Task after a resolver error; ask
Kevin to correct missing or duplicate Factory context.

When work starts, submit `in_progress`. Submit `blocked` with the blocker in `--evidence`, or
submit `complete` only when the evidence is ready for Kevin to review. Reports are observations,
not approval; never attempt to verify from an agent process. After reporting, read the Task
status again and include the returned `report.id` in any handoff or summary.

Tracker links can be attached through the CLI, PWA, or tRPC API. They remain references to the
source item in Linear or Notion; Factory does not push updates to either system.

The resolved context includes Project Tracker Links plus matching Task planning, Subtasks, and
Task Tracker Links. Branch names are Factory context only; matching a Linear or Notion
identifier does not update that external system.

Use `released` when the work shipped and `wont_do` when it is intentionally abandoned. These
Archive States remain visible in the project and history, disappear from Attention, and can be
restored without deleting Status Reports or Verifications. Archiving a Subtask does not archive
its parent Task.
