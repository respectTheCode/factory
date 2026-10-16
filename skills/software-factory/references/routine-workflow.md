# Routine Factory reporting

Use this for ordinary work on an existing Factory Task. For planning or record
maintenance, use the CLI and maintenance reference.

## Resolve the work

Use a fresh session-start brief when it clearly identifies the project and Task. A
brief is bounded context, not a complete record: inspect the selected Task and its
current status before reporting. If identity or scope is unclear, use compact project
context and inspect the candidate Task. Do not choose among ambiguous Projects or Tasks
by guessing, and do not rewrite historical branch metadata to make a match.

For a configured remote client, load the operator-managed environment and confirm it
is usable before reporting:

    set -a
    . "$HOME/.config/factory/env"
    set +a
    "$FACTORY_CLI" doctor --json

Use that configured endpoint and credential. Omit --database from remote commands; do
not substitute an old URL or combine a remote endpoint with a local database. On the
Factory host, use the local CLI and explicit database only for authorized host work.
Never print or paste a token. T3 observations are read-only.

Set FACTORY_REPORTER to codex or claude for the active client. Reports must use that
identity.

## Report the Task

Read Task status at the start of the work and retain its workflowEpoch for every report
from that work. Do not fetch a newer epoch to bypass a reopen conflict. Use Task-level
reports even when the Task has no Steps:

    bun run src/cli.ts task status --task-id TASK_ID --json --database "$FACTORY_DB"

    bun run src/cli.ts task report --task-id TASK_ID --workflow-epoch WORKFLOW_EPOCH --state in_progress --reporter "$FACTORY_REPORTER" --evidence "Work started" --json --database "$FACTORY_DB"

Report blocked with a clear reason and finished with concrete evidence of what changed
and what was checked. Before repeating a report, inspect the latest report; unchanged
observations are no-ops. After reporting, read Task status and keep the returned report
ID for the handoff. Include the tested revision or PR when relevant, checks actually
run, and remaining work.

In remote mode, invoke the configured Factory CLI instead of bun run src/cli.ts and
omit --database from every command. Reuse the same request key for an identical retry;
changed evidence needs a new key.

A finished report does not prove a deployment or human acceptance. For a code Task
whose finish rule requires PR merges, each required canonical PR needs fresh,
server-confirmed evidence that it reached the repository default branch. Missing or
unavailable GitHub evidence is not a merge. An explicitly requested human check remains
human-only and opt-in.

## Use Steps only as checklists

Create Steps when a real checklist helps divide the work. Report directly on a Step
when useful; Step reports do not finish or reopen the Task. Do not create report-only
children to satisfy a lifecycle or approval stage. A Task may finish with Steps still
open; the detail view keeps those Steps visible as unfinished.

## Optional session association

A session association can connect a known T3 session to a Factory Task. It is metadata,
not a reporting prerequisite. Associate only a thread and source that are known and
unambiguous. Never guess based on a branch, and do not let unmatched, unavailable, or
external sessions suppress a valid Task report. If the association cannot be
established safely, leave it absent and continue with the resolved Factory work.

## Keep reads honest

Agent-facing reads are bounded. When a result says it is truncated or returns a cursor,
continue paging before treating it as complete. Use a cursor only with the same command
and target. Prefer compact context for selection and expand only the Task, history, or
evidence needed for the next decision.

## Handoff

Name the affected Task ID, report ID, outcome, checks performed, and remaining work.
State whether required PRs are merged when verified. Keep review, merge, deployment,
and human acceptance as separate facts. Do not invent approval records or turn
historical claims into new decisions.
