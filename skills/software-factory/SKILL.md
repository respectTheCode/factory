---
name: software-factory
description: Resolve and report authorized work in Factory-tracked projects; keep human acceptance separate from agent evidence.
---

# Software Factory

Use this skill for Factory-tracked work in Codex or Claude Code. Read the current Task,
do only the work the user authorized, and report evidence before handing it back.
Review-only requests permit reads and proposed corrections, not status changes.

## What Factory is for

Factory Home answers what needs you, what is in progress, and what finished today.
Task detail shows status, requests, recent history, read-only Steps, and collapsed
Evidence. All tasks holds planning and broader task controls.

T3 is where agents execute work. GitHub owns code review and merge. Linear and Notion
own product requirements and decisions. Factory records work and evidence; it does not
claim deployment. Reconcile conflicting scope with the source record and user rather
than silently changing it.

## Routine work

Use a fresh, unambiguous session-start brief when it identifies the project and Task.
Check the selected Task before reporting. Read compact project context only when
project identity or scope is unclear. Follow [the routine reporting workflow](references/routine-workflow.md)
for reports, evidence, and optional session association.

Report in progress when work starts, blocked with the blocker, and finished with
concrete evidence when the outcome is delivered. Unchanged observations are no-ops.
Retain the starting workflowEpoch; never refresh it to bypass a conflict. The routine
workflow has the reporting details.

Steps are optional checklists that support execution. They are not report-only children
or approval stages.

## Authority boundaries

A required code Task finishes only when every required canonical PR has
server-confirmed merge evidence showing the code reached the default branch. A human
check is opt-in and can be recorded only by a human. Keep work completion, PR review,
merge, deployment, and human acceptance distinct.

Session association is optional metadata. Never guess a thread or source, and never
delay a valid report to repair a missing association.

Use the reporter identity for the active client: codex or claude. Do not borrow another
identity or expose credential values. T3 observations are read-only. In remote mode,
use the configured Factory CLI and do not combine its endpoint with a local database.

## Read only what the task needs

- For normal Task reporting, read [the routine reporting workflow](references/routine-workflow.md).
- For task planning, edits, archive or restore, screenshots, backups, or database maintenance, read [the CLI and maintenance reference](references/cli-and-maintenance.md).
- For reviewer compatibility and historical permissions, read [reviewer acceptance](references/reviewer-acceptance.md).
- To copy or verify this source skill on Codex and Claude Code machines, read [skill installation](references/installation.md).

Preserve historical reports and verification records. A session ending by itself is
never evidence that work finished.
