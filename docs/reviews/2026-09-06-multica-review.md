# Multica review and Factory follow-ups — 2026-09-06

Source: [multica-ai/multica](https://github.com/multica-ai/multica) at tree `ca47495f`. Multica is
a self-hostable issue tracker where agents are assignees: a Go and Postgres server owns issues,
comments, runs, and an inbox; a daemon on each machine registers installed coding CLIs as
runtimes, claims queued runs, spawns the CLI in a worktree, streams the transcript back, and the
agent updates the issue through a `multica` CLI using a short-lived task-scoped token.

Factory deliberately does not own the roadmap and only observes sessions, so Multica's breadth
(issues, chat, channels, squads, plugins, 26 CLI adapters, push dispatch) stays out of scope under
`docs/software-factory-requirements.md` section 4. Its execution and attention layers are a useful
preview of the later Herdr slice, and several small rules address gaps named in
`2026-09-04-data-and-agent-workflow.md`.

## Ideas adopted as Factory Tasks

| Factory Task | Multica source | Gap addressed |
| --- | --- | --- |
| Inject Factory context into coding sessions at start (`02e6c95f`) | Daemon writes the task brief into `CLAUDE.md`/`AGENTS.md`, injects a task token, and opens with an explicit read command; per-turn facts are appended after the cached brief (MUL-5377) | Skill discovery and record maintenance depend on the agent noticing the skill (review gaps 1 and 4) |
| Attention Requests with reason codes and auto-resolution (`9968ef1d`) | Inbox severities `action_required`/`attention`/`info`; items coalesce per issue; run-failure items auto-archive when the issue reaches review, done, or cancelled; own actions never notify; agents never read the inbox; failure reasons split platform-side vs tool-side with a what-to-do per code | "Waiting on me" is a Task-state projection with free-text reasons only |
| Agent-facing CLI reads that announce truncation and stay compact (`2bf3f6c6`) | `--roots-only --summary --compact`, `--since` cursors, hard caps that set a truncation header and warn on stderr "so a short list is never mistaken for a complete one" | Heavy reads and silent caps in agent context windows |
| Run attempt lineage, failure codes, and attribution (`880ec254`) | `agent_task_queue` attempt/`retry_of_task_id`/`rerun_of_task_id`, coded `failure_reason`, `accountable_user_id` with `originator_source` provenance; "attribution is on-behalf-of, never blame and never authorization" | Run model has no attempt lineage or attribution before Herdr creates Runs |

## Considered and not adopted

- **Stage barriers for parent rollup** (`issue.stage`): whole-child readiness already shipped in
  `a3baf13`, so the remaining value is ordered stages, which no current Task needs.
- **Custom statuses by category** with an effective-status SQL function: Factory's Work State is
  small and fixed; no demand.
- **Queue lease and heartbeat guards** (one pending run per issue, dispatched > 5 min fails,
  queued waits while the runtime heartbeats): belongs to the Herdr slice, not v1.
- **Owning issues, chat, channels, squads, plugins, or dispatch**: excluded by requirements.

## Open decision

The reason-code taxonomy and severity tiers for Attention Requests are Kevin's to define before
persistence work starts (Subtask `b25930a6`). The 2026-08-18 analysis already names this state
machine as the piece that decides whether the board is useful at a glance or is just a log viewer.
