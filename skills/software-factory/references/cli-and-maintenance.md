<!-- Simplified workflow: Task reports replace mandatory report-only children. -->
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

Reports optionally record structured handoff and revision evidence. Supply
`--next-owner`, `--next-owner-kind` (`human`, `agent`, or `unknown`), and
`--next-action` together. Add `--dependency` for context and pipe-separated
`--waiting-on-subtask-ids` for other Subtasks of the same Task. These fields record
who should act next; they never dispatch work or change the underlying blocker.
`--tested-revision` accepts a 7–40 character hexadecimal revision, normalized to
lowercase; use the full SHA to establish an exact PR-head match. `--artifacts-json`
accepts up to 20 objects with `label`, an HTTP(S) `url` without credentials,
`kind` (`artifact`, `preview`, `test`, or `review`), and optional `testedRevision`.
Artifact and preview links are reported claims, not verified deployment status.

```bash
bun run src/cli.ts subtask report --subtask-id SUBTASK_ID --state complete \
  --reporter "$FACTORY_REPORTER" \
  --evidence "Focused checks passed locally" --tested-revision FULL_COMMIT_SHA \
  --artifacts-json '[{"label":"Candidate preview","url":"https://preview.example.test","kind":"preview"}]' \
  --json --database "$FACTORY_DB"
```

Use the configured remote environment and omit `--database` in remote mode. On a
retry reuse the same `--request-key` for the identical report; a changed claim
needs a new key. A Step completion report changes the Step directly. Task completion follows its finish rule;
only an explicitly requested human check waits for human confirmation.

Screenshot proof is scoped to one Task or Subtask. Uploads retain a caller-supplied
`--request-key` in remote mode so a retry after an uncertain response is idempotent; reuse
the same key for the same file and metadata, and choose a new key for a changed upload.
Uploads accept PNG, JPEG, and static WebP images up to 5 MiB; animated WebP is unsupported. `screenshot list` returns metadata only,
is bounded by `--limit` (maximum 100), and continues with its returned `--cursor`. `screenshot
get` also returns metadata only unless `--output` is explicitly supplied for the image bytes.

The upload check verifies supported container integrity, dimensions, lengths, and checksums; it
does not decode pixels. Treat an image as visual proof only after the dashboard preview loads;
preview failures are shown explicitly and can be retried.

```bash
# Local host maintenance uses an explicit database.
bun run src/cli.ts screenshot upload --task-id T-38 --file ./proof.png \
  --content-type image/png --caption "Task dashboard proof" \
  --database "$FACTORY_DB"
bun run src/cli.ts screenshot list --task-id T-38 --limit 50 \
  --database "$FACTORY_DB"
bun run src/cli.ts screenshot get --screenshot-id SCREENSHOT_ID \
  --output ./proof-download.png --database "$FACTORY_DB"

# Remote agent mode uses FACTORY_URL and FACTORY_ACCESS_TOKEN_FILE and omits --database.
FACTORY_URL="$FACTORY_URL" FACTORY_ACCESS_TOKEN_FILE="$FACTORY_ACCESS_TOKEN_FILE" \
  bun run src/cli.ts screenshot upload --subtask-id ST-173 --file ./proof.png \
  --content-type image/png --caption "Subtask proof" \
  --request-key screenshot-st173-1
FACTORY_URL="$FACTORY_URL" FACTORY_ACCESS_TOKEN_FILE="$FACTORY_ACCESS_TOKEN_FILE" \
  bun run src/cli.ts screenshot list --subtask-id ST-173 --limit 50
FACTORY_URL="$FACTORY_URL" FACTORY_ACCESS_TOKEN_FILE="$FACTORY_ACCESS_TOKEN_FILE" \
  bun run src/cli.ts screenshot get --screenshot-id SCREENSHOT_ID \
  --output ./proof-download.png
```

Agent-facing read bounds:

- `project list` caps Projects at 50; `project context` caps Tasks at 50;
  `project portfolio` caps Projects at 50; `project attention` caps items at 100; and
  local-only `credential list` caps credential records at 50 without exposing token values.
- `task status` and `subtask status` cap Subtask rows at 100; `project t3-status` caps sources
  at 20; GitHub check/workflow runs cap at 50 each; and session-detail findings cap at 50.
- `task history` and `subtask history` cap events or reports at 100 and accept
  `--tail N` or `--since ISO_TIMESTAMP`.
  Use the returned `--cursor` to continue a page. History cursors bind the normalized `--since`
  filter and use the timestamp and report ID together, so a cursor cannot continue with a
  changed or missing filter and equal timestamps remain stable. GitHub status returns a composite
  `--cursor` for both check and workflow runs; `--check-runs-cursor` and `--workflow-runs-cursor`
  are field-specific alternatives.

All bounded list reads accept `--limit` up to their route cap and emit `truncated: true`, a
non-null `nextCursor`, and a stderr warning when rows were omitted. `--limit` exact-cap and
empty reads are complete and report `truncated: false` with `nextCursor: null`. Cursors are
scoped to their command and Task/Subtask target. `task detail --summary` and
`project context --compact` retain IDs, states, reasons, count fields, and project mappings while
omitting long free-text values, expanded link/history content, and nested Subtask rows. Compact
context returns `subtaskCount`; use bounded `task status --task-id` for nested rows or
`subtask status --task-id` for the same nested status view. Full `project context` includes nested Subtask rows
without a separate nested cap, so prefer compact context for large projects.

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
Signed-in humans can manage agent credentials at `/connections`, including changing
Project access without replacing the agent's token. Creation and rotation show the new
token once; save it in the agent's owner-only token file before dismissing it. Revocation
disables the credential. Coding and reviewer credentials cannot administer credentials.
See [the Connections guide](../../../docs/t3-multiple-sources.md#agent-credentials-and-project-access).

CLI credential administration remains local-only and runs on the service host with the
service's database:

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
reorder Tasks or Steps. Direct Step reports change their state without approval;
Task state and completion are independent of Step counts. CLI output retains schemaVersion 1.

Steps accept `backlog`, `not_started`, `in_progress`, `blocked`, or `complete`.
Blocked reports require a reason; Done needs no mandatory reason or verification.
Tasks accept `in_progress`, `blocked`, or `finished` reports, including on zero-Step Tasks.
Retain `workflowEpoch` from `task status` when starting work and pass it explicitly with
`--workflow-epoch`, including epoch `0`. A stale epoch after reopening is a conflict;
do not fetch a newer epoch just to resubmit an old claim.
A finished report completes an agent-report Task, or leaves a code Task In review until
required PRs reach the default branch. Either rule may opt into a human check. Human-only
check, reopen, and reasoned mark-done actions cannot be performed by coding or reviewer
credentials. Historical compatibility reviews remain described in
[historical reviewer acceptance](reviewer-acceptance.md).

`task finish-rule --task-id TASK_ID --kind pr_merge|agent_report` saves a finish-rule
edit. `--require-human-check true` requires `--human-check-text`. Remote edits require
a human session. The command reads one current Task snapshot to supply the revision,
workflow epoch, and complete canonical PR requirement list. To preserve a previously
opened edit, supply `--expected-revision` and `--expected-workflow-epoch`; a stale
guard fails rather than applying the draft to newer work. Optional
`--pull-request-requirements-json` accepts the complete array of
`{"pullRequestUrl":"https://github.com/org/repository/pull/123","required":true}`
rows. The rule and requirements save together, and Activity records the actor and
changes. Removing a requirement can finish the Task if every remaining required PR
has reached the default branch. Local maintenance can supply `--actor`; remote
attribution comes from the authenticated identity.
