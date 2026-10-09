# Simplified workflow: implementation UI review, round 3

Review · T-94 · 2026-10-09 · Opus 5.5 (independent UI reviewer) · review only

Scope: the working UI in `/Users/agent/.t3/worktrees/factory/simplify-workflow`,
checked against `docs/design/simplified-workflow.md`, the approved prototype
(`docs/design/previews/simplified-workflow.html`), the preview reviews,
implementation rounds 1 and 2, and `simplified-workflow-validation.md`. The
coordinator overrides at the top of the spec take precedence, including the
2026-10-09 implementation review clarification.

Evidence I used:

- **Captures.** These are in `output/playwright/simplified-workflow/`:
  - The `real-*` set, captured 14:59–15:01. Each capture postdates the last
    UI source edit (`task-workflow.tsx` / `workflow-panel.tsx` at 14:57:52;
    CSS at 14:47).
  - `b6-pr-draft-{desktop,mobile}.png`, captured at 15:11.

  I looked at these captures directly: `b6-pr-draft-*`, `real-t3-mobile`,
  `real-closed-mobile`, `real-cantCheck-mobile`, `real-check-dialog-*`,
  `real-floor-mobile`, `real-nothing-needs-you-mobile`,
  `real-review-changed-mobile`, `real-blocked-form-mobile`,
  `real-agentDone-mobile`, and `real-rule-save-finish-mobile`.
- **Source.** `finish-rule-draft.ts`, `workflow-pr.tsx`, `workflow-panel.tsx`
  (finish-rule editor, Check dialog, provenance), `task-workflow.tsx` (Needs-you
  callout, `Mark not required`), `main.tsx` (Floor subscription, collapsed row
  badge), `floor.tsx`. In `application.ts`: `updateTaskFinishRule`,
  `reconcileTaskFinishRule`, Task report application,
  `describeTaskFinishRuleChange`, and the `TaskStatus` projection. In
  `server.ts`: `updateFinishRule`.
- **Logs.** In `/tmp`:
  - `factory-round3-clean-journeys.{js,log}`: 35 records. All are UI-driven
    except the agent reports, which are posted through `tasks.report`.
  - `factory-round3-{primary,extra,changed,empty,b6}-capture.log`.
  - `factory-round3-build.log`, `factory-round3-suite-final.log` (614 pass,
    0 fail), `factory-round3-format.log`, and
    `factory-round3-skill-contract.log`.
- **Typecheck.** `factory-round3-build.log` (15:00:13) predates the last edit to
  `src/remote-client.ts` (15:01:02). So I re-ran `bun run typecheck`
  (`tsc --noEmit`, which writes nothing) myself. It exited 0. I did not re-run
  `build:web`.
- **What I did not do.** I did not drive a browser, start a server, touch
  fixtures, or touch the root checkout. This file is the only one I wrote.

## Verdict

**Not ready.** B6 is fixed for the cases that the round-2 review and the
journey covered, and S8–S12 and E1–E2 are resolved (see the dispositions
below). But one blocker remains, and it is in the same consequence contract
that B6 established:

- **B7.** The finish-rule editor treats *any* Blocked Task as a deliberate
  hold. If an agent reported the Task blocked, the editor says the Task "stays
  blocked" and shows `Save rule`, yet the server finishes the Task on save.

B7 is a small fix. Three should-fixes also remain: S13 (the collapsed-row PR
summary), S14 (provenance after a rule-caused finish), and S15 (evidence for
`Mark not required`).

This verdict covers only UI, accessibility, and workflow. It says nothing about
PR, CodeRabbit, CI, merge, or deploy readiness.

## Round-2 dispositions

| #   | Item | Status | Evidence |
| --- | ---- | ------ | -------- |
| B6  | The `required` checkbox saved immediately and could finish a Task silently | **Fixed, with one gap (B7)** | **Outside the editor:** rows render read-only `required` / `optional` text, and the link control is hidden while the editor is open (`workflow-pr.tsx:145–175`). **Editor:** checkboxes write only to draft state (`workflow-panel.tsx:913–917`). `Cancel` rebuilds the draft from live data (`:1112–1124`). The consequence and the `Save and finish` label come from the draft rows (`:903–909`, `:1102–1106`). `Mark not required` only opens a draft with that PR unticked (`task-workflow.tsx:393–398`, `workflow-panel.tsx:887–902`). **Stale guard:** a stale or missing revision or epoch disables Save, with an alert (`:910–912`, `:1051–1056`). **Server:** the route is human-only and ignores any client-supplied actor (`server.ts`, `updateFinishRule`, `actor: ctx.human!.name`). Save validates revision and epoch, requires the complete canonical PR set, applies the rule and per-source requirements together, writes one `finish_rule_changed` event with `pullRequestRequirementChanges`, and attributes a finish it causes to that human (`application.ts:1981–2072`, `:6263`). **Journey:** the two-PR draft stays local through Cancel (`writeCount: 0`, no rule events, revision unchanged). One `Save and finish` then finishes the Task with Kevin as both event actor and finish actor, and the result persists after reload. **Capture:** `b6-pr-draft-*` shows `Saving finishes this task now…` and `Save and finish` at 1280 and 390px. **Gap:** the hold case is wrong (B7). |
| S8  | The phone callout was squeezed into a narrow column | **Fixed** | `real-t3-mobile`, `real-closed-mobile`, `real-cantCheck-mobile`, and `real-review-changed-mobile` show the chip and prose on one row, the sub-line under the prose, and actions below at the copy indent. Nothing is cramped. |
| S9  | The Check dialog had unlabelled content, and Send back lost the note | **Fixed** | `real-check-dialog-*` shows the `WHAT TO CHECK` and `AGENT'S FINISH REPORT` eyebrows, `rule: agent finishes + your check.`, and `What you checked (optional)`. On phone, the actions stack full width in the order `Mark checked` / `Send back…` / `Cancel`. The note field is hidden in send-back mode (`workflow-panel.tsx`, `HumanCheckDialog`: `{!sendBack && …}`). Both slots now use `role="img"`. Spacing nit under Minor. |
| S10 | The phone scoreboard hid `done today` | **Fixed** | `real-floor-mobile` and `real-nothing-needs-you-mobile` show a 2×2 grid: `done today`, `updates today`, `working now`, `oldest waiting on you`. |
| S11 | Accessible names didn't match the visible labels | **Fixed** | In the Task callout, names start with the visible action text and then add the request, Task, and age (`task-workflow.tsx:365`, `:376`, `:392`, `:412`, `:437`). The list is an `<ol>` (`:265`). The editor checkbox is named `required: PR #n`, which starts with its visible word. Floor sidecar and Counter names start with the visible chip and label (`floor.tsx:643`, `:844`). |
| S12 | `CAN'T CHECK` gave the wrong remedy | **Fixed** | `real-cantCheck-mobile`: the banner reads `Factory can't confirm merges until GitHub is connected.`, the callout action is `Open Connections`, and the PR row offers `Open Connections`. |
| E1  | The ancestor-clipping check didn't cover the final captures | **Closed** | Every capture log records `clipped: []` and `brokenImages: 0`: primary 32, extra 22, changed 2, empty 2, and B6 2. The check tests each visible element against every ancestor with horizontal `hidden` / `clip` overflow, after hiding the scrollbar. **Limit:** the check is horizontal only, so clipping by vertical overflow or line clamps isn't asserted. I saw none in the captures. |
| E2  | Mutation journeys were incomplete | **Closed for the covered paths** | The clean run passes all 35 records: Step add, keyboard reorder (API order and rendered order both checked), reload, Done with no reason, a blocked Step with owner `Me` leaving the parent Active, a zero-Step Task finishing at epoch 0, a human check, reopen (epoch 1), send back (epoch 2), removing the check with `Save and finish`, Mark done and Reopen with reasons, the closed-PR draft through Cancel and then Save, B6, and a stacked merge staying unfinished. **Not exercised:** `Mark not required` (S15), `Link a PR`, a stale draft, and a held Task. |

### Other items I was asked to re-inspect

- **Floor subscription across Task navigation.** It holds. The subscription
  effect depends only on session and connection (`main.tsx:912–922`), not on
  `view.screen`. REVIEW, DECIDE, UNBLOCK, and CHECK callouts render on Task pages
  in the captures.
- **PR tones.** `prPresentation` (`workflow-pr.tsx:68–76`) returns `ok` (green)
  only for `MERGED`, which means `row.merge`: the merge reached the default
  branch. `MERGED · WAITING` is neutral. `CLOSED`, `NOT FOUND`, and `NO ACCESS`
  are down. `STALE`, `UNAVAILABLE`, `CAN'T CHECK`, and a changed head are warn.
  The tones are canonical, but the collapsed row chooses the wrong PR (S13).
- **Responsive vertical editor.** `b6-pr-draft-mobile` and
  `real-rule-save-finish-mobile` show a vertical, unclipped editor at 390px:
  radio descriptions, Required PRs, `Also require my check`, the consequence
  sentence, and the buttons, in that order.
- **Blocked Step and parent Task.** The parent stays Active. Journey records
  7–8 show a blocked Step with `unblockItem: true`, `task: Active`, and the same
  after reload. `real-blocked-active-*` is consistent. Round-1 B4 remains fixed.
- **Missing state captures.** Not captured:
  - the Done state after the B6 save (provenance plus the requirement-change
    Activity row);
  - the Done state after `Save and finish` on an agent-finishes Task (S14);
  - `Mark not required` with the draft open;
  - the stale-draft alert;
  - the held-Task consequence;
  - the Check dialog in send-back mode.

  None of these blocks the work except through B7 and S14, but don't claim
  they are covered.

## Blocker

### B7. The editor shows the hold consequence for every Blocked Task, but only a manual hold stops completion

**Evidence.**

- The UI passes `held={status.taskState === "blocked"}`
  (`task-workflow.tsx:457`). `finishRuleConsequence` then returns
  `After saving: this Task stays blocked until you resume it.` with
  `finishes: false` (`finish-rule-draft.ts:60–65`). The button therefore reads
  `Save rule`.
- The server skips completion only for a **manual** hold:
  `task.workStateSource === "manual" && task.workState === "blocked"`
  (`application.ts`, `reconcileTaskFinishRule`, at the start of `:6231`). An
  agent's Task-level `blocked` report sets `workState = "blocked"` with
  `workStateSource = "rollup"` (`application.ts:1948–1952`), which is not a
  hold. `updateTaskFinishRule` then calls `reconcileTaskFinishRule(task, actor,
  true)` (`:2067`), and that finishes the Task.
- `TaskStatus` (`application.ts:483–529`) doesn't expose the hold source, so
  the editor can't tell the two cases apart. The unit test covers only the
  helper with `held = true` (`tests/web/finish-rule-draft.test.ts:92–130`).

**Failure scenario.** A code Task requires PR #35 (merged to main) and PR #36
(open). The agent reports the Task blocked: "waiting on upstream for #36". The
user opens `Edit` and unticks #36. The editor says
`After saving: this Task stays blocked until you resume it.` and offers
`Save rule`. The user saves, and the Task becomes `Done · PR #35 merged to
main`.

This is the silent finish that B6 removed, and here the sentence actively says
the opposite. It contradicts the clarification: "If the draft would finish the
Task, show the consequence and use **Save and finish**. A deliberate Task hold
prevents that completion and must be reflected in the consequence."

**Fix.**

- Expose the deliberate hold, for example as `manualHold: boolean` on
  `TaskStatus`, or as `workStateSource` from Task detail.
- Pass `held` only for a manual hold. For a Blocked Task that isn't held, compute
  the normal consequence, so that `Save and finish` appears when the draft would
  finish the Task.
- Consider adding `· the agent's blocked report stays in history` to that
  sentence.
- Add a helper or render test for an agent-reported Blocked Task with all
  remaining required PRs merged.

## Should fix before merge

**S13. The collapsed row summarizes the legacy Task PR field, not the required
PR set, and can show a green `merged` on an Active Task.** The row badge
renders only `task.pullRequestUrl` (`main.tsx:2629–2644`). In `b6-pr-draft-*`,
Active T-10 reads `0 of 1 steps done · PR #35 merged` in green, while PR #36 is
still required and open. The same code path:

- shows an optional Task-level PR;
- hides required PRs that come from Steps;
- shows nothing on a Task whose required PRs are all Step-linked.

Spec §4 asks for a rule-and-PR summary such as `ON MERGE · PR #18 open`. Derive
the summary from `status.requiredPullRequests`:

- the first unmet required PR, plus `+n` when there are more;
- `n of m merged` when the Task has several required PRs;
- green only when every required PR has merged, which is the moment the Task
  is Done.

**S14. After a rule save finishes an agent-finishes Task, provenance credits the
human with finishing it.** `reconcileTaskFinishRule` sets the `agent_report`
finish actor to the saver when `actorCausedFinish` is set
(`application.ts:6263`). `finishProvenance` then renders
`Done · Kevin finished it` (`workflow-panel.tsx:59`). This is what happens after
the journey's "remove human check and Save and finish": Codex's report is the
proof, but the line says Kevin did the work. Principle 3 asks that a Done name
its proof. For `pr_merge`, the proof is still the merge line, so only this kind
is wrong. Keep `report.reporter` as the finisher, and record the human's part
separately. For example: `Done · Codex finished it · Kevin removed the check`,
or leave the human's part to the Activity row, which already records it.

**S15. `Mark not required` has no runtime evidence and no focus handoff.**

- No journey or capture presses it. The closed-PR journey goes through `Edit`
  instead.
- The editor opens below the callout, but focus stays on the button and nothing
  is announced (`workflow-panel.tsx:887–902` sets state only).
- `Link a PR` and `Link another PR` in the callout click a hidden
  `.workflow-link-pr` through `querySelector` (`task-workflow.tsx:335–342`,
  `:377–384`). If the editor is already open, that button isn't rendered, so the
  action silently does nothing.

Fix:

- When the editor opens from the callout, move focus to the editor's legend or
  to the unticked checkbox, and scroll it into view.
- Make the link actions close or skip the editor first.
- Add one journey record or capture for `Mark not required` → draft →
  `Save rule`.

## Minor

- **Check dialog spacing.** `WHAT TO CHECK` sits against the title. The
  `Finished by … rule:` line reads as part of the check text.
  `AGENT'S FINISH REPORT` touches that line (`real-check-dialog-*`). Add the
  eyebrow's top margin, and move the meta line above the check section or into
  its own block.
- **Requirement Activity text repeats a PR when it has several sources.**
  `describeTaskFinishRuleChange` maps every per-source delta
  (`application.ts:3769–3787`). A PR linked from both the Task and a Step reads
  `PR #36 not required; PR #36 not required`. Deduplicate by URL in the prose,
  and keep the per-source detail in `pullRequestRequirementChanges`.
- **Actor fallback.** A rule change from the CLI without `--actor` is recorded as
  `Metadata update`, with the initials `ME` (`application.ts:974–976`). In
  `real-agentDone-mobile` and `real-rule-save-finish-mobile`, `ME` reads as the
  viewer ("me"). Use a clearer fallback such as `CLI`, or require the actor.
- **`CAN'T CHECK`, `UNAVAILABLE`, and `STALE` rows** still list
  `checks/review/threads not confirmed on this head · head unknown`. The
  closed-row cleanup already removed this noise there; apply it to these rows
  too.
- **Carried from round 2, still present:**
  - the DECIDE prose `Choose a replacement PR for Replace a closed required PR`
    (`floor.ts:784`);
  - Shift Log `Codex reported ready on …` for Tasks that Codex finished
    (`real-floor-mobile`);
  - the zero Needs-you count in amber, and `0 done today` in green on the empty
    Floor;
  - `Oct 9` rather than `TODAY` as the day separator;
  - the Step detail heading `ACTIVITY`;
  - legacy vocabulary in Observed activity.
- **Code style.** `import { useState } from "react"` sits mid-file in
  `workflow-pr.tsx:178`.

## Confirmed working (beyond the dispositions)

- **No new approval layer.** No Accept, Defer, Reject, or stamp control
  appears. Step dials are matte. Green appears on the Done Task disc, on PRs
  that merged to the default branch, and on the `done today` count.
- **Deployment stays separate.** The Check dialog says
  `Deployment remains separate`, and no merge copy implies a deploy.
- **Blocked form.** The `Blocked` segment shows as the pending choice, and
  `Add a note` is hidden while it's open (`real-blocked-form-mobile`). The
  round-2 nit is fixed.
- **Left-open and skipped Steps** keep their recorded state.
  `Reopen to change` now renders as dim text.
- **Stacked merges** stay unfinished, with neutral `MERGED · WAITING` and no
  "count this merge" decision (journey records 34–35).

## Unresolved objections

1. Fix B7, or have the user explicitly accept it. As written, the editor can
   state that a save keeps the Task blocked while the save finishes it.
2. Before claiming the B6 surface is complete, add a journey or capture for
   `Mark not required` (S15) and for the held and agent-blocked consequences
   (B7).
3. Fix S13 and S14 before merge. The user's acceptance of the screenshots
   doesn't cover a green `merged` on an Active row, or provenance that credits
   the wrong finisher.
