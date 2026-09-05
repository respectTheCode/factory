# Factory data and agent workflow review — 2026-09-04

Factory has the core reporting tools, but agent adoption and record maintenance are incomplete. This review combines the live SQLite data, the running release, repository evidence, and installed agent instructions. Agent reports remain separate from human Verification.

## Verified baseline

- Checkout: `82e7b5c` on `main`, initially clean.
- Stable release: `20260904T180013-82e7b5c-22620`; port 3000 returned HTTP 200.
- Baseline: 6 Projects, 16 Tasks, 92 Subtasks, 99 Status Reports, 6 Verifications, and 6 Tracker Links. Portfolio: 2 backlog, 6 planned, 2 active, 4 awaiting verification, 0 completed, 1 released, 1 wont_do.
- Checks run in this audit: 213 tests passed, 910 assertions, zero failures; TypeScript typecheck passed. Browser interactions, product runtime acceptance, and human Verification were not repeated.
- Pre-maintenance backup: `/Users/agent/Library/Application Support/Factory/backups/factory-pre-data-reconciliation-20260904Treview.sqlite`.

## Confirmed workflow gaps

1. **Skill discovery does not cover both agents.** The Codex copy was installed, but `~/.claude/skills/software-factory` was absent. The original description was command-oriented rather than identifying routine tracked-project work as its trigger. Installing a skill improves discoverability; it does not prove that every future session will invoke it.
2. **Branch-only entry blocks ordinary maintenance.** `project context --workspace-root /Users/agent/Projects/factory --branch-name main` fails despite the Project existing. Project-only resolution returns its Tasks. The loop needs explicit Project-level inspection and an evidence-based Task choice, without guessing a branch match or rewriting historical branches.
3. **Parent readiness is too easy to overstate.** `src/application.ts` promotes a parent based on the highest child state; one complete report can produce `awaiting_verification` while siblings remain planned. The Preview Environments task demonstrated this. The reporting loop must read and deliberately reconcile the parent after child updates. A domain-level all-subtasks readiness rule is a separate product decision, not implemented by this review.
4. **Tools cannot maintain records without agent reports.** T3 and GitHub observations intentionally do not create Status Reports or human Verification. Session linking alone does not maintain the work data. Sessions outside T3 have no guaranteed observed association.
5. **Some metadata cannot be repaired through the CLI.** Task update exposes title, objective, acceptance criteria, branch, and PR URL, but not dependency, owner, priority, or repository-link edits. The T3 Task still names a Keychain dependency although the actual T3 credential is file-backed. Preserve this as an outstanding metadata correction rather than silently bypassing the public interface.

6. **Manual Task holds can outlive child acceptance.** `getTaskStatus` prioritizes a manual Work State; `promoteParentTask` retains that hold when every Subtask becomes accepted. The existing test `tests/core/work-state.test.ts`, “keeps a manual task state when every subtask is accepted,” confirms the policy. The association Task already had a manual awaiting-verification hold before this audit. The CLI has no “return to automatic rollup” operation. Avoid redundant state writes and record an explicit product decision for releasing intentional holds.
7. **T3 workspace matching differs from CLI context matching.** The CLI normalizes absolute workspace paths; the T3 coordinator compares literal roots. Equivalent paths such as `/work/factory/.` and `/work/factory` can match in one path and fail in the other. This is an independent review finding, not a code fix delivered here.

## Changes and remaining work

- Updated the canonical Software Factory skill and installed byte-identical copies for Codex and Claude. The loop now covers routine tracked-project work, Project-first lookup, unambiguous scope selection without invented branch matches, meaningful evidence changes, and parent readiness reconciliation. It preserves review-only access and human-only Verification.
- Skill validation passed using isolated `uv run --with pyyaml` (the system Python lacks PyYAML). Its 3 existing contract tests pass. No new wording-matching tests were added.
- Corrected T3 credential Subtask `b6c99997-fbc7-47e0-b6fa-bba8d0d8954d` to name file-backed configuration.
- Appended report `1b866ed8-a264-4c18-b502-eb5837465be2` to association Subtask `1d6fa31a-7415-40f4-942d-79330ea7cd69` with current `82e7b5c` implementation/release evidence and checks actually run. Updated its parent Task `9c84ed25-5abe-4e21-a813-0467d802a31f` with the current release and human acceptance checks.
- Corrected Preview Task `7a75f03e-fa16-4df4-93a2-eebfd988e63b` to active; added its PR #779 URL and an objective reflecting the current transition gates in `cluster-flux-cd` commit `23e395a`, `docs/playlister-release-transition.md`.
- Added missing Preview Subtasks `0b734294-fc41-410b-b261-98e268861e1f` (real isolated S3/MediaConvert flows) and `9a0ea300-4a65-4e96-bb1f-a5df01a6d6c8` (Stripe Sandbox billing). These remain planned; this audit did not provision or test either integration.

No deployment, external tracker write, archive disposition, or human Verification was performed. Existing accepted reports and started-task acceptance criteria were preserved.

## Adoption exit gate

A skill installation is a prerequisite, not proof of ongoing maintenance. Observe one new Codex session and one new Claude session completing a real tracked-project work cycle: resolve the correct Project and Task, report only changed evidence, read back the report ID, reconcile the parent, and hand off the exact human check. Exercise one main-branch case and one absent/ambiguous T3 match. Neither case should invent an association or suppress an otherwise authorized work report.

Remote agents and ongoing sessions were not reconfigured. Do not claim portfolio-wide continuous maintenance until those actual agent runs supply evidence.


## Additional live findings

- Watchtower API Task `7b614908-b137-4908-8c71-afc277e2f645` now names current PR #778 head `c9746c206be0a76d01b1cd2cdb2d37cbd4c365df`. Direct GitHub reads found OPEN/draft/unmerged, CodeRabbit SUCCESS, zero Actions runs, and zero check-runs for that head. The previous dockerBuild-in-progress note referred to an older head. This observation is not passing CI or rollout proof.
- Factory's existing workspace mapping works. Automatic association linked this audit thread `32722b93-db68-46ad-8338-a85c2240d0c9` to audit Subtask `85e51bb9-90de-49b9-b134-e6051312486b`, association `dd6a03fd-bdb3-43ee-a278-64636c90b9c0`, with exactly one running candidate on `main`.
- The open `project_unresolved` finding `e2317038-7da8-400e-93bc-ff92a117b69c` belongs to Beacon (`fbd606a6-4954-466f-b1c6-83829840e67d`), not Factory. Beacon has neither Git origin nor workspace mapping; do not guess its intended prototype checkout.
- Same-state reports are not automatically redundant. The independent data audit found no exact duplicate state/reason/evidence payloads. Preserve historical evidence rather than deleting reports to reduce counts.

## Work recorded for follow-through

Task `d3021bdd-6f43-4e2f-b5e5-316a047e27b8` tracks this effort. Its separate open Subtasks cover fresh Codex/Claude adoption (`b16603a8-7ad2-4325-a8f6-29ece5b285e2`), parent readiness/manual-hold semantics (`caf081eb-3283-4af9-93a1-6627cb6e3797`), and consistent T3 workspace normalization (`2fe14f3a-97ef-4544-95c6-af0b29c35679`). These are not presented as implemented fixes.

Final installed skill SHA-256: `583397d2d73a99afcfa1349e4f9543519421bdfeb5533b757f8aa1015641d163`. Canonical, local Codex, and local Claude files match. Updated installation evidence is on Subtask `270c46c2-37fe-4e46-80e2-2454ad5437a9`; original report `24735e10-7065-4299-bb41-c3bebd400b86` remains historical.

## Final portfolio reconciliation decisions

| Project | Applied correction | Evidence limit / remaining work |
|---|---|---|
| Playlister previews | Added current objective and PR, missing media/billing work, descriptions, five in-progress reports, one lifecycle complete report awaiting human review; parent active | Beta staging attachment is not traffic cutover. Two-preview isolation, full media/IAM/billing acceptance, TTL expiry proof and Dev1/Dev2 retirement remain unverified. |
| Playlister Design System | Added objective, actual `feature/design-system-docs` branch, and a concrete description for the existing child | Remains planned; local `ff30b92cf` implementation does not establish merge or human acceptance. |
| Playlister Watchtower API | Replaced old PR/build note with current exact-head facts | OPEN/draft PR and no exact-head Actions evidence; no Subtasks yet, so task-only verification/reporting is still a planning gap. |
| Grail | Added stable v1.0.0 GitHub release evidence to the archived Task objective | Released disposition and existing accepted reports unchanged; local lag is not release proof. |
| Forge | Added Mark/Icon objective plus selection and export/integration children; recorded exploration in progress and current remote performance failure on the Release 1 soak child | Final icon selection and hardware qualification are not established. Release 1/2 remain planned. |
| Watchtower | Reopened testing/CI gate as in progress with current coverage/Biome failures and stale-CI distinction | MVP remains active; fixture paths do not establish production auth, callback, notification or rollout readiness. |
| Beacon | Added verified Git origin and workspace mapping; objective now describes the implemented prototype | Preserved backlog for prototype acceptance rather than expanding it into a 1.0 release task. T3 refresh still returns unmatched because the current shell contains no matching Project; metadata alone cannot supply an absent observation. |
| Factory | Updated release evidence and credential wording, installed both agent skills, recorded maintenance/adoption work and linked this session | Human acceptance, fresh-agent adoption, parent-hold semantics and T3 normalization remain separate gates. |

The cross-project review suggested completing multiple preview children, but their stored acceptance text was broader than the demonstrated thin-preview result. The final corrections deliberately retain partial progress for beta move, database isolation, infrastructure, and full end-to-end acceptance. No acceptance criteria were weakened to obtain a complete report.

A live legacy-data defect was reproduced: reporting progress on a Preview sibling failed with `Task awaiting_verification requires a reason` because historical chart report `566d0f16-e27d-41d0-ba02-438996a658d4` had no reason. Added report `02768698-385d-4663-949d-3882ab9ed3c5` preserves the historical evidence and adds the missing review check; sibling reports then succeeded. A future compatibility regression should cover reporting beside old complete reports without reasons.

Preview reports added: deployment `61896984-2746-46ce-89dd-19a0407cfe26`, beta `3b765e56-9d44-44ab-93c0-40c40e5115ee`, database `67a800f8-9653-42e2-8979-9b971f928079`, infrastructure `06978787-74d5-4495-9597-9772072a0fc5`, lifecycle `68181bf1-916d-4a58-a982-aceb9cf7f374`, validation `f3750882-5e6b-452e-806e-00a934fc796a`. Watchtower quality report: `9bd0ba2d-6996-4075-bf8c-2e5c7a498ae3`. Forge exploration report: `d19b3a61-71cb-403a-a3c1-7615d7e6880c`.

Do not interpret this audit as coverage of every historical project decision. Generic backlog entries (prototype-to-product, Design System acceptance, Beacon prototype acceptance) still need an actual selected work scope before agents can honestly report implementation progress.

Final audit report: `5fdee15a-a3ad-425c-aee8-8557483582d1`. After read-back, Preview, Watchtower MVP, and this maintenance Task are active; adoption/tool Subtasks remain open. Final integrity: `ok`. Persisted counts: `{"projects": 6, "statusReports": 112, "subtasks": 101, "tasks": 17, "trackerLinks": 6, "verifications": 6}`. Human verifications remain at the original six.

## Follow-up implementation

The later authorized tool-fix pass implements the parent readiness/manual-hold and workspace
normalization fixes in the local working tree, including legacy-reason compatibility. The
baseline findings above remain historical observations. See
[tool fixes and hooks](2026-09-04-tool-fixes-and-hooks.md) for current validation, replacement
skill hash, report IDs, and the remaining deployment/adoption gates.
