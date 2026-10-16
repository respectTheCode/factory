# Simplified Factory validation

2026-10-15. Local implementation on `t3/factory-vs-multica`, base `66fc89516949f8675a66ddd30f640dcac7fb8404`, with uncommitted changes. No PR, merge, production deployment or human acceptance is implied.

## Result

Home answers Needs you, In progress and Done today in one column, with one row per task. Task detail prioritizes status and the next action, with read-only Steps, bounded history and collapsed Evidence. More and All tasks retain the existing controls. The only server change adds the new All tasks route to the app-shell fallback. Work semantics, retention and authority are unchanged.

Opus produced the [mockup and specification](factory-simple.md), an [independent design review](factory-simple-opus-review.md), and two implementation reviews. [Round 1](factory-simple-implementation-opus-review.md) found two blockers and six medium issues. [Round 2](factory-simple-implementation-opus-review-r2.md) confirms they are fixed and says **ready for human review**. Its multi-PR case is verified by source and tests; the disposable browser fixture has only single-PR tasks.

## Checks

- Implementation agent: `bun run build` (typecheck and browser bundle), scoped Prettier, `git diff --check`, and 35 focused tests / 175 assertions passed before round 2.
- Coordinator: 15 existing UI tests / 63 assertions passed over ledger styles, task tracking, brand navigation, workflow controls and activity.
- Opus round 2: 27 focused tests / 118 assertions passed.
- Browser at 1280 and 390 px: all five requests appear once, task states agree with Home, direct All tasks reload works, keyboard entry/Back focus restores, menus dismiss on Escape/outside click, and no horizontal overflow. Home is 2,109 px at desktop and 2,701 px at phone, compared with approximately 3,203 and 6,360 before.
- Earlier disposable-fixture checks exercised a real human-check mutation, blank send-back validation and offline recovery. Round 2 submitted no form. No production data was used for UI validation.

Screenshots and exact browser coverage are recorded in the Opus round 2 review. Forced colours and reduced motion were not manually exercised; stale-T3 header and offline-disabled Evidence controls were not browser-tested in round 2.

## Agent skills

The [skill rollout](factory-simple-skill-rollout.md) records all four installed copies, backup paths, source hashes and fresh-process discovery. Claude Code on M5 needs login before full skill loading can be verified. All four installed directories independently match the canonical five-file source.

## Final polish after Opus round 2

The coordinator addressed all six minor findings: consistent 24-hour times with clean report punctuation; canonical PR numbers and matching visible/accessibility labels; Cancel focus restoration; accent Evidence links and separate session actions; a 44 px skip link; and task/header alignment. These are coordinator-reviewed follow-ups to Opus's ready verdict, not a third Opus review.

Final checks: 35 tests / 177 assertions across the eight focused files pass, `bun run build` passes, scoped Prettier and `git diff --check` pass. Fresh disposable preview at `127.0.0.1:3019`: PR #101 agrees in primary action and Evidence; both links and focused skip link measure 44 px; Cancel focuses `simple-task-state-title`; phone width is 390 px with no overflow; at 1280 px the task title and brand both start at x=272. No check or send-back was submitted.

Final screenshot: `/Users/agent/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mv9moghx-538a4efa.png`.

Factory handoff: T-116, finished report `a947e58e-abcc-458b-b3be-b74c668b60fe`, workflow epoch 0. Readback remains `awaiting_verification` because no required PR is linked. This records the local handoff without claiming merge or acceptance.

## Shared Factory chrome follow-up

After reviewing the preview, the user requested that Home match the rest of Factory. The full existing brand, visible Home / All tasks / Backups navigation, session controls and Connections indicator now share `src/web/app-header.tsx` on every signed-in route. The compact header is removed. Primary links retain browser modifier/middle-click behavior; task routes select All tasks. Home uses the same shell alignment, Ledger panel, canvas and controls as secondary screens, preserving its three task groups and freshness messaging. Session token-handoff sign-out guards remain intact.

Implementation validation: 20 focused navigation, freshness, brand and task-detail tests pass; `bun run build`, scoped Prettier and `git diff --check` pass. Coordinator also ran 23 related Home/model, palette, workflow and tracking tests, all passing.

The disposable preview was refreshed at `http://127.0.0.1:3019/`. Browser checks at 1280 and 390 px confirm a single header, correct active navigation, 44 px primary links, no horizontal overflow and all five queue items preserved. Home's panel and brand both start at x=24 on desktop. Real clicks navigate to All tasks, Backups, Connections, Home and task detail; task title focus and All tasks selection work on detail entry. No mutations were submitted.

Current screenshots:

- Desktop Home: `/Users/agent/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mva8q6h7-1bb47938.png`.
- Phone Home: `/Users/agent/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mva8qhph-6a0754e2.png`.

The additional Opus review through the Claude harness failed before review with `Claude API rate limit reached. Try again later.` The same exact Opus 5.5 model was dispatched through the other available harness, but T3 restarted and cancelled that run before it returned findings. The disposable preview was restored; the fresh Claude-harness review also failed before review with the same API rate limit. The exact same Opus 5.5 model subsequently completed the alternate-harness review (r4) and verification (r5); see the corrections and final verdict below. This does not supersede the earlier Opus verdict for the prior styling.

### Shared-chrome review corrections

The exact Opus 5.5 review through the alternate harness completed in [factory-home-chrome-opus-review.md](factory-home-chrome-opus-review.md). It confirms Home matches Factory but found task freshness/Back collision, missing task panel alignment, left-aligned mobile nav labels and an optional All tasks list gap.

The coordinator fixed all four: task detail now has the shared panel at the shell edge with an inner 52rem reading measure; freshness occupies its own row; nav uses centered flex alignment; the project list has 12px top spacing. Final build/typecheck, 20 focused tests / 107 assertions, scoped formatting and diff checks pass.

Fresh browser verification at port 3019: desktop task panel x=24, Ledger background rgb(27,24,21), reading width 832px and 12px vertical separation between freshness and Back. Phone width and scroll width both 390px; nav targets are 44px and text center differences are under 0.004px. Screenshots: `browser-screenshot-127-0-0-1-mvaftwa8-8cbac6fc.png` (desktop), `browser-screenshot-127-0-0-1-mvafu4z6-2a2ca462.png` (phone), under `/Users/agent/.t3/userdata/browser-artifacts/`. The [final Opus verification](factory-home-chrome-opus-review-r5.md) says **ready for human review**: all four findings resolved, with no regression found in the routes checked. The reviewer independently confirmed desktop and phone layout, focus, active navigation, missing-task recovery and no horizontal overflow. Review limits are recorded in that report. No human acceptance, PR, merge or deployment is implied.

Shared-chrome handoff: T-116 finished report `005e7509-ef18-4f14-9f95-a7202642ce6b`, workflow epoch 0. Readback is `awaiting_verification` because no required PR is linked. Implementation and design review are delivered locally; merge and human acceptance remain separate.

## Merge preparation

On 2026-10-16, the user approved the preview and requested merge. The branch matches the current `origin/main` base (`66fc895`), and final local validation passes: all 664 tests / 3,200 assertions across 152 files, `bun run build` (typecheck and web bundle), `bun run format`, skill reference links and `git diff --check`. The repository currently has no GitHub Actions workflows, rulesets or branch protection configured; remote checks and automatic review must be reported separately from these local results.
