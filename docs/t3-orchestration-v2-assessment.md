# T3 orchestration v2 compatibility and opportunities

Assessment date: 2026-10-04. Factory work: T-71 / ST-245.

## Verified contract and current failure

The installed **T3 Code Nightly 0.0.46-nightly.20261004.2652** advertises
`orchestrationProtocolVersion: 2` from `GET /.well-known/t3/environment`.
Factory's starting revision `0d4a7cf` supports protocol 1 and the exact legacy
server fallback `0.0.42`. Its deployed M4 source currently reports
`unavailable` with HTTP 400. A read-only replay from the production container
using its saved credential confirmed that the old headerless shell request
returns HTTP 400 and the v2 request returns HTTP 200. The missing protocol
header is the confirmed cause of this connection failure.

The installed application's bundled server contract establishes these changes:

- Protected orchestration GETs require `x-t3-orchestration-protocol: 2`.
- `/api/orchestration/shell` returns `schemaVersion`, `snapshotSequence`,
  `projects`, `threads`, and `archivedThreads`; it has no root `updatedAt`.
- Thread shells expose durable run status and IDs, run timestamps,
  `pendingRuntimeRequest`, `pendingBackgroundTasks`, lineage, and attention flags.
- `/api/orchestration/threads/:threadId/bounded` returns a `projection` with
  runs, attempts, nodes, subagents, runtime requests, messages, turn items, and
  checkpoint scopes. The v1 `?turnLimit=N` shape is replaced.
- Bounded detail has `historyCursor`, `hasMoreHistory`,
  `latestLocalTurnOrdinal`, and optional `payloadBudgetExceeded`.
  `/history?cursor=...` supports explicit history pagination.
- Shell/thread subscriptions support sequence-based incremental updates.

Source evidence was inspected from the installed application bundle, rather
than inferred from MCP tool names. The live `orchestrator_capabilities` catalog
also confirms app-owned child tasks, cancellation, asynchronous task polling,
thread management, incremental thread reads, and scheduled tasks.

The configured local Factory reader credential returns HTTP 401
`auth_invalid / invalid_credential`, including with the v2 header. The local
credential and production source credential are separate: the production saved
credential successfully fetched v2 shell and bounded detail. The prepared v2
normalizer accepted the live payloads (18 projects, 680 threads, and this thread's
bounded detail). Production is still on `0d4a7cf`; deployment and post-rollout
connection/association validation remain outstanding.
No T3 credentials, service settings, or production deployment were changed.

## Compatibility boundary

Support both protocol 1 and protocol 2 through separate normalization paths,
retain the exact legacy fallback and explicit server-version pins, and reject
unknown versions. Keep Factory's reader restricted to its allowlisted GETs,
with the existing byte limit, timeout, authentication, and schema checks.
Use v2's bounded endpoint rather than fetching an entire projection and hoping
to trim it afterward. Runtime observation never accepts Factory work or creates
a completion report automatically.

The first adapter preserves Factory's existing observation types. Durable run
IDs occupy the existing turn-reference fields for v2 observations; they are
source-scoped opaque evidence IDs, not provider-native turn IDs. A richer
run/attempt/subagent domain should be a separate migration. A bounded recent
view is not the complete thread history. The reader retains v2 `hasMoreHistory`
metadata; the existing dashboard still presents bounded evidence and does not
page through older v2 history. Any server budget failure must remain visible
rather than appearing as an empty successful observation.

## Merge-based acceptance policy

The user identified repeated manual acceptance after a PR merge as a major source
of friction. Make **accept on PR merge** the default for PR-backed code work,
with an explicit **manual acceptance** override for work requiring a separate
outcome check. This policy is a proposed product change, not implemented by the
v2 adapter. Factory already reads GitHub `mergedAt`; its current verification and
task-wide acceptance routes are human-only.

A Subtask can use its own linked PR or inherit the Task PR when that PR covers its
scope. An explicit child PR takes precedence. A manual child remains open until
its stated check is accepted. A Task completes only when its own applicable merge
gate and all in-scope child acceptance gates are satisfied. One Task PR must not
blindly accept children with another PR or a manual check; the existing bulk
`acceptTask` action cannot be reused unchanged for this policy.

Record acceptance provenance as **PR merge**, including the canonical PR URL,
merged commit, merge time, observed time, and policy used. Do not attribute an
automated event to a human verifier or rewrite prior reports. Reconciliation must
be idempotent, recheck current links and revisions before writing, and leave work
unchanged when GitHub is unavailable or a PR is closed without merging. Resolve
all applicable PRs for stacked work. Merge acceptance completes the code-work
record; separate deployment/release checks retain their own scope.

Include reconciliation of existing merged PRs so the current waiting-for-review
queue benefits too, while honoring manual exceptions and rejected/deferred
checks. Project defaults and per-work overrides must be visible in the dashboard;
no agent should infer acceptance mode from prose. This should precede richer T3
execution displays because it directly removes recurring coordination work.

## Prioritized improvements

| Priority | Factory improvement | V2 evidence | Bounded scope and acceptance |
| --- | --- | --- | --- |
| 1 | Explain connection compatibility per source | Environment descriptor advertises server version, protocol version, and capabilities | Show observed versus supported protocol and distinguish header/schema/auth failures; avoid repeated opaque HTTP 400 warnings. |
| 1 | Show exact queued, preparing, waiting, cancelled, failed, and rolled-back run states | Durable shell status; runs and attempts | Extend persisted observation and thread-dot labels; retain neutral stale states. A terminal T3 run must never imply human acceptance. |
| 1 | Make Your Turn explain why an agent is waiting | Runtime requests include approval, user input, auth refresh, and response capability | Display the request kind and whether it can resume. Never silently answer or approve a request. |
| 1 | Show delegated work beneath its owning thread | Shell lineage plus app-owned/provider-native subagents with status, child thread, model, progress, and completion-delivery state | Expand child progress on demand, distinguish finished results awaiting parent delivery, and avoid counting children as independent work twice. Do not infer Factory Task ownership solely from lineage. |
| 2 | Track all PR layers and their exact-head readiness | Descriptor advertises threadPullRequests, threadPullRequestWatch, pullRequestStackActions; shells contain pullRequests and branchPullRequest | Start with read-only links/check summaries; preserve existing review/CI gates and human merge authority. A thread's single legacy PR field is insufficient for a stack. |
| 2 | Reduce polling and make Floor updates more responsive | Sequence-based shell/thread subscriptions and completion markers | Add reconnect/resnapshot handling, per-source sequence ownership, duplicate suppression, and stale-state coverage before replacing polling. |
| 2 | Explain failed or interrupted execution in History | Runs, attempts, typed error items, context handoffs/transfers, scoped checkpoints | Read bounded detail on demand; show retries and restart lineage without exposing message/tool content by default. |
| 3 | Surface scheduled work separately from active coding | App-owned schedule tools and scheduled message IDs | A read-only schedule/run view first. Explicitly distinguish a schedule being enabled, a run finishing, and Factory work being accepted. |
| 3 | Offer an explicit launch-in-worktree action from a Factory Subtask | App-owned launch and explicit workspace strategies | Separate opt-in control integration with minimal scopes, idempotency/recovery, and visible workspace binding. Existing read credentials must not gain operate authority. |

Recommended next scope: merge-based acceptance with explicit manual exceptions,
then precise durable-state labels, request reasons, and delegated-task progress. These improve the Floor using observations
already present in v2 without turning Factory into a second orchestration engine.
PR stacks and event subscriptions are valuable follow-on work with larger
persistence and reconnect requirements. Scheduling and launch controls need
separate product decisions and authorization; they are proposals only.

## Delivery checks

Focused adapter tests must cover both protocol versions, header negotiation,
bounded routing, malformed responses, pending-request classification, archive
handling, run-state normalization, and response budget failures. Typecheck and
build validate downstream consumers. Before calling the live integration
restored, run an authenticated read against the intended source and inspect
Factory's connection status and source-aware association behavior. Production
rollout and dashboard acceptance remain separate from local implementation.
