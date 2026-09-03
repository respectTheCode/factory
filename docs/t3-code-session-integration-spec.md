# T3 Code Session Integration

Status: implementation-ready specification
Owner: Kevin
Last updated: 2026-09-02

## Outcome

Factory shows concrete T3 Code execution activity beside the work it may advance, identifies
when Factory planning has drifted from observed activity, and lets a human or agent explicitly
link a T3 thread to a Factory Task or Subtask. T3 remains read-only. Observations and model
inference never change Factory Work State, submit a Status Report, or perform human Verification.

The first release is deterministic. A local language model may summarize evidence in a later
slice, but is not required to collect, match, or display session activity.

## Problem

Factory currently records planned work and agent Status Reports, but it cannot see the coding
sessions that produced the work. Reports therefore become stale when an agent continues in T3,
switches branches, encounters an error, or finishes a turn without submitting a new report.

Human-review age is not itself a reliable failure signal for greenfield projects. Early work may
produce foundations that cannot be reviewed as an integrated application. Factory must separate:

- observed execution activity;
- an agent's claim about Subtask state;
- readiness for human review; and
- human Verification.

## Existing authority model

The integration extends, and does not replace, the definitions in `CONTEXT.md`:

- A **Run** is a durable Factory attempt to advance work.
- A **Code Session** is execution detail attached to a Run.
- **Evidence** is an immutable observed result or reference.
- A **Status Report** is an agent claim.
- **Verification** remains a human decision.

T3 is authoritative only for facts about its own projects, threads, turns, and sessions. Factory
remains authoritative for Projects, Tasks, Subtasks, Work State, archive disposition, Status
Reports, and Verification.

## Scope

### Included

1. A read-only T3 transport using its authenticated HTTP orchestration endpoints.
2. Server-only credential loading from an operator-managed secret file.
3. Live shell observations for T3 projects and threads.
4. Bounded thread-detail reads on explicit request.
5. Durable Factory links from one T3 thread to one Run and optionally one Task or Subtask.
6. Deterministic candidate matching and explicit ambiguity.
7. Reconciliation findings that describe observed drift without changing work state.
8. A CLI JSON contract and PWA presentation for connection health, activity, links, and findings.
9. Tests for authority, matching, persistence, transport failures, and credential redaction.

### Excluded

- T3 command dispatch, terminal control, session creation, cancellation, or message sending.
- Automatic Task/Subtask Work State transitions.
- Automatic Status Reports or human Verification.
- Reading or storing full transcripts during background refresh.
- Direct reads from T3's SQLite database.
- DeepSeek or another model deciding links or state.
- Webhooks, remote control, or multi-user authorization.

## T3 transport

Factory uses only these T3 0.0.38 reads:

- `GET /.well-known/t3/environment` for compatibility and capability discovery.
- `GET /api/orchestration/shell` for project and thread shells.
- `GET /api/orchestration/threads/:threadId?turnLimit=N` for bounded detail after an explicit
  request.

The adapter must not expose a generic request method. Its interface is:

```ts
type T3ActivityReader = {
  readShell(): Promise<T3ShellObservation>;
  readThread(input: { threadId: string; turnLimit: number }): Promise<T3ThreadObservation>;
};
```

The implementation owns authentication headers, timeout and abort behavior, response validation,
T3-version compatibility, normalization, and error mapping. Tests use an in-memory adapter at the
same seam.

### Configuration and credentials

- `T3_BASE_URL` enables the integration. The stable same-host service uses
  `http://127.0.0.1:3773`; no LAN address is hard-coded.
- `T3_ACCESS_TOKEN_FILE` points to an absolute path for a regular file containing only the access
  token. The stable
  LaunchAgent uses `~/Library/Application Support/Factory/secrets/t3-read-token`; its directory is
  mode `0700` and the operator provisions the file with mode `0600`.
- Containers use the same contract with a mounted secret, for example
  `T3_ACCESS_TOKEN_FILE=/run/secrets/factory_t3_token`.
- `T3_ACCESS_TOKEN` is an explicit development and test fallback only when
  `T3_ACCESS_TOKEN_FILE` is not configured. A configured file is authoritative: missing, empty,
  non-regular, oversized, unreadable, or malformed content disables T3 reads without falling back.
- Factory reads the credential once when the server or CLI process starts. Token rotation takes
  effect on the next process start; it does not require rebuilding an image or release.
- The repository, Factory database, plist, browser, CLI output, logs, and error strings must never
  contain the token.
- The token needs only `orchestration:read`. Factory never requests or uses operate, terminal,
  review-write, relay-write, or access-management scopes.

T3's `orchestration:read` capability can reach more host data through other T3 methods than this
feature needs. The Factory adapter therefore allowlists the three routes above and never acts as a
general T3 proxy.

### Transport states

Every read returns data or one normalized state:

- `not_configured`
- `unreachable`
- `authentication_failed`
- `permission_denied`
- `incompatible`
- `invalid_response`
- `unavailable`

Failures are returned as data to the CLI/PWA where practical. They do not make core Factory
Project reads fail and never reuse stale observations as if they were current.

## Persistent Factory model

### Run

```ts
type Run = {
  id: string;
  projectId: string;
  taskId?: string;
  subtaskId?: string;
  state: "observed" | "active" | "waiting_on_human" | "succeeded" | "failed" | "cancelled";
  createdAt: Date;
  updatedAt: Date;
};
```

The initial integration creates a Run when a T3 thread is explicitly linked. Run state describes
the attempt, not Task/Subtask Work State. Removing a Task or Subtask clears that target reference
but retains the Run under its Project for provenance. Removing a Project cascades its Runs, Code
Sessions, and Evidence with the existing confirmed Project deletion.

T3 never updates `Run.state`. A newly linked thread creates an `observed` Run, and Run state changes
only through an explicit Factory operation introduced with a defined caller and proof obligation.

### Code Session

```ts
type CodeSession = {
  id: string;
  runId: string;
  provider: "t3";
  externalThreadId: string;
  externalProjectId: string;
  title: string;
  workspaceRoot: string;
  repositoryIdentity?: string;
  branch?: string;
  worktreePath?: string;
  linkedPullRequestUrl?: string;
  latestSessionState?: "starting" | "ready" | "running" | "stopped" | "error";
  latestTurnState?: "running" | "interrupted" | "completed" | "error";
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  observedAt: Date;
  sourceUpdatedAt: Date;
  sourceSequence?: number;
  sourceDigest: string;
};
```

`provider + externalThreadId` is unique. Refresh updates the normalized observation in place while
preserving its Run and explicit Factory target. Source timestamps and sequence prevent older
snapshots from replacing newer ones. Sequences are compared only within the same T3 stream; a
stable digest deduplicates observations when a bounded detail response has no comparable sequence.
Session state and latest-turn state remain separate because an idle thread may have a recently
completed turn.

### Evidence

The first slice records only bounded metadata evidence: T3 thread/turn identifiers, source
sequence, timestamps, linked PR reference, checkpoint file names, and summarized diff counts when
available. It does not persist message bodies or tool payloads. Evidence is append-only and
deduplicated by source identity plus sequence.

## Matching

Matching produces candidates; only an explicit link creates or changes a Run target.

Candidate priority is:

1. Existing explicit `CodeSession` link.
2. Exact canonical pull-request URL matching a Task or Subtask.
3. Exact T3 repository identity plus one unique Factory Task branch.
4. Exact workspace-root association explicitly stored for a Factory Project, plus one unique Task
   branch.

Title, message, file-name, and language-model similarity are not deterministic matches. They may be
shown later as low-confidence suggestions but cannot create links.

Zero matches is `unmatched`; multiple matches at any level is `ambiguous`. Factory fails closed and
shows the candidates instead of guessing.

Factory currently has no Git origin remote of its own, so Project-to-T3 association must support an
explicit T3 external project ID or workspace root rather than assuming every Project has a Git
origin.

## Reconciliation findings

A finding is a computed observation, not a workflow transition. Each finding contains a stable
kind, severity, source thread, Factory target candidates, observed time, explanation, and a concrete
suggested action.

Initial kinds:

- `unlinked_activity`: recent T3 activity belongs to a recognized Factory Project but no Run is
  linked.
- `ambiguous_target`: deterministic evidence matches more than one Factory target.
- `planned_but_running`: a linked Task/Subtask is planned or not started while T3 is running or has
  newer completed-turn activity.
- `reported_state_stale`: a linked session observation is newer than the latest Status Report.
- `session_needs_attention`: T3 reports an error, pending approval, or pending user input.
- `branch_mismatch`: an explicitly linked session's branch differs from the linked Task branch.
- `source_unavailable`: current T3 evidence could not be refreshed.

No finding may say that acceptance criteria passed, work completed, or human review succeeded.

## Interfaces

### Application interface

The domain module owns link validation, uniqueness, cascade behavior, and reconciliation. Transport
types do not leak into the core application.

Required operations:

- list observed T3 activity for one Factory Project;
- link one T3 thread to one Task or Subtask, creating/reusing its Run;
- unlink a target without deleting the observed session record;
- list reconciliation findings;
- refresh normalized observations from a supplied shell observation.

### tRPC

Add a separate `t3` router so slow external reads never block `projects.detail`:

- `t3.status`
- `t3.projectActivity`
- `t3.threadDetail`
- `t3.linkThread`
- `t3.unlinkThread`

Only `status`, `projectActivity`, and `threadDetail` call T3. Link/unlink mutate Factory state only.

### CLI

All commands return one `schemaVersion: 1` JSON object:

- `project t3-status --project-id ... --json`
- `session link --thread-id ... --project-id ... [--task-id ...] [--subtask-id ...] --json`
- `session unlink --thread-id ... --json`
- `session detail --thread-id ... --json`

CLI reads use the same adapter and normalized result as tRPC. CLI output never includes raw
authorization headers or tokens.

### PWA

Each Project gets an **Observed activity** section, clearly separate from Factory Work State. It
shows:

- current connection state and last successful fetch time;
- running, needs-attention, linked, unmatched, and ambiguous counts;
- thread title, T3 state, project, branch, last activity, pending-input/approval indicators, linked
  PR, and linked Factory target;
- actionable reconciliation text;
- explicit Link, Change link, and Unlink controls affecting Factory only.

The section must remain usable at 390 px and must not make Task rows transcript-heavy. Core Project
planning remains visible when T3 is unavailable.

## Refresh behavior

- Fetch on opening a Project and through explicit refresh.
- Poll while the Project is visible using the existing external-status cadence.
- Abort superseded requests.
- Do not persist a failed refresh as a newer successful observation.
- Show the fetch time and stale/unavailable state explicitly.
- Streaming RPC is a later optimization; the HTTP snapshot is the correctness baseline.

## Local-model extension

After deterministic ingestion is proven, DeepSeek V4 Flash may receive a bounded, redacted bundle
of normalized activities, diff summaries, and the last assistant summary. It may return a
schema-validated progress summary, possible target, confidence, reasons, and evidence references.

Model output remains advisory. It cannot create a link, change Run or Work State, submit a Status
Report, or verify work. Raw prompts, transcripts, secrets, and unrestricted tool payloads are not
sent by default.

## Acceptance criteria

1. With a valid read-only credential, Factory reads the live T3 0.0.38 shell and a bounded thread
   snapshot over loopback without using T3 mutation endpoints.
2. With missing, expired, unauthorized, unreachable, timed-out, or malformed T3 responses, Factory
   returns the correct explicit state and core Project/Task reads remain available.
3. No credential appears in repository files, SQLite state, plist output, browser/tRPC/CLI payloads,
   thrown errors, or captured logs.
4. An explicit thread link persists across process restart, is unique by T3 thread ID, and targets
   only records inside the selected Project.
5. Exact PR and unique repository/branch matches are suggested; missing and ambiguous matches fail
   closed and never create links.
6. Newer T3 observations can create deterministic reconciliation findings, but cannot change Task
   or Subtask Work State, create a Status Report, or create Verification.
7. Project deletion cascades owned integration records; Task/Subtask deletion preserves the Run and
   clears only the deleted target reference.
8. CLI and tRPC expose equivalent normalized status, activity, links, and findings with stable JSON
   contracts.
9. The PWA labels T3 data as observed activity, displays freshness and failures, supports explicit
   link/unlink, and passes desktop and 390 px interaction/layout checks.
10. Database integrity, existing report/verification behavior, GitHub status behavior, formatting,
    typecheck, build, and the full test suite continue to pass.

## Proof and rollout

Required automated proof:

- adapter response/error/timeout/credential-redaction tests;
- application persistence, uniqueness, matching, cascade, freshness, and authority tests;
- tRPC and CLI contract tests;
- PWA rendering and interaction tests;
- existing full regression suite, typecheck, build, formatting, and `git diff --check`;
- Factory database integrity before and after deployment.

Required live proof:

- read the T3 environment descriptor, shell, and one bounded thread over loopback using the saved
  file-backed credential;
- compare project/thread counts with T3's visible state;
- link one Factory coding thread to the Factory integration Task and show a reconciliation finding;
- verify the stable port-3000 PWA at desktop and 390 px without exposing transcript content or a
  credential.

Deployment remains forward-only through `bun run service:deploy`. Stop if schema hydration loses
existing records, a T3 read can mutate remote state, the credential reaches a client payload/log,
or T3 failure makes core Factory data unavailable. Recovery is the prior immutable Factory release
plus the pre-deployment database backup.
