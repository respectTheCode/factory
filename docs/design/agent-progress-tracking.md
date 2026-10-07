# Task progress, handoffs, and review evidence

Factory records work and explains the next step. T3 remains the execution surface.
The task detail adds Contributors, Handoff, and Review packet views to the existing
Ledger. Existing work states, report acceptance, reviewer assignments, and PR merge
reconciliation retain their authority.

## Contributors

Only explicit task or subtask associations identify contributors. A matching
branch or a suggested association does not establish ownership. Session identity
includes the T3 source and external thread ID; linked Factory sessions also expose
their session and run IDs. Agent identity comes from T3's observation. A model or
role is unknown when the source does not supply it.

A recent successful source observation establishes freshness. Recent file activity
alone does not. A disconnected, stale, missing, or future-dated observation cannot
establish that someone is currently working. Active sessions, reported completion,
and accepted work are separate facts.

## Structured handoffs

A status report may include a `handoff` with `nextOwner`, `nextOwnerKind`,
`nextAction`, an optional `dependency`, and optional `waitingOnSubtaskIds`.
Owner kind is `human`, `agent`, or `unknown`. Waiting targets must be other subtasks
of the same task. They explain dependencies; they do not start work, change
associations, or override the task's underlying blocked state.

CLI report flags are `--next-owner`, `--next-owner-kind`, `--next-action`,
`--dependency`, and pipe-separated `--waiting-on-subtask-ids`. Owner, owner kind,
and next action must be supplied together. The dashboard uses the same report
operation. Each submitted handoff is a new append-only claim, never a rewrite of
an older report or an acceptance action.

## Review packets

Reports may include a `testedRevision` and an `artifacts` array. CLI flags are
`--tested-revision` and `--artifacts-json`. Each artifact supplies a label, an
HTTP(S) URL, a kind (`artifact`, `preview`, `test`, or `review`), and optionally its
own tested revision. Credentials in URLs are rejected.

The packet keeps the immutable report evidence separate from editable current
notes. It compares the recorded revision with the linked PR's observed head.
Missing revisions, abbreviated or different heads, unavailable data, empty check
sets, and stale observations cannot establish that checks passed for the reported
work. Screenshots carry their own tested revisions and are identified separately
when the revision differs or is missing.

GitHub CI evidence includes check runs from every provider and workflow runs.
The existing Actions summary keeps its original scope. Partial pages or malformed
rows cannot establish passing checks; older Actions-only snapshots are labeled as
partial evidence and remain unknown in the packet.

GitHub review evidence reads review threads and submitted reviews, rather than
inferring resolution from a comments list. Review completion and review approval
are separate: a submitted changes-requested review is completed review work but
still needs action. A changed head invalidates review evidence for the earlier
revision.

Preview links and artifacts are reported evidence, not proof of a live deployment.
The packet does not infer production deployment or automatically accept work.
Coding credentials cannot accept their own claims. Authorized acceptance remains
in the existing operator, assigned-reviewer, and merge reconciliation paths.

## Compatibility and validation

All new report fields are optional; older schema-v1 JSON snapshots and clients
remain readable. Validation happens before report or evidence mutation. The HTTP
API retains project scope, machine attribution, source scope, and idempotency.

Validate the report contract through core, persistence, CLI, and API tests. Validate
the presentation through source-aware contributor, stale observation, changed
head, unavailable review, and claim-versus-acceptance tests. Check the running
interface at desktop and phone sizes with an isolated test database.

## Initial local validation and handoff (2026-10-06)

Implementation is in `/Users/agent/.t3/worktrees/factory/agent-progress-tracking`
on `feat/agent-progress-tracking`, with uncommitted changes based on `e353fdc`.
The original checkout's design guide and Floor files remain untouched.

138 focused and regression tests across 33 files passed. Checks cover report
validation and replay, legacy persistence, scoped HTTP and CLI behavior, source
identity, contributor freshness, handoffs, exact revisions, CI/review outages and
pagination, and existing acceptance/reviewer/Floor behavior. After the final UI
corrections, all 14 tracking UI tests passed again. Typecheck, the web build,
scoped Prettier checks, skill contract tests, and `git diff --check` passed.

The real app was checked with an isolated sample database at 1280 × 1000 and
390 × 844. The native preview host became unavailable; Playwright completed the
remaining checks. Sample identities and synthetic revisions exist only in the
preview fixture, not in application data or production records. Browser checks
confirmed report submission/readback, credentialed artifact URL rejection,
blocked-state retention, the human queue distinction, revision mismatch behavior,
and no horizontal overflow on the phone layout.

Local screenshots:

- [Contributors, desktop](../../output/playwright/contributors-desktop.png) and [phone](../../output/playwright/contributors-mobile.png).
- [Human handoff, desktop](../../output/playwright/handoff-desktop.png) and [phone](../../output/playwright/handoff-mobile.png).
- [Review packet, desktop](../../output/playwright/review-desktop.png) and [phone](../../output/playwright/review-mobile.png).
- [Changed PR head](../../output/playwright/review-changed-head.png), [report editor after submission](../../output/playwright/report-editor-mobile.png), and [Floor queue](../../output/playwright/floor-agent-wait.png).

Human review remains: compare the three views with the approved Ledger examples,
inspect the local patch, and exercise real source attribution and PR evidence in
an authorized environment. Private live GitHub data, CI, and deployment were not
validated. No commit, push, PR, production deployment, or acceptance was performed.
The new client/server report fields require the updated server; they were not
used to submit structured fields to the older pilot server.

Session auto-link remains unresolved: “The machine credential is not authorized
for this T3 source.” No association was guessed or permission bypassed. The
operator must reconcile the configured source's machine binding before linking
this thread.

Factory tracking: **T-85**, UUID `cf51914e-76ac-44bd-ab63-b0f59a60bf1e`.
The three completion claims were awaiting verification at this initial handoff:

| Subtask               | Complete report                        | Local UI screenshot attachment         |
| --------------------- | -------------------------------------- | -------------------------------------- |
| ST-271 contributors   | `3a0a8de9-5adb-44c0-a3c7-35b572b353ef` | `94026105-5bee-44fe-91d6-5cb1fcbea0c2` |
| ST-272 handoffs       | `fb762019-663b-4d6d-b5fa-da83958e0e63` | `e01d7823-210e-4fc7-86b3-37b78d4a00f3` |
| ST-273 review packets | `7a045ab6-3131-4602-8c11-ff36fdce0fe0` | `f52df446-ef0b-4f25-a876-6dbb89868628` |

## Release validation (2026-10-07)

Kevin accepted ST-271, ST-272 and ST-273; T-85 is completed. The separately
tracked validation and release work is T-87 (ST-280 validation, ST-281 PR and
merge, ST-282 deployment). Accepted feature reports remain unchanged.

The release includes the already-deployed T3 v2 adapter and protected GitHub
secret mount from `deploy/factory-production`, so promoting this feature to
`main` preserves the current production behavior and configuration.

Independent review identified and corrected two evidence-summary edge cases:
a comment-only human review must retain the author's preceding decisive review,
and a malformed REST `total_count` must leave CI evidence unavailable. Regression
checks cover both. All 561 local tests across 135 files, typecheck, the web build, formatting and
all four client builds passed before publication. The repository has no GitHub
Actions workflows or required branch checks; this is not reported as passing CI.
Linux image validation and exact-head CodeRabbit review are separate release
gates.

An isolated database was used for browser checks at 1280 x 1000 and 390 x 844.
The running form saved an append-only structured handoff, canonicalized its
same-task dependency IDs and rejected a credentialed artifact URL. Contributor
freshness, human versus agent waiting, exact revision evidence and changed-head
unknown/untied states were checked, with no horizontal overflow. Refreshed local
screenshots remain in `output/playwright/release-*.png` in the implementation
worktree; they are sample UI proof, not production data or deployment proof.

The prior source machine-binding denial remains an operator configuration issue.
No association is guessed or permission bypassed. Production rollout must use
the configured release branch, a verified NAS backup, an exact runtime revision
check, and live readiness/source/GitHub/acceptance readback. These remaining
release observations are recorded in T-87 rather than overwriting T-85's
accepted claims.
