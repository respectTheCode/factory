---
name: software-factory
description: Use the Software Factory CLI to create and inspect project work, report subtask status, and leave human verification to the PWA.
---

# Software Factory

Use the CLI from the Factory checkout so agent updates share the same SQLite
state as the PWA. The CLI emits one stable JSON object per command with
`schemaVersion: 1`.

Set the database explicitly when working outside the default local database:

```bash
FACTORY_DB=factory.sqlite
```

Check database integrity and persisted record counts before or after maintenance:

```bash
bun run src/cli.ts database check --database "$FACTORY_DB" --json
```

Common operations:

```bash
bun run src/cli.ts project list --json --database "$FACTORY_DB"
bun run src/cli.ts project create --name "Project name" --database "$FACTORY_DB"
bun run src/cli.ts project status --project-id PROJECT_ID --json --database "$FACTORY_DB"
bun run src/cli.ts project portfolio --json --database "$FACTORY_DB"
bun run src/cli.ts task create --project-id PROJECT_ID --name "Task name" --database "$FACTORY_DB"
bun run src/cli.ts subtask create --task-id TASK_ID --name "Subtask name" --description "What must be checked" --database "$FACTORY_DB"
bun run src/cli.ts subtask report --json --subtask-id SUBTASK_ID --state in_progress --reporter codex --evidence "What changed" --database "$FACTORY_DB"
bun run src/cli.ts subtask status --json --task-id TASK_ID --database "$FACTORY_DB"
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
  --acceptance-criteria "First check|Second check" \
  --dependencies "Prerequisite A|Prerequisite B" \
  --repository-links "https://github.com/app-press/factory" \
  --database "$FACTORY_DB"
```

Agents may report `not_started`, `in_progress`, `blocked`, or `complete`.
Reports are append-only. A complete report remains `awaiting_verification`
until a human accepts it in the Factory dashboard. The noninteractive CLI
intentionally refuses verification so an agent cannot self-approve its work.

Tracker links are currently attached through the PWA or tRPC API and remain
references to the source item in Linear or Notion; Factory does not push
updates to either system.
