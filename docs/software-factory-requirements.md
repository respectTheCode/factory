# Software Factory Requirements

**Status:** Draft baseline — revised v1/v2 split

**Related:** [analysis](software-factory-analysis.md) · [domain glossary](../CONTEXT.md)

## 1. Purpose

Software Factory is a standalone, local-first Bun application for project and task tracking.
Its v1 makes planned work, agent-reported Subtask status, and Kevin's verification visible from
desktop or mobile. It is not a life OS, agent runtime, or replacement for Notion, Linear,
Hermes, Slack, or Recall.

## 2. V1 ownership model

| Information | System of record | Factory v1 responsibility |
|---|---|---|
| Playlister roadmap and development planning | Notion | Link the relevant record from a Factory Project or Task |
| Grail roadmap and development tracking | Linear | Link the relevant record from a Factory Project or Task |
| Normal non-code agent work | Hermes | Out of scope |
| Coding sessions | Herdr | Out of scope until v2 |
| Project operations | Factory | Projects, Tasks, Subtasks, Status Reports, Verifications, and Tracker Links |

Factory is additive. A Tracker Link does not copy, update, or replace its Notion or Linear
record. A Status Report does not replace Kevin's Verification.

## 3. V1 required behavior

### 3.1 Projects, Tasks, and Subtasks

- **FR-001** — Factory must store Projects and Tasks as durable, addressable records.
- **FR-002** — A Task must support an objective, acceptance criteria, priority, owner,
  dependencies, and links to zero or more repositories.
- **FR-003** — A Task must contain zero or more Subtasks. A Subtask must support a title,
  description, and a current reported state.
- **FR-004** — Factory must support native Tasks that have no Notion or Linear record.
- **FR-005** — Factory must show Project- and portfolio-level work by planned, active,
  awaiting-verification, completed, and blocked state.

### 3.2 Tracker Links

- **FR-010** — A Project or Task may link to zero or more Notion or Linear records.
- **FR-011** — Each Tracker Link must retain the external system, stable record identifier,
  canonical URL, and an optional display title.
- **FR-012** — v1 must not pull, mirror, or write Notion or Linear data. Tracker updates remain
  the team's normal responsibility in their authoritative system.
- **FR-013** — Factory must visibly distinguish a native Task state from an external Tracker
  Link; a link's title or URL must never be presented as Factory-owned status.

### 3.3 Agent reports and human verification

- **FR-020** — A Codex skill or hook must be able to submit a Subtask Status Report through the
  Factory CLI, including `subtaskId`, reported state, reporter, time, and optional evidence.
- **FR-021** — Noninteractive CLI calls may create Status Reports but must not mark a Subtask or
  Task verified or completed.
- **FR-022** — A human must be able to verify, reject, or defer a reported Subtask state from
  the mobile web interface or an interactive CLI command.
- **FR-023** — Factory must retain Status Report history and Verification history. A newer
  report or verification must not erase the earlier observation.
- **FR-024** — A Task can be marked completed only by human verification. An agent-reported
  complete state places the relevant Subtask or Task in awaiting-verification, not completed.

### 3.4 Mobile web and CLI

- **FR-030** — v1 must include a mobile-responsive web dashboard for creating and inspecting
  Projects, Tasks, Subtasks, Status Reports, and Verifications.
- **FR-031** — Factory must be reachable from Kevin's mobile devices through the Tailscale
  tailnet. The application must listen only on loopback; Tailscale Serve must proxy it with
  tailnet access controls. Factory must not use Tailscale Funnel or expose a public endpoint.
- **FR-032** — v1 must include a CLI for the same core operations. Read commands must support a
  stable JSON output mode so skills can call the CLI without parsing human-oriented prose.
- **FR-033** — Skills must call the Factory CLI. Factory does not need an MCP server in v1.
- **FR-034** — The mobile web dashboard must be an installable Progressive Web App with a web
  app manifest, service worker, app icons, and a standalone display mode.
- **FR-035** — The service worker may cache the application shell for fast launch, but mutable
  Factory data must be fetched from the network and display its current fetch state. Cached data
  must never be shown as current without an explicit stale/offline indication.
- **FR-036** — v1 does not queue offline writes. When the phone cannot reach Factory through
  Tailscale, the PWA must make that condition clear and prevent mutations until connectivity
  returns.
- **FR-037** — The web application must use tRPC over WebSockets for its typed queries,
  mutations, and subscriptions to Factory. The CLI remains a separate local client of the same
  Factory core.
- **FR-038** — The dashboard must show a persistent connection indicator with at least
  `connecting`, `connected`, `reconnecting`, and `disconnected` states, plus the time of the
  most recent successful connection when it is not currently connected.
- **FR-039** — The dashboard must disable mutations whenever its tRPC WebSocket is not
  `connected`. After reconnecting, it must refresh authoritative data before re-enabling
  mutations; it must not replay or queue a prior mutation.
- **FR-040** — Mobile readiness must be verified through the actual Tailscale Serve URL, not
  only localhost: a phone on the tailnet must establish a tRPC WebSocket, observe a reconnect,
  and complete a fresh mutation after reconnecting.

## 4. V1 constraints and non-goals

- Factory must use Bun 1.x as its runtime, package manager, bundler, and test runner, with
  strict TypeScript for the core, CLI, and React web application.
- The web application must use Bun's local HTTP server and build tooling. Do not introduce a
  separate Node runtime, Vite process, or a second backend framework in v1.
- Factory must remain independently deployable and maintainable; it must not depend on the
  retired Mission Control runtime or database.
- Factory must not become a broad life OS: chat, email, calendar, health, personal memory, and
  Slack archival belong to their existing systems.
- Factory must not replicate or automatically synchronize Notion or Linear data.

## 5. V1 acceptance scenarios

1. **Grail task:** Kevin creates a Factory Task, links its Linear issue, and adds Subtasks from
   the mobile dashboard. The Linear issue remains unchanged.
2. **Playlister task:** Kevin creates a Factory Task linked to a Notion record. Factory shows
   the link but does not present a copied Notion status as its own.
3. **Codex report:** A Codex skill calls `factory subtask report --json` with evidence. The
   Subtask becomes awaiting-verification; the Task does not become complete.
4. **Human verification:** Kevin verifies the reported Subtask from mobile. Factory retains the
   original report, records the Verification, and updates the Task only when its acceptance
   criteria are satisfied.
5. **Private mobile access:** The dashboard is available over Tailscale Serve from a phone on
   Kevin's tailnet and unavailable from the public internet.
6. **Installed mobile app:** Kevin can install the dashboard as a PWA on a phone. It launches
   in standalone mode; if Tailscale is disconnected, it clearly shows that live task data and
   edits are unavailable rather than presenting stale data as current.
7. **Live connection:** If the Tailscale or tRPC WebSocket connection drops, the installed PWA
   changes to `reconnecting` and then `disconnected`, displays the last successful connection
   time, and disables edits. It refreshes data before re-enabling edits after reconnecting.

## 6. V2, not v1

- Connect Herdr and attach its Claude, Codex, and OpenCode Code Sessions to Factory work.
- Provide remote visibility and control of Codex through the Herdr integration.
- Add durable Runs, Gates, Evidence, Attention Requests, and repository verify contracts.
- Consider read-only tracker imports only after linked-task workflows prove the data is useful.

## 7. Open decisions

1. What exact reported-state vocabulary should a Codex skill use, and which reported states can
   lead to awaiting-verification?
2. What is the minimal rule for determining whether all verified Subtasks satisfy a Task's
   acceptance criteria?
3. Which first Playlister Notion records and Grail Linear records should be linked in the pilot?
4. What backup and recovery policy protects the Factory database and history on its host?
