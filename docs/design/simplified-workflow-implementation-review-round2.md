# Simplified workflow: implementation UI review, round 2

Review · T-94 · 2026-10-09 · Opus 5.5 (independent UI reviewer) · review only

Scope: the working UI in `/Users/agent/.t3/worktrees/factory/simplify-workflow`,
checked against `docs/design/simplified-workflow.md` (the coordinator overrides
at the top take precedence), the approved prototype
`docs/design/previews/simplified-workflow.html`, the preview reviews, and round 1
(`simplified-workflow-implementation-review.md`).

Evidence I used:

- 51 current captures in `output/playwright/simplified-workflow/`, timed
  14:15:57–14:25:02. All of them postdate the last `workflow.css` edit
  (14:15:28). The superseded `real-first-*` captures were excluded.
  - Primary 26: `real-{floor,active,review,review-changed,done,check,check-dialog,rule,blocked,empty,agentDone,stacked,closed}-{desktop,mobile}.png`.
  - Extra 22: `real-{cantCheck,unavailable,stale,t3,step-control,blocked-form,step-history,rule-save-finish,mark-done-menu,reopen-menu,blocked-active}-{desktop,mobile}.png`.
  - Empty 2: `real-nothing-needs-you-{desktop,mobile}.png`.
  - Also `real-t3-open-details-mobile.png`.
- Source: `src/web/{main,task-workflow,workflow-panel,workflow-pr,floor}.tsx`,
  `workflow-activity.ts`, `workflow.css`, `floor.css`, `styles.css` (diff),
  `src/floor.ts`, the roll-up and finish-rule code in `src/application.ts`,
  `seed-real-app.ts`, and the capture scripts embedded in the logs.
- Logs: `/tmp/factory-{primary,extra,changed,empty}-capture-final.log`,
  `factory-workflow-edge-check.log`, `factory-floor-capture-stable.log`,
  `factory-step-journey.log`, `factory-t3-details-proof.log`,
  `factory-t3-details-journey.log`, `factory-mutation-journeys.log`,
  `factory-simplify-final-suite.log` (602 pass, 0 fail), and
  `factory-simplify-final-format.log` (Prettier clean).
- I found no final build log, and the only `typecheck` logs on disk (13:30–13:47)
  show errors. So I ran `bun run typecheck` (`tsc --noEmit`, which writes
  nothing) in the worktree myself. It exited 0. The output is in
  `/tmp/claude-501/round2-typecheck.log`. I did not run `build:web`.
- I did not drive a browser, start a server, touch fixtures, or touch the root
  checkout. The only file I edited is this one.

## Verdict

**The UI is not ready.** All five round-1 blockers are fixed, and the evidence
supports each fix (see the next section). Most of the round-1 should-fixes landed
too. One new workflow blocker remains (B6):

- The PR **`required`** checkbox saves immediately, both on the PR row and inside
  the finish-rule editor.
- Unticking it can finish a Task at once, with no consequence sentence.
- Factory records no human event for the change.
- `Cancel` in the editor doesn't undo it.

The latest mutation-journey log fails on this same control. There are also
should-fix issues on phone layout, accessibility, and copy. They are listed
below.

This verdict covers only UI visuals, accessibility, and workflow. It says
nothing about PR, CodeRabbit, CI, merge, or deploy readiness.

## Former blockers: status and evidence

| #  | Round-1 blocker | Status | Evidence |
| -- | --------------- | ------ | -------- |
| B1 | The task page lost Review, Decide, and Unblock | **Fixed** | `main.tsx:911–922` now subscribes to the Floor whenever the user is signed in and connected, not only on `screen === "home"`. `needs` and `taskNeed` read `floorSnapshot.yourTurn.items` only when `floorAuthoritative` is set (`main.tsx:2374`, `:2852`). `src/floor.ts` passes the full ordered queue, uncapped; only the Floor UI slices it to 5. The callouts render above the Finish rule, with `More` metadata collapsed: REVIEW (`real-review*`), DECIDE closed/no-connection/T3 (`real-closed*`, `real-cantCheck*`, `real-t3*`), UNBLOCK (`real-blocked*`), and CHECK (`real-check*`). The changed-head REVIEW sub-line is in warn (`real-review-changed*`). |
| B2 | Non-done PR states were green | **Fixed** | `GitHubStatusBadge` (`main.tsx:3909`) now uses `prPresentation`, and the `styles.css` diff adds neutral, warn, and down spans. In the captures: `open` is dim (`real-review*`), `open` is warn on a changed head, `closed` is red, `merged · waiting` is dim (`real-stacked*`), and `can't check` / `unavailable` / `stale` are warn. Green appears only on `real-done*` (`PR #16 merged`). The collapsed badge and the PR-row chip now come from one function. |
| B3 | The finish-rule editor was unstyled and clipped on phone | **Fixed** | The editor is a vertical form (`workflow.css`, `.finish-rule-editor` block). It shows the question, per-option descriptions, Required PRs inside the editor, `Also require my check`, the consequence sentence above the buttons, and `margin-left: 0`. `real-rule-{desktop,mobile}` and `real-rule-save-finish-{desktop,mobile}` show it unclipped at 390px. One reservation is in E1. |
| B4 | A blocked Step turned its Task Blocked | **Fixed (in source)** | `getTaskRollup` (`application.ts:5582–5598`) now returns only `active` or `planned`, with an explicit comment. `promoteParentTask` promotes only Planned → Active on the first Doing Step. `real-blocked*` and `real-blocked-active*` show T-5 with an Active dial, an UNBLOCK callout, and a `Blocked: GitHub token expired · on you` Step line. The Floor bay shows `0 blocked`. One caveat: in that capture, a Task-level `in_progress` report (02:08) came *after* the Step was blocked (02:06), so the screenshot alone can't prove the absence of roll-up. The source does. |
| B5 | The evidence didn't cover the approved interactions | **Fixed (with gaps in E1–E2)** | The radiogroup is open in `real-step-control*`. `real-blocked-form*` shows `What's in the way?` / `Who can unblock it?`. `real-step-history*` shows an `EARLIER REVIEW` row. `real-rule-save-finish*` shows `Saving finishes this task now…` with `Save and finish`. The `Mark done…` and `Reopen…` menus are captured with their reason fields. T3 DECIDE with `Open thread details` is in `real-t3*`, and it opens inline Observed activity, not a dialog (`real-t3-open-details-mobile.png`, `factory-t3-details-*.log`). `CAN'T CHECK` + `Open Connections`, `UNAVAILABLE` + `Try again`, `STALE` + `Check now`, and `Nothing needs you.` are all captured. The keyboard journey passed: arrows only move focus, Space commits, Done needs no reason, the parent stays Active, and the change persists after reload (`factory-step-journey.log`). |

Round-1 should-fixes that I confirmed:

- **S1.** The Check dialog now shows finished-by, actor, and age; the rule; the
  agent's report; a merge proof for code Tasks; and the slot. The rest of this
  item is in S9.
- **S2.** The rule banner now distinguishes three cases:
  - stacked: `PR #29 merged into feature/base. Waiting for its code to reach the default branch.`
  - closed: `PR #24 closed without merging.`
  - changed head: `…new commits since the agent reported ready at aaaaaaa.`
- **S3.** Left-open Steps are dimmed by
  `.workflow-left-open .workflow-step button.step-name`. On Done Tasks the
  reorder handle is no longer rendered (`workflow-panel.tsx:232`).
- **S4.** The Floor CHECK prose is now the check text, with the Task in the
  sub-line. The doubled `Check Check` is gone.
- **S6.** The callout is now the first section after the row header.
- **S7.** The changed-head PR row uses the warn tone and shows both
  `reported ready at aaaaaaa` and `new commits on bbbbbbb`.
- **Copy and minor fixes:**
  - The tally reads `needs you`.
  - The tile reads `done today`.
  - The footer reads `1 tracking note · not counted · Open`.
  - Tasks with no Steps show `No steps`.
  - Done Tasks show `Reopen to change`.
  - Activity on an agent-finished Task says `finished the task`, and GitHub's
    initials render as `GH`.
  - Activity has day separators and a live region that announces only new rows.
  - The provenance line has a merge time.
  - While a Step saves, only the chosen segment shows `Saving…`.
  - Disabled controls carry `Reconnect to Factory to edit`.

## Blocker

### B6. The PR `required` checkbox can silently finish a Task, and its change isn't recorded

**Evidence.**

- `WorkflowPullRequests` (`workflow-pr.tsx:168–182`) renders a live checkbox on
  every PR row. It saves immediately: `onChange → saveRequired → onRequired`.
  The same component is passed as `children` into the finish-rule editor
  (`workflow-panel.tsx:891–895`), so a checkbox ticked or unticked inside the
  editor is saved before `Save rule` is pressed, and `Cancel` doesn't undo it.
- The server applies the change at once and calls
  `reconcileTaskFinishRule(task, "GitHub")` (`application.ts:1804–1806`,
  `:2406–2408`). If every remaining required PR has merged, `finishTask` runs
  straight away, with actor `GitHub` and kind `pr_merge`
  (`application.ts`, `reconcileTaskFinishRule`).
- No `TaskWorkflowEvent` is written for a requirement change. Activity kinds
  cover reports, rule changes, check, send-back, mark-done, reopen, finish,
  merge, and legacy verifications (`workflow-activity.ts`).
- The DECIDE action `Mark not required` (`task-workflow.tsx:363–375`) uses the
  same path with no confirmation.

**Failure scenario.** A Task requires PR #18 (merged) and PR #19 (open). The
user unticks `required` on #19, either on the row or inside the editor and then
presses Cancel. The Task finishes at once as `Done · PR #18 merged to main`,
attributed to GitHub:

- No `Saving finishes this task now…` / `Save and finish` warning appears,
  although spec §6 requires it.
- No Activity row says the user changed the requirement.

This conflicts with:

- spec §6: Required PRs belong in the editor, behind a truthful consequence
  sentence;
- Principle 3: every Done names its proof, and here the deciding act is a
  human's;
- the scope boundary that history is append-only and complete.

**Runtime signal.** The newest journey log, `/tmp/factory-mutation-journeys.log`
(14:32), fails on exactly this control on T-9:
`locator.uncheck: Clicking the checkbox did not change its state` (PR #24). The
input is controlled by server data (`checked={row.required}`) and has no
optimistic or pending state, so the click visibly does nothing until the round
trip finishes, or does nothing at all if the save fails. That is a different
failure from the Step-reorder `locator.focus` timeout described in the brief. I
can't tell from the log whether the save succeeded. So "no known runtime
defect" is not established for this control.

**Fix.**

- **PR row.** Outside the editor, render `required` / `optional` as text, as
  spec §3 says.
- **Editor.** Make the required checkboxes draft state inside the finish-rule
  editor. Fold them into the consequence sentence, including the
  `Save and finish` variant, and commit them with `Save rule`, so that `Cancel`
  reverts them.
- **Server.** Record a requirement-change event with the human actor. Attribute
  a finish that the change causes to that human, or show it in provenance.
- **DECIDE action.** `Mark not required` should show its consequence before it
  saves (inline or in a confirm) when the change would finish the Task.
- **Journey.** Recapture the closed-PR journey once the control has a pending
  state.

## Should fix before merge

**S8. The phone Needs-you callout squeezes its text into a narrow column.**
`.workflow-needs-item` is a row flex with `align-items: center`. At ≤700px it
only gains `flex-wrap: wrap`, and that never triggers, because
`.workflow-needs-copy` has `flex: 1; min-width: 0`. On phone:

- **T3** (`real-t3-mobile`): the prose column is about 70px wide. `Choose the
  approved screenshot direction` and its sub-line `Question in T3 · Claude ·
  just now · Respond in T3` wrap over nine lines. The `DECIDE` chip floats at
  mid-height, and `Open thread details` takes half the width.
- **Closed** (`real-closed-mobile`): `Mark not required` wraps alone into the
  middle of the box.
- **Others**: the same cramping appears on `real-review*-mobile`,
  `real-check*-mobile`, and `real-cantCheck-mobile`.

Spec §8.2 shows the chip and prose on one row, and the sub-line plus action
below. On phone, give the copy `flex-basis: 100%`, or use a two-row grid with
the chip and copy on row 1 and the action on row 2. Align the chip to the top.

**S9. The Check dialog doesn't label its content, and Send back loses the
note.** (`task-workflow.tsx:596–660`, `workflow-panel.tsx:720–790`;
`real-check-dialog-*`)

- **Missing labels.** The check text and the agent's report are unlabelled
  paragraphs. The report is an indented blockquote with no
  `Agent's finish report` heading, so the user can't tell the claim from the
  request. Spec §7.3 labels both `What to check` and `Agent's finish report`.
- **Rule line.** It reads `rule: agent finishes.` and drops `+ your check`.
- **Note field.**
  - Its label reads `Note (optional)`. The spec's copy is
    `What you checked (optional)`.
  - After `Send back`, the field stays visible next to `What needs to change?`,
    and `submit` discards its contents.
  - Hide the field while sending back, or include its text in the send-back.
- **Phone actions.** They are not stacked full width in the order
  `Mark checked`, `Send back…`, `Cancel` (spec §8.2). `Send back` also lacks
  its ellipsis.
- **Slot.** It is a `<span aria-label>` with no role. Many screen readers ignore
  `aria-label` on a generic span and read `□` as "white square". Use
  `role="img"`, or put visually hidden text next to it.

**S10. On phone, the scoreboard hides `done today`.** `floor.css:1029–1031` sets
`.floor-score .floor-tile:nth-child(1) { display: none }` at ≤700px.
`real-floor-mobile` and `real-nothing-needs-you-mobile` show only
`reports today · working now · oldest waiting on you`. Round-1 S5 was fixed by
removing the one green success measure instead of fixing its spacing. Restore
the tile, for example as a 2×2 grid. The tile also still reads
`reports today`; spec §7.4 says `updates today`.

**S11. The Needs-you buttons' accessible names don't match their visible
labels.** `task-workflow.tsx:383` sets
`aria-label={`${item.kind} ${task.simpleId} ${task.name}, ${age}`}`, which
produces, for example, `review T-2 Make live thread dots reliable, 10m ago`.
This has two problems:

- It replaces the visible `Open PR ↗`, `Go to blocker`, `Open thread details`,
  or `Open`. That fails WCAG 2.5.3 (Label in Name): a voice-control user who
  says "click Open PR" gets no match.
- It also omits the request itself, which spec §13 includes
  (`Review: PR #18 is ready for your review, T-91, 2 hours`).

Start the name with the visible text and append the context. The list is also
a `<section>` of `<div>`s; spec §13 asks for an `<ol>`.

**S12. For `CAN'T CHECK`, the banner gives the wrong remedy.** In
`real-cantCheck-*`, the banner reads
`PR #31: can't check. Refresh its evidence before relying on it.`. Refreshing
can't help while GitHub isn't connected. The generic fallback in
`taskPRWaitingCopy` (`workflow-pr.tsx:296`) catches `CAN'T CHECK`, `NOT FOUND`,
and `NO ACCESS`. Use the spec §9 wording instead:
`Factory can't confirm merges until GitHub is connected.`. Also rename the
callout's bare `Open` button to `Open Connections`.

## Evidence gaps (not defects, but don't claim them)

- **E1. Ancestor-clipping check.** The element check that tests whether an
  `overflow: hidden` ancestor clips content ran only in
  `factory-workflow-edge-check.log` (14:07). That covered the 11 primary
  task screens, before the final captures. The final primary, extra, and
  empty capture scripts (14:15–14:17) test only whether an element's edge
  passes the viewport, which is the check B3 showed can miss clipping. The
  22 extra states were never checked for ancestor clipping. The 14:22 Floor
  recapture made no layout assertion at all, though the 14:16 Floor capture
  did a viewport check. The captures themselves show no visible clipping.
- **E2. Mutation journeys.** These are incomplete, as the brief says. The newest
  log fails on the `required` checkbox (B6), not on Step reorder.
  Add-Step-then-reorder, Mark checked, Send back, Mark done, Reopen, rule save,
  and Link PR have no passing real-app journey on file.

## Minor refinements

- **Blocked form** (`real-blocked-form*`):
  - The segment still shows `Doing` as checked, so nothing marks Blocked as the
    pending choice.
  - `Add a note` stays visible.
  - On desktop, `Save as blocked` and `Cancel` stretch to about 1100px.
  - On phone, the `What's in the way?` label sits against the input's focus
    ring.
- **Unchanged state.** Choosing the segment that is already current re-saves
  it and appends a duplicate report (`workflow-panel.tsx:386–389`). Treat it as
  a no-op.
- **`Reopen to change`** is a disabled button. It can't be focused, it reads as
  a dead control, and it wraps onto two lines on phone (`real-agentDone-mobile`).
  Either open the `Reopen…` flow from it, or render it as dim text.
- **Finish-rule `Edit`** has no `aria-expanded`. The warning
  `No required PR. This task can't finish on merge until you link one.` renders
  in body ink; spec §6 says warn.
- **Step detail.**
  - Its heading reads `ACTIVITY`, duplicating the Task section's heading. The
    spec says `History`.
  - Rows repeat the actor (`Claude set "Scope credentials" to Done · Claude`)
    and drop the note shown in Task Activity (`Done: Complete`).
- **Legacy history row.** It starts in lowercase: `accepted by Kevin`.
- **Closed PR row.** It still lists
  `checks/review/threads not confirmed on this head`. These readings mean
  nothing once the PR is closed. Spec §9 says `CLOSED · not merged`.
- **DECIDE prose** joins strings into
  `Choose a replacement PR for Replace a closed required PR`. Write it as
  `PR #24 closed without merging` and put the Task in the sub-line.
- **Shift Log** says `Codex reported ready on Document private access boundary`
  for a Task that Activity says Codex *finished*. Use the §7.4 sentences.
- **CHECK Task page** repeats the check text four times: the banner, the `Now`
  line, the callout, and the rule line.
- **Provenance.** The `↗` follows the timestamp rather than the SHA (spec §3).
  Activity day separators read `Oct 9` rather than `TODAY`.
- **Observed activity** still says `Factory remains the planning and
  verification authority` and `does not … verify work`. This is legacy
  vocabulary, but it sits next to the new flow.
- **Empty Needs-you state.** The `0` renders in warn amber. This predates the
  change; spec §7.1 would render zero counts faint.

## Confirmed working

- **Approval layer.** Step dials are matte, Done Steps are grey, and green
  appears only on the Done Task disc and Done-Task PR text. No Accept, Defer,
  Reject, stamp, or reviewer controls remain. Deployment is never implied: the
  Check dialog says `Deployment remains separate`.
- **Provenance.**
  `Done · PR #16 merged to main · ddddddd · merged Oct 9, 02:06 PM ↗` and
  `Done · Codex finished it`.
- **Stacked and waiting.** `MERGED · WAITING` is neutral, with no Needs-you item
  and no "count this merge" action. Provenance is withheld until the merge
  reaches main.
- **Left open.** The group keeps recorded states, with the explanation
  `These steps keep their recorded state and do not reopen the task.`
- **Needs you.** It counts only Review, Check, Decide, and Unblock (6 in the
  fixture: 1 / 1 / 3 / 1), sorted oldest first with `+1 more`. Tracking notes
  stay outside the count. UNBLOCK uses the down tone on both the sidecar and
  the Counter papers. The `Nothing needs you.` state renders, with its border
  dropping to the rule colour.
- **Menus.** `Mark done…` asks `Why is this done without its finish rule?`, and
  `Reopen…` asks for a reason. Neither offers `In review` or `Accept`.
- **Step control.** It is a roving-tabindex radiogroup labelled
  `State for <step>`, and Escape returns focus to the dial. The blocked form
  autofocuses `What's in the way?` and maps `Me` / `The agent` /
  `Someone else` to `human` / `agent` / `unknown` with a name. The 44px phone
  segments fit at 390px.
- **Check dialog mechanics.** It has a focus trap, makes the background inert,
  locks scrolling, can't be dismissed while saving, and returns focus with a
  fallback. The phone sheet keeps a 12px inset.
- **Typecheck.** Exit 0 at review time. The suite log shows 602 pass and 0 fail,
  and Prettier is clean.

## Unresolved objections

1. B6 must be fixed, or the user must accept it explicitly. A one-click
   checkbox that can finish a Task without the spec's consequence sentence and
   without a human event contradicts the "preserve history" and "every Done
   names its proof" requirements.
2. Don't present the mutation journeys as complete until a passing run covers
   the `required` control, Mark checked, Send back, Mark done, Reopen, and
   rule save on the real app.
3. Re-run the ancestor-clipping check (E1) on the final build, across all
   primary and extra states. Do this especially after S8 changes the phone
   callout layout.
