# Factory issue tracker pivot

Agreed with Kevin on 2026-10-16. Factory owns the issues; Linear and Multica are interface
references, not integrations or sources of truth.

## Product

The main screen is a compact issue list grouped by status, with project filtering, search,
labels, and zero or more GitHub pull requests. An issue contains a title and description,
labels, branch names, linked PRs, and matching T3 threads. Show the recent messages from each
thread and allow the human to send a reply to that thread.

Match threads by project repository and branch within their configured T3 source. Associations
persist when thread metadata changes. Multiple branches, threads, and PRs are supported.
Thread messages stay scoped to authenticated humans; credentials never reach the browser.

## Status rules

- To do: no work has started, or a manual move places the issue here.
- In progress: any associated thread is working, even if another thread has stopped.
- Needs attention: no associated thread is working and a thread has stopped. This does not
  assert that the result is ready for review.
- Done: one or more linked PRs exist and all are merged. Closed without merging does not count.
- Done remains Done when threads receive messages or resume work after the merge.
- A newly linked or reopened PR reopens the issue. The human can also move it manually.
- Issues without PRs can be completed manually. PR-backed issues require all linked PRs to be
  merged before they can be marked Done. Manual moves back remain until relevant new activity.
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
The current production deployment continues independently until the pivot is accepted.
