# Software Factory — Analysis Notes

**Date:** 2026-08-18
**Status:** Historical exploration. The current requirements baseline is
[`software-factory-requirements.md`](software-factory-requirements.md); it settles the Factory
scope, system ownership, and Herdr role described below.
**Source material:** IndyDevDan, "Super Simple Software Factory" (SSSF) video + a Gemini-generated spec of it.

---

## 1. What we are actually solving for

Agent work here is real and parallel — Claude Code, Codex, Herdr panes, four `grail`
worktrees, ~25 repos — but **a unit of work has no existence outside the terminal it
happened in.** State lives in scrollback. Starting work requires a human attached.
There is no shared answer to "what's running, what finished, what's stuck on me," and
no shared definition of "done" across repos.

### Requirements (Kevin's, 2026-08-18)

Selected from a menu, plus one added:

1. **Consistency across ~25 repos** — same gates and standards everywhere, installed once.
2. **Unattended throughput** — work happens while not watching; come back to a PR.
3. **Harness independence** — orchestration owned by neither Claude Code nor Codex.
4. **Observability** *(added, and probably primary)* — "a better way to see everything
   I have in progress, what its current state is, and what is waiting on me."

### Restated as system properties

| # | Property | Why it's load-bearing |
|---|---|---|
| 1 | A **run** is a durable object, not a chat session — addressable, with status, artifacts, history that outlive the process | Precondition for both observability and unattended execution. Neither works if state is a transcript. |
| 2 | A **plain program** records and drives runs through Herdr; coding harnesses are Herdr-managed workers | The harness-independence requirement. |
| 3 | Every repo exposes the **same contract** — one verify command, one agent-definition location | Makes a run portable across all 25 without bespoke wiring. |
| 4 | **One surface** answers: in progress / done / waiting on me | The stated pain. |

### Explicitly NOT the goal

The SDLC pipeline (Plan → Build → Verify → Review) was the one option *not* selected.
That is the heart of the source video but it is an implementation detail of one *kind*
of run here. **We are building a run substrate, not a factory pipeline.** Steal ideas
from the pipeline; don't make it the product.

---

## 2. The genuinely novel piece: "waiting on me"

Does not exist in SSSF, in Claude Code, or in most agent frameworks. They all model a
run as running-or-finished. This needs a third state: **blocked, with a reason and a
resume path** — needs a decision, needs a credential, verify failed N times, PR awaiting
review.

Everything else in this document is assembly. This state machine is design work, and it
determines whether the board is useful at a glance or is just a log viewer.

> Chat harnesses model **attention** — the session exists while you're looking at it.
> A control plane models **work** — the run exists whether anyone's watching. "Waiting on
> me" is hard to bolt on because it only means something once the run outlives the
> observer, which requires durable state as a precondition, not a feature.

**Owner: Kevin.** ~10 lines of type definition, blocks everything downstream.

---

## 3. Assessment of the SSSF spec

### Holds up

- **Deterministic gates beat agent self-assessment.** An agent asked "did you do a good
  job?" says yes; `pytest` doesn't. Validation logic belongs in the repo as code, not in
  prompts. This is the strongest idea in the video.
- **"You own your code, you rent your models"** — good framing for the above.
- **Phase isolation for context hygiene.** A build agent that never sees planning
  deliberation drifts less.
- **Orchestration in Python, config in YAML.** My initial objection (that YAML control
  flow is a DSL in disguise) was wrong — he doesn't do that. Control flow is a ~180-line
  Python file using `with phase(...)` blocks; YAML holds only the agent roster
  (model, prompt, tools, harness). Correct split.
- **The "core four" per agent** — context, model, prompt, tool.

### Does not hold up / unaddressed

1. **No retry bound.** "If validate fails, route back to Build with error logs" — with no
   answer for attempt 4 or 12. The on-camera runs never failed. This is the single
   biggest hole and our version must answer it.
2. **No gate-tampering protection.** Classic failure: agent "fixes" a failing test by
   deleting the assertion, passes the gate, ships garbage. Open question whether the build
   agent may edit test files at all.
3. **Two kinds of gate conflated.** `pytest`/`mypy`/`ruff` are deterministic. "Peer review
   agent verifies against requirements" is another stochastic sample wearing a gate
   costume. Hard gates block; soft gates advise. Must be labeled differently.
4. **"Typed envelope" is a name, not a design** in the spec — though the video shows the
   real mechanism (agents emit JSON, validated, agent must retry on malformed output).
   Under-context is as real a failure mode as bloated context and is harder to detect.
5. **Self-install vs. code ownership tension.** He acknowledges it: "the tests I have set
   up are not the tests you need." The generic install is scaffolding; the value is
   repo-specific.
6. **No git isolation.** He admits on camera he runs on `main` and that you'd want a
   branch, a sandbox, and a merge step.
7. **Observability without evals.** Logging tells you what happened, not whether a prompt
   change made things better. Designing for the thousandth run implies a replayable task
   set — absent.

### Answered by the transcript

- **Atomic unit:** one feature-sized prompt = one ADW run ("add light mode"). Not tickets,
  not whole apps.
- **Brownfield**, via an `/install` command that copies the factory into an existing repo.
- **Multi-provider is central**, not incidental — "model stack" routing (Kimi K3 to plan,
  Gemini Flash to build, Opus to review) is most of the cost argument.
- **Deliverable:** free open-source teaching repo, wrapped as a Claude Code skill.

---

## 4. Environment findings (verified on this machine, 2026-08-18)

### `mission-control` is a legacy source of patterns, not Factory's platform

`/Users/agent/Projects/mission-control/main` — last local commit 2026-08-02. Per the owner,
Mission Control is retired because its complete-life-OS scope made it too costly to maintain and
too risky to extend.

Self-description: *"A local-first AI agent platform where persistent, long-running agents
collaborate with each other and a human operator."* `PROJECT.md` refers to keeping
*"Mission Control's reliable agent control plane intact."*

Relevant packages:

| Package | Contents observed |
|---|---|
| `orchestrator` | `coding-sessions/`, `claude/`, `agents/`, `api/`, `chat/`, `boot.ts`, `cli.ts` |
| `coding-agent` | `codex-paths.ts` — Codex integration |
| `dashboard` | React app: `pages/`, `components/` |
| `eval` | `harness-runner.ts`, `harness-scorer.ts`, `analysis.ts`, plus `docs/harness-results.csv` |
| `health`, `knowledge`, `recall`, `tasks`, `slack`, `gmail` | Other capabilities |

It has a process manager, a shared DB, a tRPC server, a web UI, an eval harness, and
cross-harness session tracking. Its coding-session feature is useful reference material for
machine/session normalization and dashboard patterns, but it does not model Factory's durable
Runs, Gate evidence, or general Attention Requests. Factory must remain independent.

### Other repos checked (not relevant)

- `watchtower` — church IT/AV documentation and alerting product. Docs-stage.
- `beacon` — TSL/UMD tally server for macOS.
- `dashboard` — family dashboard for a fixed display (Home Assistant, calendars).
- `factory` — **empty**; git repo with zero commits and an empty `.claude/`.

### Claude Code's `Workflow` tool — evaluated and largely rejected

Initially I over-weighted this. It *is* structurally an ADW runner: deterministic JS
script, `phase()` grouping, per-agent model selection, `schema:` for validated typed
envelopes with automatic retry, `isolation:'worktree'`, and `resumeFromRunId` (which
caches the unchanged prefix of `agent()` calls — better than SSSF's session restart).

**But it only works inside Claude Code.** It cannot be invoked from a shell, cron, CI, or
Codex. Given requirement #2 (harness independence), that disqualifies it as the
orchestration layer. Still fine as a tactical tool inside a session.

Second structural problem: workflow scripts are sandboxed JS with **no filesystem or shell
access**, so the script cannot itself run `pytest`. "Agents propose, code disposes" breaks
exactly at the gate. Workarounds were: a cheap relay agent that runs the command and
returns the exit code; `PostToolUse` hooks; or gating in the main loop between calls.

### Observability primitives available in Claude Code

No workflow has ever been run on this machine (`journal.jsonl` does not exist anywhere),
so the following is from the tool contract plus inspection of sibling subagent transcripts.

- **`/workflows`** — live progress tree, grouped by phase; supports skipping a running
  agent. Live only, not a historical archive.
- **`journal.jsonl`** — per run, in a transcript dir returned with the `runId`. Records
  each `agent()` call's **return value**. Substrate for resume.
- **`agent-<id>.jsonl`** — per agent, verified format. Each line a message record with
  `message.model`, `message.usage` (`input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`), `message.content`
  (thinking / text / tool_use), plus `timestamp`, `gitBranch`, `cwd`, `agentId`,
  `toolUseResult`.

Present: prompts, every tool call, model, per-turn token accounting.
Absent: **cost rollup** (derivable — tokens × rate) and **gate pass/fail with reason**
(*not* derivable; only what an agent chooses to return).

**Consequence:** observability quality is fixed at schema-design time, not by any viewer
built later. A phase returning `"Fixed the failing tests"` is permanently unauditable; one
returning `{passed: false, failing: ["test_theme_toggle"], attempt: 2}` gives queryable
cross-run history for free. Dan's UI is impressive because he forced JSON out of every
agent; the UI is downstream of that.

---

## 5. What to take, what to skip

### Take

- **A `verify` contract per repo** — one command (`make check` / a script) running lint +
  types + tests, exiting nonzero. Roughly 80% of the total value, independent of any
  factory. Most of the 25 repos probably lack one.
- **Typed envelopes / structured phase results** — the determinism mechanism, and the
  precondition for the status board.
- **A session artifact directory** (`plan.json`, `diff.patch`, `verify.log` per run) —
  agents need a place to leave real files for the next phase and for post-hoc inspection.
- **Worktree isolation + branch + PR** as the default landing zone — the thing Dan wants
  and lacks.
- **Small composable runs** rather than one monolithic SDLC.
- **A post-run reporter** — reads run artifacts, emits phase / model / tokens / dollars /
  duration / gate verdict, appended to a `runs.jsonl`. Gets most of the swim-lane value
  without a UI.

### Skip

- **Rebuilding a large observability UI from Mission Control** — start with a thin local web
  dashboard and CLI over one Factory core; do not carry forward Mission Control's broad React
  application or runtime.
- **A Python orchestration layer copied from SSSF** — the question is where it lives, not
  whether to transcribe his.
- **Agent-harness abstraction** — Claude Code and Codex *are* the harnesses.
- **Multi-provider routing as a v1 goal** — cross-model here means shelling out to CLIs
  (`codex`, `gemini`); the existing Codex plugin already does exactly this. A v2 cost
  optimization that only matters at volume.
- **A full SDLC as the default run shape** — Dan admits on camera his markdown feature
  didn't need it.

---

## 6. Open decisions

Blocking, in order:

1. **Resolved — where it lives:** Factory is an independent, narrow project-operations tool.
   Mission Control is retired reference material. Herdr manages coding sessions; Hermes handles
   normal non-code agent work. Notion and Linear remain authoritative product trackers and are
   read-only import sources for Factory.

2. **The run state machine** — what states exist, and specifically what puts a run into
   "waiting on Kevin." Kevin's call.

3. **Retry / escalation policy** — what happens when verify fails N times. Trade-offs:
   abandoning wastes the run but is honest; a PR marked-failing preserves work but risks
   being merged; escalating to a stronger model can rescue hard bugs but silently
   multiplies cost. Related: may the build agent edit test files at all?

4. **Phase result schema shape** — uniform envelope
   (`{phase, ok, summary, artifacts[], evidence{}}`) vs. per-phase schemas
   (`PlanResult`, `BuildResult`, `VerifyResult`). Leaning uniform-with-nested-evidence,
   because the premise is comparing run #1 to run #1000 and that comparison wants one
   shape. Cannot be retrofitted.

5. **First target repo** — needs an existing test suite, or step one is writing one.
