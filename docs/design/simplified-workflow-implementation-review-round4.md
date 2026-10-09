# Simplified workflow: implementation UI review, round 4

Review · T-94 · 2026-10-09 · Opus 5.5 (independent UI reviewer) · review only

Scope: the working UI in `/Users/agent/.t3/worktrees/factory/simplify-workflow`,
checked against `docs/design/simplified-workflow.md`, the approved prototype,
the preview reviews, implementation rounds 1–3, and the final correction
section of `simplified-workflow-validation.md`. The coordinator overrides and
the 2026-10-09 implementation review clarification at the top of the spec take
precedence.

Evidence I used:

- **Source.**
  - `finish-rule-draft.ts` (`finishRuleConsequence`).
  - `task-workflow.tsx`: the `held` prop, the callout actions, and
    `Link a replacement PR` / `Mark not required`.
  - `workflow-panel.tsx`: the `FinishRulePanel` edit/link request effect, the
    focus effect, and `finishProvenance`.
  - `workflow-focus.ts`.
  - `workflow-pr.tsx`: `requiredPullRequestSummary`, `prPresentation`, and
    `LinkPullRequest`.
  - `main.tsx`: `GitHubStatusBadge` and the Task `onLink`.
  - `application.ts`: the `TaskStatus` projection (`manualHold`),
    `reconcileTaskFinishRule`, `getTaskRequiredPullRequests`, and the Task
    update path for `pullRequestUrl`.
  - `remote-client.ts` (`manualHold` normalization), `floor.ts` (DECIDE and
    UNBLOCK eligibility), and `cli.ts` / `brief.ts`.
- **Timing.** The last source edit is `task-workflow.tsx` at 15:31:31. The final
  build (`/tmp/factory-round4-build-final.log`: `tsc --noEmit` plus
  `build:web`) and the focused run (151 pass, 0 fail) came after it. Every
  capture I inspected was taken between 15:35 and 15:37.
- **Logs.**
  - `/tmp/factory-round4-journeys-final.log`: 19 records, all PASS. I read the
    full result array.
  - `/tmp/factory-round4-suite.log`: 624 pass, 0 fail.
  - `/tmp/factory-round4-focused-final.log`.
  - `/tmp/factory-round4-journeys-v3.js`: the replacement and `Mark not
    required` assertions.
- **Captures I viewed directly.**
  - `b7-agent-blocked-draft-mobile`, `b7-agent-blocked-done-mobile`, and
    `b7-manual-hold-draft-desktop`.
  - `b7-stale-draft-mobile`.
  - `round4-mark-not-required-draft-mobile` and
    `round4-mark-not-required-saved-desktop`.
  - `round4-agent-finish-after-rule-save-desktop` and
    `round4-send-back-mobile`.
  - `b6-pr-draft-desktop`.
  - `real-floor-mobile` and `real-nothing-needs-you-mobile`.
- **What I did not do.** I did not drive a browser, start a server, change
  fixtures, re-run tests, or touch the root checkout. This file is the only one
  I wrote.

## Verdict

**Ready**, for UI, accessibility, and workflow.

- B7, S13, S14, and S15 are fixed. Source, tests, the focused Chrome journey,
  and the captures all confirm it.
- I found no regression in round-1–3 items that were already closed.
- One new should-fix remains: **S16**. It is a narrow path, and it can't
  silently finish a Task through the callout. Fix it before merge if it's
  cheap; otherwise record it as an accepted follow-up. It doesn't block.
- Everything else is optional polish.

This verdict says nothing about PR, CodeRabbit, CI, merge, or deploy readiness.

## Round-3 dispositions

| #   | Item | Status | Evidence |
| --- | ---- | ------ | -------- |
| B7  | The editor showed the hold consequence for every Blocked Task, but only a manual hold stops completion | **Fixed** | **Source:** `TaskStatus.manualHold` is `workStateSource === "manual" && workState === "blocked"` (`application.ts`, `TaskStatus` projection), which is exactly the guard at the top of `reconcileTaskFinishRule` and in `humanCheckReady`. `remote-client.ts` normalizes it to `=== true`. The editor passes `held={status.manualHold === true}` (`task-workflow.tsx:455`). An agent-blocked Task now goes through the normal consequence. **Tests:** core, API (`hydrates manualHold as an exact boolean…`), and helper tests cover both cases. **Journey:** the agent-blocked Task gives `Save and finish`, and the result is `Done` with finish and event actor Kevin, agent report Codex, and `manualHold: false`. The manual hold with the same PRs gives `Save rule`, and the Task stays `Blocked` with no `finishMetadata`. **Captures:** `b7-agent-blocked-draft-mobile` shows `Saving finishes this task now: all required PRs reached the default branch.` with `Save and finish`. `b7-manual-hold-draft-desktop` shows the amber `After saving: this Task stays blocked until you resume it.` with `Save rule`. `b7-agent-blocked-done-mobile` keeps `Codex reported a blocker…` in Activity, beside the separate `Kevin changed the finish rule … PR #36 not required` row. |
| S13 | The collapsed row summarized the legacy Task PR field | **Fixed** | `requiredPullRequestSummary` (`workflow-pr.tsx:321–359`) uses canonical `requiredPullRequests`, which merges Task and Step sources by URL. It excludes optional and merged-before-reopen PRs. It names the first unmet PR and adds `n of m merged` when there are several. A Step-sourced snapshot is found through the `subtask:` / `task:` keys. The badge is green only when the Task is completed and every required PR has merged; a fully merged Task that isn't completed (held or awaiting a check) is neutral. `b6-pr-draft-desktop` and `b7-*-draft` show `PR #36 open · 1 of 2 merged` in neutral. The misleading green `PR #35 merged` is gone. A Task with no required PR reads `No required PR` (`round4-mark-not-required-saved-desktop`). |
| S14 | A rule-caused agent-report finish credited the human | **Fixed** | The `agent_report` finish now records `actor: report.reporter || actor` and `completedAt: actorCausedFinish ? clock() : report.createdAt` (`application.ts`, `reconcileTaskFinishRule`). `round4-agent-finish-after-rule-save-desktop` reads `Done · Codex finished it`, and Activity has a separate `Kevin changed the finish rule: agent finishes` row. The journey asserts the finish actor Codex and the rule-event actor Kevin, both after reload. The `pr_merge` provenance remains the merge line. This matches the clarification. |
| S15 | `Mark not required` had no evidence or focus handoff; the link action did nothing while the editor was open | **Fixed** | **Focus:** `focusFinishRuleEditor` focuses the matching `input[data-pr-url]` (or the legend) and scrolls it into view after the editor opens. The journey records `inEditor: true` with `focusedUrl …/pull/37`. **Cancel:** `writeCount: 0`, no finish-rule events, and the revision is unchanged. **Save:** #37 is `optional`, with event actor Kevin, persisted after reload. Captures show the draft and saved states at both widths. **Link action:** it now goes through `editRequest.action === "link"`, which closes the editor and opens the `LinkPullRequest` form, focusing the URL field (`workflow-panel.tsx:901–905`, `workflow-pr.tsx:213–217`). There is no hidden-button `querySelector` any more. The journey links #39 with the editor open, with `urlFieldFocused: true`. **Label:** `Link a replacement PR` is honest for the case that was tested, where the closed PR *is* the Task's own field. The Step-sourced case is S16. |

### Round-3 minors

All of these are confirmed in source or in the captures:

- **Check dialog.** The eyebrow has its own spacing, and the meta line is
  separated by a rule (`round4-send-back-mobile`).
- **Shift Log.** It now distinguishes `Codex reported ready on …` (In review)
  from `Codex finished …` (`real-floor-mobile`).
- **Floor zero states.** The zero Needs-you count and the scoreboard zeros are
  neutral (`real-nothing-needs-you-mobile`).
- **`TODAY` separator.** It appears in every Activity capture.
- **Closed-PR DECIDE.** It reads `Decide how to handle closed PR #24`.
- **`ME` actor.** It no longer appears for CLI rule edits.
- **PR evidence rows.** `CAN'T CHECK`, `UNAVAILABLE`, and `STALE` rows use
  single-sentence proof (`unavailableProof`, plus the stale override).

The legacy Observed-activity vocabulary is retained as history. I accept that
reasoning, because it isn't an approval control.

## Should fix (does not block)

### S16. `Link a replacement PR` always replaces the Task's own PR field, even when the closed required PR came from a Step

**Evidence.**

- The callout renders `Link a replacement PR` for any `decide:closed:` row,
  without checking `row.sources` (`task-workflow.tsx:361–399`).
- The link goes to `tasks.update({ taskId, pullRequestUrl })` (`main.tsx`,
  Task `onLink`), which overwrites the Task-level field.
- `floor.ts` raises the closed-PR DECIDE for every canonical required row,
  Step-sourced rows included.
- The journey fixture covers only a closed PR that *is* the Task field (#37,
  replaced by #39).

**Failure scenario.**

1. A code Task has its own required PR #36, which is open.
2. Step S-2 links PR #37, which is required and closed without merging.
3. DECIDE shows `Decide how to handle closed PR #37`, and the user presses
   `Link a replacement PR` and pastes #40.
4. The Task field changes from #36 to #40. #36 silently leaves the
   requirement set. #37 is still required, so the DECIDE item is still there.

The change is audited: the update path records requirement changes and
reconciles with the human as actor. But it bypasses the draft and its
consequence, which the clarification reserves for requirement changes. It also
doesn't do what its label says.

There is a weaker version of the same thing. The section-level `Link a PR`
button silently replaces an existing Task PR, and nothing in the form says so.
Linking a URL that is already merged in place of an unmerged required Task PR
can finish the Task with no consequence sentence. That needs a deliberate user
action, so it's lower risk.

**Fix.** Use the smallest change, with no schema expansion:

- Show `Link a replacement PR` only when the closed row has a `task` source.
- For a Step-only source, offer `Mark not required` and `Open PR ↗`. Either
  omit the link action or say where the link lives, for example
  `Linked from Step S-2`.
- When the Task already has its own PR, show `Replaces PR #36 on this Task.` in
  the `LinkPullRequest` form.
- Add one render test for a Step-sourced closed row.

## Minor and optional polish

None of these blocks the work.

1. **Mark-not-required focus leaks to later edits.** The focus effect reads
   `editRequest?.pullRequestUrl` whenever `editing` changes. Suppose a
   `Mark not required` request has run and been cancelled, and the user then
   presses `Edit`. Focus goes to that PR's checkbox again rather than to the
   legend. Nothing is written. Clear the request URL after use, or key focus on
   the request that opened the editor.
2. **`Change finish rule` still clicks a DOM button.** The DECIDE action for
   no-PR still clicks the `Edit` button through `querySelector`
   (`task-workflow.tsx:345–355`). Because that button toggles, it *closes* the
   editor if it's already open. Route it through `setRuleEditRequest({ id,
   action: "edit" })`, the way the other actions work.
3. **The link action drops an open draft without saying so.** This is
   consistent with Cancel semantics. A one-line status such as `Draft
   discarded` would make the switch visible.
4. **The manual-hold consequence could say what happens on resume.** For
   example: `After saving: this Task stays blocked until you resume it; then it
   finishes, because all required PRs reached the default branch.` Optional.
5. **The all-merged summary repeats itself.** It reads `PR #35 merged · 2 of 2
   merged`. When every required PR has merged, `2 of 2 PRs merged` alone is
   enough.
6. **Send-back mode still shows the `Your check` slot and its explanatory
   line.** This is harmless, but the slot belongs to the check action. Hiding it
   in send-back mode would match the hidden note field.
7. **Two definitions of `manualHold`.** The agent-facing brief (`cli.ts:973`,
   which predates this change) still uses `workStateSource === "manual"`, so a
   manually set `active` Task prints `, manual hold`. This is outside the UI
   scope, but the name now has two meanings. Align it with
   `TaskStatus.manualHold`.
8. **DECIDE prose with verb-like Task names.** The no-PR DECIDE reads
   `Choose a finish rule or link a PR for Decide whether the closed PR is
   still required`. This is the same composition issue that round 3 noted for
   the replacement prose, and only fixture names make it look this bad.
   Optionally, put the Task in the sub-line: `Choose a finish rule or link a
   PR · T-5`.

## Evidence limits

- The clipping assertion is still horizontal only. I checked the viewed
  captures for vertical clipping and line clamps by eye and found none. The
  long Floor rows (`PR #18 · Make live thread dots rel…`) truncate with an
  ellipsis by design.
- No journey covers a Step-sourced closed PR (S16) or `Change finish rule`
  with the editor already open (minor 2).
- I did not re-run anything. The pass counts are as logged, and the log times
  line up with the source edit times.

## Confirmed still working

- **No approval layer.** No Accept, Defer, Reject, or stamp control appears.
  Step dials are matte. Green appears only on the Done disc, on PRs that
  reached the default branch, on `done today` when it's above zero, and on the
  collapsed summary of a completed Task.
- **Agent blocker history.** An agent-blocked Task that finishes by rule keeps
  the blocker report in Activity. Steps left open are grouped under `Left open
  when the task finished (1)`.
- **UNBLOCK for agent blockers.** On an agent-blocked Task with no fresh
  session, UNBLOCK follows spec §2.4 ("no owner and no fresh agent session").
- **Stale draft.** It shows `This Task changed while you were editing. Cancel
  and reopen the editor…`, with `Save rule` disabled. The draft's consequence
  sentence is still visible above it, which is acceptable because Save is
  disabled.
- **Deployment stays separate.** The Check dialog still says `Deployment
  remains separate`. Stacked merges stay neutral `MERGED · WAITING`.

## Unresolved objections

None blocking. S16 should be fixed or explicitly accepted as a follow-up. That
is a coordinator or user call, and it doesn't hold the UI readiness verdict.
