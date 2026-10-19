# Factory issue tracker pivot

Agreed with Kevin on 2026-10-16. Factory owns the issues; Linear and Multica are interface
references, not integrations or sources of truth.

## Product

The main screen is a compact issue list grouped by status, with project filtering, search,
labels, and zero or more GitHub pull requests. An issue contains a title and description,
labels, branch names, linked PRs, and matching T3 threads. Show the recent messages from each
thread and allow the human to send a reply to that thread. Use the matching T3 project
icon beside project names: preserve explicit emoji, monogram, and Lucide overrides, or
load the project favicon through Factory. Icon loading must not delay the issue list.

Show status groups in order: Done, Won’t do, Needs attention, In progress, To do. Each header toggles
its issue rows and shows the visible issue count; remember collapsed groups in this browser
across reloads. Keep all five headers visible, including empty and collapsed groups. Drag
an issue to reorder it within a group or drop onto any status, including collapsed groups;
persist issue order across reloads. Filtered
views preserve the relative order of hidden issues. Status moves retain the completion
rules below, including the open-PR guard.

Show saved issues immediately while refreshing T3 and GitHub observations in the background.
Remote source latency must not block the initial list. Polling displays refreshed activity
without requiring a page reload. Discovery runs at startup and every 30 seconds while the
server is running, including when the dashboard is closed. It backfills T3 threads updated
in the last three days and keeps finding new work across configured sources. Previously
unmatched T3 projects with recent work become Factory projects; ambiguous identity matches
are left unresolved. Feature-branch threads share an issue within a project. Default-branch
and branchless work is grouped by its parent T3 thread, with explicit links for delegated
threads. T3 PR lists and branch PR links are combined; GitHub remains the source of confirmed
merge evidence. Discovery receipts
prevent duplicate issues across refreshes/restarts and preserve deliberate issue deletions.

The issue dashboard and global connection indicator read
T3 shell observations without matching threads against historical Tasks or writing legacy
reconciliation state. Deployment environment metadata arrives in the HTML so the review
banner does not depend on an additional request.

Match threads by project repository and branch within their configured T3 source. Associations
persist when thread metadata changes. Multiple branches, threads, and PRs are supported.
Thread messages stay scoped to authenticated humans; credentials never reach the browser.

Humans can merge an issue into another issue in the same Project from its detail panel.
The confirmation identifies the issue being removed and the issue being kept. Keep the
destination's ID and title; combine labels, branches, PR links and evidence, descriptions
with source attribution, and T3 thread associations. Move discovery receipts to the
destination so subsequent discovery and restarts do not recreate the removed issue.
Apply the existing status rules to the combined evidence, preserving manual choices when
the merge adds no relevant new evidence. A merge is atomic; invalid destinations leave
both issues unchanged.

## Status rules

- To do: no work has started, or a manual move places the issue here.
- In progress: any associated thread is working, even if another thread has stopped.
- Needs attention: no associated thread is working and a thread has stopped. This does not
  assert that the result is ready for review.
- Automatic Done: one or more linked PRs exist and all are merged. Closed without merging
  does not automatically complete an issue.
- Won’t do: the human has decided the issue will not be finished. This status is manual and
  remains until the human moves it elsewhere, regardless of T3 activity or PR events.
- Done remains Done when threads receive messages or resume work after the merge.
- A newly linked or reopened PR reopens a Done issue. The human can also move it manually.
- The human can mark an issue Done regardless of linked PR state, including open PRs or
  unavailable evidence. Unchanged observations preserve that choice; a later PR state change
  can update the issue status again. Manual moves back remain until relevant new activity.
- Won’t do requires no PRs or every linked PR confirmed closed or merged. Open PRs and
  unavailable or missing PR evidence block this manual status.
- Failed or unavailable T3/GitHub observations preserve the last known state and expose the
  connection problem. A lost connection is not a stopped thread or a merged PR.

## Fresh start and retirement

Start with an empty issue store. Do not import or delete historical Tasks, Steps, reports,
or acceptance history. Reuse existing Projects, connection configuration, and automatic
SQLite backups. Add issues as new work occurs.

Retire Factory's installed reporting skills and SessionStart hooks on M4 and M5. Back up the
removed files outside skill discovery and preserve unrelated hooks/settings. Client installs
must no longer install reporting skills or hooks. The legacy CLI and compatibility APIs can
remain for historical reads and recovery; no issue requires agent reports.

## Preservation and delivery

Clean code baseline: local annotated tag
`archive/factory-before-issue-tracker-pivot-2026-10-16`, commit
`66fc89516949f8675a66ddd30f640dcac7fb8404`. Existing work branches remain intact.
The owner confirms automatic database backups are configured.

Implementation, automated checks, deployment, and Kevin's review are distinct. The owner has
authorized deployment when the implementation is ready for review. No routine progress-report
or acceptance ceremony is required by the new issue workflow.

## Integration and review deployment

Recent message text uses the protocol-2 bounded thread endpoint. Human replies use the
supported `orchestration.dispatchCommand` WebSocket method with `message.dispatch` and
`queue_after_active`. They start an idle thread or queue behind active work, without
interrupting it. Stable command/message IDs and Factory receipts make unchanged retries
idempotent. The configured environment bearer needs `orchestration:read` and
`orchestration:operate`; MCP OAuth credentials have a different audience and are not
interchangeable with these credentials. Credentials stay server-side.

Both sources were provisioned through T3's supported local `auth session issue` command and
saved through Factory's authenticated connection API. Their scoped credentials expire on
2027-10-16; the former managed registry is retained privately for rollback. No credential
values are in the repository. A disposable delegated test thread confirmed a real browser
reply and response through Factory.

`compose.issue-review.yaml` defines an isolated private-LAN review instance. Its data directory
is seeded from a verified online snapshot and receives a private copy of the T3 registry.
It retains existing Projects and history but starts with no Issues. It uses a separate backup
directory on the existing backup share. It does not mount the production database for writes.
The owner authorized production promotion on 2026-10-17. Production retains its existing
private HTTPS endpoint, production data volume, operator login, Projects and historical
records, and `/backups/production` backup schedule. The review database is not substituted
for the production database.

Before promotion, take verified application backups of both instances and freeze the review
writer. Import only the four issue tables using `scripts/import-review-issues.ts`, preserving
issue IDs, numbering, ordering, thread links and PR evidence. The importer requires an empty
production issue store and matching production Project IDs, and does not overwrite legacy
state, credentials, sessions or backup settings. Transfer the reviewed T3 credentials through
the authenticated Connections API.

Production deployments use the `deploy/factory-production` release branch in Dokploy, with
automatic GitHub deployment disabled so the explicit backup gate runs before promotion.
Verify `/version`, `/readyz`, both T3 connections, preserved issue identity and ordering, the
production banner state, and a new verified production backup. Stop the independent review
instance after the cutover to keep subsequent issue edits on the production store.
