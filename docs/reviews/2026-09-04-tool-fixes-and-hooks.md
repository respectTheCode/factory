# Factory tool fixes and reporting hooks

## Implemented locally

The parent readiness fix evaluates every non-archived Subtask. Partial delivery remains
active; all delivered children request human verification; any blocked child blocks the
automatic parent. Completion still requires accepted current complete reports. Scope changes
recompute automatic parent state and destination ordering, while preserving manual holds.

`task resume-rollup --task-id ... --json`, `tasks.resumeRollup`, and the dashboard's
**Use subtask status** action release a manual hold without creating reports or verifications.
Legacy task reasons are retained when applicable; missing historical child reasons remain
missing in the original reports rather than being invented or overwritten.

Workspace identity now uses one lexical absolute-path normalizer across CLI context, T3 project
resolution, observation refresh, and reconciliation target matching. Trailing slashes and dot
segments compare equally. Different paths and duplicate candidates still fail closed. Symlinks
are not resolved. Stored or remote relative roots are rejected as identities; explicitly supplied
CLI relative paths are resolved locally before comparison. Existing relative Project metadata
must be corrected to an absolute root. No schema migration is needed.

The shared Software Factory skill documents the new behavior and command. The implementation
is in the working tree; this review does not imply a stable-service deployment or human acceptance.

## Hooks recommendation

Decision: defer hooks and DeepSeek integration for a future reevaluation. The authorized
release includes the deterministic tool fixes and shared skill updates only.

Hooks can improve reporting discipline, but the two defects above require deterministic tool
fixes. A hook cannot repair Factory's path comparison or reliably infer why a parent is held.

Use a shared command adapter with small provider-specific wrappers:

1. **Session start:** resolve the checkout and Factory Project, read relevant Tasks and reports,
   and add a short context reminder. Ambiguous identity must remain unresolved. Do not guess a
   Task from `main` or from a model's transcript interpretation.
2. **During work:** Codex or Claude reports material state, evidence, or blocker changes through
   the existing CLI. A read-only review and unchanged evidence remain no-ops.
3. **Stop:** compare the explicitly associated work and new evidence with the latest Factory
   report. If a required update is missing, return one bounded reminder to the agent. Use the
   provider's stop-hook recursion flag and a per-session evidence fingerprint to prevent loops
   and duplicate reports. The agent validates and writes the report through Factory.
4. **Optional background review:** enqueue a sanitized structured snapshot for DeepSeek to flag
   missing subtasks, stale evidence, or contradictions. Include explicit IDs, observed revision,
   changed-path summary, checks run, and current report fields. Exclude raw transcripts,
   credentials, and unrelated data. Re-read current state before acting on a suggestion.

Keep model inference outside the blocking hook. A small durable worker can drain the queue
after the agent exits, with timeout, bounded retries, deduplication, and stale-result rejection.
An unavailable reviewer should not prevent normal coding or deterministic Factory reporting.
No model may create human verification or infer completion from session termination.

Codex 0.153.4 and Claude Code 2.1.260 are installed locally, with existing global hooks that
would need to be merged rather than replaced. Codex supports command and MCP hooks; its prompt
and agent hook types are currently parsed but skipped. Claude supports model-based hooks, but
command hooks offer a shared implementation. Claude's asynchronous hooks cannot block an
action, and pending hooks may be cancelled when a noninteractive session exits. References:
[Codex hooks](https://learn.chatgpt.com/docs/hooks) and
[Claude Code hooks](https://code.claude.com/docs/en/hooks).

## Local DeepSeek availability

On September 4, 2026, a read-only SSH check through the documented `gx10b` management alias
returned HTTP 200 from the head node's local `/health`. `/v1/models` reported
`deepseek-ai/DeepSeek-V4-Flash-0731`, owned by vLLM, with a 262144-token model context.
The management route is documented in
`/Users/agent/Projects/home-lab/gx10-deepseek-v4-runbook.md`. The Mac's direct fabric route timed
out; use the documented management route rather than treating that as a model outage.

No inference request was made and no hook was installed. Endpoint health establishes
availability, not the quality or latency of Factory reconciliation suggestions. A useful first
trial would compare a bounded set of known stale and correct Factory snapshots, including
ambiguous identity and already-current reports, before enabling advisory reviews routinely.

## Validation and Factory handoff

- 224 tests passed, 948 assertions, zero failures; typecheck, web build, formatting and skill
  validation passed. Luna xhigh independently reviewed the implementation and researched hooks.
- Isolated port-3001 browser interaction selected **Use subtask status**, observed the task move
  from active to awaiting verification with zero completed tasks, and confirmed persistence on
  reload. Computer Use inspection worked initially, but its connection dropped; the interaction
  was completed through the Chrome browser testing connection.
- Local Codex and Claude skills match the canonical SHA-256:
  `17ee1bd100f0b571739f5b78127e3e310d5136d73a859ba305376df0ed3628d6`.
- Parent Task: `d3021bdd-6f43-4e2f-b5e5-316a047e27b8`.
- Parent readiness Subtask `caf081eb-3283-4af9-93a1-6627cb6e3797` has complete report
  `74317b34-f8d5-4d6d-b9e2-7bdbf080c82f`, awaiting human review.
- Workspace matching Subtask `2fe14f3a-97ef-4544-95c6-af0b29c35679` has complete report
  `d3be0eb3-ddd6-4275-9020-001d89cbc345`, awaiting human review.
- Skill Subtask `270c46c2-37fe-4e46-80e2-2454ad5437a9` has updated report
  `913b72f8-ae65-4029-89c1-2cc9f8d64edc`.
- Fresh-agent adoption `b16603a8-7ad2-4325-a8f6-29ece5b285e2` remains planned. The parent remains
  active. Stable deployment, hook installation, and actual DeepSeek inference were not performed.
