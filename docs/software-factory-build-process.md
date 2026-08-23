# Software Factory Build Process

**Status:** Working agreement for the v1 build
**Related:** [requirements](software-factory-requirements.md) · [Tailscale runbook](software-factory-tailscale.md) · [domain glossary](../CONTEXT.md)

## 1. Purpose

This document defines how Factory v1 will be built without recreating Mission Control's
unbounded scope. Every slice must deliver a small, observable behavior, preserve the
distinction between agent reports and human verification, and remain usable from the web
dashboard, CLI, and Codex skills.

## 2. Working rules

- The requirements and acceptance scenarios are the behavioral source of truth.
- Work proceeds in vertical slices: one behavior, a deliberately failing business test, the
  smallest implementation that passes it, verification, then one commit.
- Tests assert caller-visible outcomes and durable records. They do not assert component trees,
  private functions, SQL statements, mock call counts, or the order of internal calls.
- The Factory core is independent of React, tRPC, WebSockets, the CLI, and Notion/Linear.
  Those are adapters around the same core behavior.
- A Status Report is an agent claim; only a human Verification can complete a Task.
- The parent agent owns the working tree, test execution, UI checks, and commits. Bounded
  research, drafting, and review work may be delegated to Luna xhigh subagents; agents must
  not edit overlapping files.
- Every UI-affecting slice is inspected in the running application with Computer Use before it
  is committed.
- Commits never intentionally contain a failing test. The red test is run and observed before
  implementation, then committed together with its green implementation.

## 3. Public seams and test strategy

The following are the deliberate public seams. They are the only test surfaces for v1 behavior;
the implementation behind them may change freely.

| Seam           | Caller-visible interface                           | Business behavior covered                                                                                |
| -------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Factory core   | typed commands and queries                         | Projects, Tasks, Subtasks, Tracker Links, Status Reports, Verifications, and portfolio state projections |
| CLI            | command exit result, stdout, and `--json` contract | skill-shaped reporting, stable reads, and denial of noninteractive verification                          |
| tRPC WebSocket | typed query, mutation, and subscription contract   | web clients receive the same Factory behavior and meaningful live updates                                |
| Web dashboard  | user interaction and visible state                 | connection clarity, disabled mutations, human verification, and Tracker Link distinction                 |

Tests use explicit IDs and clocks supplied at the core seam. Storage is exercised through the
core, never inspected directly by tests. WebSocket tests use a real local server and client;
the only acceptable test doubles are at a true system edge, such as time or a deliberately
controlled network connection.

The application interface owns the agent-versus-human authority rule. React, tRPC, and the CLI
may not duplicate or weaken it. CLI machine output goes to stdout as versioned JSON; diagnostics
go to stderr.

### Domain behavior examples

- Creating a Project with a Task makes that Task retrievable through the Project.
- An agent report of `complete` makes its Subtask awaiting verification; it cannot complete the
  Task.
- A human verification retains the original Status Report and is the only action that can make
  the Task completed when its acceptance rule is satisfied.
- Rejected and deferred reports remain historical observations rather than being overwritten.
- A Notion or Linear Tracker Link retains its system, stable ID, and URL without becoming
  Factory-owned status.

### Transport and UI behavior examples

- A CLI report creates the same observable Status Report as the Factory core command.
- A connected WebSocket client receives fresh state after a Factory mutation.
- A real WebSocket client can query, mutate, and subscribe through a Bun-hosted tRPC server.
- While the dashboard is `connecting`, `reconnecting`, or `disconnected`, mutation controls are
  disabled and no write is replayed later.
- After reconnect, the dashboard displays refreshed authoritative data before enabling edits.
- When disconnected, the dashboard visibly reports the state and the last successful connection
  time. It never presents cached mutable data as current.

Connection events feed a small connection-state model that produces the four visible states and
the mutation gate. Its tests assert event-to-user-visible-state behavior; dashboard tests assert
the resulting text and enabled/disabled controls rather than the model's implementation.

## 4. Vertical-slice loop

For every behavior:

1. State the requirement and acceptance example that it fulfills.
2. Add one behavior-focused test at the appropriate public seam.
3. Run that focused test and record the expected failure.
4. Add only the application code necessary to make it pass.
5. Run the focused test and then the relevant complete suite.
6. Inspect the diff for scope and run Computer Use verification if the slice changes the UI.
7. Commit the green, intentionally scoped slice.

## 5. Build phases

### Phase 0 — settle build-blocking decisions

Before application code, record decisions for:

1. Reported-state vocabulary and which reports enter awaiting verification.
2. The minimal Task completion rule for verified Subtasks and acceptance criteria.
3. Storage, migration, ID/time, backup, and recovery policy.
4. The authentication and trust model behind private Tailscale access.
5. The initial Notion and Linear pilot records.
6. The production Tailscale Serve hostname and operating procedure.

### Phase 1 — scaffold and test harness

Create the strict TypeScript Bun workspace, test command, core/CLI/server/web layout, and a
minimal readiness command. Bun remains the runtime, package manager, bundler, and test runner;
no Node runtime, Vite process, or second backend framework is introduced.

Before the application depends on a WebSocket adapter, add a small, real-server compatibility
test proving that the selected tRPC WebSocket server and client operate under Bun on an
ephemeral loopback port. The test must cover one query, mutation, and subscription. It selects
the smallest compatible adapter; it must not pull Mission Control's runtime into Factory.

Also prove the PWA boundary early: the manifest is valid and the service worker caches only
static application-shell assets. It must not serve mutable Factory records as current.

Acceptance: a clean checkout runs the test suite with Bun, including the transport proof.

### Phase 2 — core planning behavior

Build Projects, Tasks, Subtasks, Tracker Links, Status Reports, Verifications, and state
projections as test-first slices. This phase establishes the central distinction between
reported state and verified state before any UI or agent integration can blur it.

### Phase 3 — durable history

Add persistent storage and migrations behind the existing Factory core seam. Test through
restart: records remain retrievable, report and verification history remain append-preserving,
and invalid transitions are rejected. The current SQLite adapter supports a consistent,
write-once snapshot through the CLI:

```bash
bun run src/cli.ts database backup --database "$FACTORY_DB" \
  --output "backups/factory-$(date +%Y-%m-%d).sqlite" --json
```

The backup command reads the live database without changing it, creates missing destination
directories, and refuses to replace an existing backup unless `--overwrite` is explicit. A
backup is a recovery artifact, not a second system of record. Before restoring, stop the
Factory server, preserve the current database under a timestamped name, copy the selected
backup into the configured database path, and verify it by starting the server and reading the
project portfolio. `database check --json` provides a read-only integrity result and persisted
record counts for the same verification step. Automated scheduling, off-host retention, and a
one-command restore remain deployment work rather than application behavior.

Start the repository contract with an in-memory adapter, then run the same behavior suite
against Bun's built-in SQLite adapter. Use a temporary SQLite file only for process-restart
tests; business tests never inspect tables directly.

### Phase 4 — CLI and Codex skills

Add CLI commands for the same core operations, with stable `--json` reads. A skill-shaped,
noninteractive command may submit a Status Report but cannot verify or complete work. Document
the initial skill command and hook payload after the CLI contract is stable. Include a
`schemaVersion` in machine JSON before skills depend on it.

### Phase 5 — tRPC WebSocket transport

Expose typed queries, mutations, and subscriptions over tRPC WebSockets. Test a real local
WebSocket client for query/mutation outcomes, subscriptions, connection loss, reconnect,
authoritative refresh, mutation denial while not connected, and no replay.

### Phase 6 — connection-aware PWA dashboard

Build the smallest responsive dashboard for project/task lists, task detail, subtasks, reports,
human verification, and Tracker Links. It must surface `connecting`, `connected`,
`reconnecting`, and `disconnected`, including the last successful connection time when not
connected. The manifest, standalone mode, icons, and app-shell-only service-worker cache belong
here; mutable data remains network-fetched.

### Phase 7 — private mobile delivery

Run Factory only on loopback and proxy it through tailnet-restricted Tailscale Serve. Funnel and
public exposure are prohibited. Verify the installed PWA from the actual private Serve URL.

### Phase 8 — end-to-end readiness

Run the requirements acceptance matrix: native, Notion-linked, and Linear-linked Tasks; Codex
CLI reporting; human verification; installed PWA; Tailscale loss; WebSocket reconnect; fresh
post-reconnect mutation; and lack of public reachability. A real phone on the tailnet is the
final mobile gate.

## 6. Commit protocol

One commit represents one completed vertical slice. Before committing:

- The focused red-to-green test history was observed locally.
- Focused and relevant full tests pass.
- UI changes have a recorded Computer Use check at desktop and narrow/mobile width.
- `git diff` contains only the intended files; it contains no databases, credentials, generated
  secrets, or unrelated formatting.
- The commit message describes the delivered behavior, for example `feat: preserve agent report
history` rather than its implementation technique.

## 7. Completion definition

A slice is complete only when its business behavior is green, its user-visible effect is checked
where applicable, and its commit is reviewable. V1 is complete only after the full acceptance
matrix passes, including the real phone, Tailscale Serve, WebSocket reconnect, and fresh
post-reconnect mutation check.
