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

- **FR-001** — Factory must store Projects and Tasks as durable, addressable records. Every Task
  has a stored Work State: `backlog`, `planned`, `active`, `awaiting_verification`, `blocked`, or
  `completed`.
- **FR-002** — A Task must support an objective, acceptance criteria, priority, owner,
  dependencies, and links to zero or more repositories.
- **FR-003** — A Task must contain zero or more Subtasks. A Subtask must support a title,
  description, a current reported state, and a quick Archive State of `released` or `wont_do`.
- **FR-004** — A Task must support the same quick Archive States, independently of its Work
  State. Restoring an archived Task or Subtask returns it to its prior work/reporting
  behavior without deleting history.
- **FR-005** — Factory must support native Tasks that have no Notion or Linear record.
- **FR-006** — Factory must show Project- and portfolio-level live work in this canonical order:
  completed, blocked, awaiting-verification, active, planned, and backlog. Released and wont-do
  are separate archive dispositions rather than positions in the live-work sequence.
- **FR-007** — A Project may store a Git origin URL so a coding checkout can be associated with
  the correct Factory Project. The URL is context metadata, not a repository mirror or sync
  target.
- **FR-008** — A Task may store a branch name. Branch names may contain a Linear or Notion
  identifier for agent context, but Factory must not infer or write external tracker state from
  that name.
- **FR-009** — Tasks and Subtasks must have a durable manual order within their current Work
  State. The dashboard must support pointer/touch drag reordering and keyboard reordering;
  reordering never moves an item to another state.

### 3.2 Tracker Links

- **FR-010** — A Project or Task may link to zero or more Notion or Linear records.
- **FR-011** — Each Tracker Link must retain the external system, stable record identifier,
  canonical URL, and an optional display title.
- **FR-012** — v1 must not pull, mirror, or write Notion or Linear data. Tracker updates remain
  the team's normal responsibility in their authoritative system.
- **FR-013** — Factory must visibly distinguish a native Task state from an external Tracker
  Link; a link's title or URL must never be presented as Factory-owned status.

### 3.2.1 GitHub pull request observations

- **FR-014** — A Task or Subtask may store one canonical GitHub pull request URL. Agents must be
  able to attach, replace, or clear that reference through the Factory CLI.
- **FR-015** — The dashboard and CLI may read the linked private pull request and GitHub Actions
  runs for its exact head commit, including explicit `not configured`, `not found`, denied-access,
  and unavailable states. GitHub reads must not write to GitHub or Factory Work State.
- **FR-016** — GitHub credentials must remain server-side and outside the Factory SQLite state,
  CLI JSON, browser state, and logs. The first integration may use a server process environment
  token; the operator must explicitly provision that token for the trusted private deployment.

### 3.3 Agent reports and human verification

- **FR-020** — A Codex skill or hook must be able to submit a Subtask Status Report through the
  Factory CLI, including `subtaskId`, reported state, reporter, time, optional evidence, and an
  actionable reason when the reported state is `blocked`.
- **FR-021** — Noninteractive CLI calls may create Status Reports but must not mark a Subtask or
  Task verified or completed.
- **FR-022** — A human must be able to verify, reject, or defer a reported Subtask state from
  the mobile web interface or an interactive CLI command.
- **FR-023** — Factory must retain Status Report history and Verification history. A newer
  report or verification must not erase the earlier observation.
- **FR-024** — A Task can be marked completed only by human verification. An agent-reported
  complete state places the relevant Subtask or Task in awaiting-verification, not completed.
- **FR-025** — Blocked and awaiting-verification Tasks and Subtasks must expose an actionable
  reason: what unblocks the work or what the human needs to check. Entering either state without
  its required reason must be rejected.
- **FR-026** — A Subtask moving to a higher non-completed Work State promotes its parent Task.
  A human may directly move a Task among backlog, planned, active, awaiting-verification, and
  blocked in either direction, including planned to active or active to planned. An explicit
  human Task state is not silently lowered by later Subtask reports. Completed remains governed
  only by the verification rule.

#### V1 report and completion rules

- A Status Report's `reportedState` is one of `not_started`, `in_progress`, `blocked`, or
  `complete`. `awaiting-verification` is a derived Factory state, never an agent report.
- A blocked report includes what unblocks it. A complete report includes what the human should
  verify; Factory uses that reason while the Subtask is awaiting verification.
- Status Reports are append-only. The current report is the most recently accepted report by
  Factory; a newer report replaces the prior current report and reopens verification, including
  after an earlier report was accepted.
- A Verification targets one Status Report and records `accepted`, `rejected`, or `deferred`.
  Verification history is append-only; the latest Verification for the current report is its
  current decision.
- A Task is completed only when it has at least one Subtask and every Subtask's current report
  is `complete` with a latest Verification of `accepted`. A Task with no Subtasks remains
  planned. Human acceptance attests that the Task's visible acceptance criteria are satisfied.
- A Task whose state is controlled by Subtask rollup follows the highest current non-completed
  Subtask state and may move down again when those Subtasks change. A direct human Task-state
  choice remains in force until a Subtask later moves to a higher non-completed state or the
  completion rule is satisfied; a same-state report does not override a human hold.
- Task dependencies are informational in v1 and do not independently block completion.
- `released` and `wont_do` are explicit Archive States, distinct from human-verified
  `completed`. Archived Tasks disappear from Attention but remain addressable, counted, and
  recoverable with a restore action. Archiving a Subtask changes only that Subtask; it does not
  silently archive its parent Task or erase its report/verification history.

### 3.4 Mobile web and CLI

- **FR-030** — v1 must include a mobile-responsive web dashboard for creating and inspecting
  Projects, Tasks, Subtasks, Status Reports, and Verifications.
- **FR-031** — Factory must be reachable from Kevin's mobile devices through the Tailscale
  tailnet. The default application bind is loopback; an operator may explicitly use a trusted
  local-network bind for local agents. Tailscale Serve must proxy the private mobile route, and
  Factory must not use Tailscale Funnel or expose a public endpoint.
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
- **FR-041** — The home dashboard must keep Attention visible and provide direct links into each
  Project's task page. Project task pages must retain a quick switcher for moving between
  Projects.
- **FR-042** — Project task pages must allow Tasks to collapse or expand their Subtasks without
  hiding the Task's own status, metadata, or quick disposition controls.
- **FR-044** — The Project edit page must allow a human to add, replace, or clear the Project's
  Git origin URL. The Task planning form must accept an optional branch name and task detail must
  display it when present.
- **FR-043** — Project settings, external Project Tracker Links, and new-Task planning metadata
  must live on a dedicated Project edit page. Text inputs, text areas, and dropdowns must use
  the dark dashboard theme rather than browser light-mode defaults.
- **FR-045** — Dashboard navigation must use browser-addressable Project routes. Selecting Home,
  a Project, or Project Settings must update the browser history; Back, Forward, and a direct
  reload of a Project route must restore the corresponding view.

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
5. **Private PR observation:** An agent attaches a private GitHub PR to a Task or Subtask. The
   dashboard shows the PR and current PR/Actions observation when the server has access, and
   clearly labels missing credentials or denied access without changing Factory state.
6. **Quick disposition:** Kevin can mark a Task or Subtask `released` or `wont_do` from the
   dashboard or CLI, restore it later, and see its history intact; a Subtask disposition does
   not change the parent Task automatically.
7. **Private mobile access:** The dashboard is available over Tailscale Serve from a phone on
   Kevin's tailnet and unavailable from the public internet.
8. **Installed mobile app:** Kevin can install the dashboard as a PWA on a phone. It launches
   in standalone mode; if Tailscale is disconnected, it clearly shows that live task data and
   edits are unavailable rather than presenting stale data as current.
9. **Live connection:** If the Tailscale or tRPC WebSocket connection drops, the installed PWA
   changes to `reconnecting` and then `disconnected`, displays the last successful connection
   time, and disables edits. It refreshes data before re-enabling edits after reconnecting.
10. **Ordered work:** Kevin drags Tasks or Subtasks within one state group (or uses Arrow keys on
    the reorder handle), reloads Factory, and sees the same order. State groups remain in the
    canonical order.
11. **Work-state control:** A Subtask becoming active promotes a planned parent Task; Kevin can
    still put the parent back into planned or move it to active directly. Blocked and
    awaiting-verification transitions cannot be saved without their actionable reason.

## 6. V2, not v1

- Connect Herdr and attach its Claude, Codex, and OpenCode Code Sessions to Factory work.
- Provide remote visibility and control of Codex through the Herdr integration.
- Add durable Runs, Gates, Evidence, Attention Requests, and repository verify contracts.
- Consider read-only tracker imports only after linked-task workflows prove the data is useful.

## 7. Open decisions

1. Which first Playlister Notion records and Grail Linear records should be linked in the pilot?
2. What backup and recovery policy protects the Factory database and history on its host?
