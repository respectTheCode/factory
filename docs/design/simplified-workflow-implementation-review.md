# Simplified workflow: implementation UI review

Review · T-94 · 2026-10-09 · Opus 5.5 (independent UI reviewer) · review only

Scope: this is a review of the working UI in
`/Users/agent/.t3/worktrees/factory/simplify-workflow`. I checked it against
`docs/design/simplified-workflow.md` (the coordinator overrides at the top take
precedence), the approved prototype `docs/design/previews/simplified-workflow.html`,
and both preview reviews.

Evidence:

- 26 real-app captures, `output/playwright/simplified-workflow/real-{floor,active,review,review-changed,done,check,check-dialog,rule,blocked,empty,agentDone,stacked,closed}-{desktop,mobile}.png`,
  all dated 13:45–13:46. The superseded `real-first-*` captures were excluded.
- Source: `src/web/{main,task-workflow,workflow-panel,workflow-pr,floor}.tsx`,
  `workflow.css`, `floor.css`, `status-presentation.ts`, `src/floor.ts`, the
  roll-up code in `src/application.ts`, `seed-real-app.ts`, and
  `capture-real.js`.
- I did not drive a browser. The fixture server, database, and root Chrome
  session were not touched. Nothing was edited except this file.

## Verdict

**The UI is not ready.** Five items block it: four are defects and one is a
gap in the evidence. The visual core matches the approved design:

- Step dials are matte, and Done Steps are grey.
- Only a Done Task shows the green disc.
- No acceptance or stamp controls remain.
- Done shows its provenance.
- Stacked merges wait, and the changed-head PR row is honest.

However, the task page fails three requirements from the approved brief:

- It drops the Needs-you items the user acts on.
- It paints non-done PR states green.
- It turns a Task Blocked when one of its Steps is blocked.

The finish-rule editor is also unstyled, and it is clipped on phone.

This verdict covers only UI visuals, accessibility, and workflow. It says
nothing about whether the whole implementation is ready. The full suite, core
typecheck, real mutation journeys, the PR, CodeRabbit, CI, backup, merge, and
deployment remain with the root.

## Blockers

### B1. The task page loses REVIEW, DECIDE, and UNBLOCK. Only CHECK survives.

**Evidence.** The Floor lists four items: REVIEW T-2, CHECK T-4, UNBLOCK T-5,
and DECIDE T-9. In the captures, only T-4 (`real-check-*`) has a `Needs you`
callout. `real-review*`, `real-blocked*`, and `real-closed*` have none. Their
`Now` lines show the agent's report rather than the verb-prefixed reason
(spec §4).

**Cause.**

- The Floor subscription runs only when `view.screen === "home"`, and its
  cleanup calls `stopFloorSubscription({ clear: true })`
  (`src/web/main.tsx:911–927`, `clearFloorState` at `:676–685`). This sets
  `floorSnapshot` to null as soon as the user opens a project.
- `TaskWorkflow` takes its `needs` from `floorSnapshot?.yourTurn.items`
  (`main.tsx:3031`), and so does `taskNeed` for the Now line (`:2386`).
- The CHECK item appears only because it comes from
  `status.humanCheckReady` instead (`task-workflow.tsx:267`).

**Effect.** The broken path is the one the user takes most often: they click a
Floor item and arrive at a task page without that item. The following
approved behaviour is unreachable from the task page:

- §5.3 callout: `Open PR ↗` and `Go to blocker`.
- The T3 control: `Open thread details` / `Respond in T3`.
- The closed-PR DECIDE actions: `Link another PR`, `Mark not required`, and
  `Open PR`.
- The REVIEW warning sub-line for a changed head.

**Fix.**

- Make Needs-you data available on the project screen. Either keep the
  snapshot without clearing it, or add a task-scoped query.
- Make the callout the first section, as §5.1 requires (see S6).
- Recapture `review`, `review-changed`, `blocked`, and `closed`.

### B2. Non-done PR states are green.

**Evidence.**

- `real-review*` shows the collapsed meta `PR #18 open · no Actions runs` in
  green.
- `real-closed*` shows `PR #24 closed` in green.
- `real-stacked*` shows `PR #29 merged` in green, although the Task is
  waiting, and the PR row's chip on the same page correctly reads
  `MERGED · WAITING`.

**Cause.** `src/web/styles.css:610` sets
`.github-status-ok span { color: var(--sig-ok) }`. In this rule, `ok` means
"the GitHub fetch succeeded", not "done". The legacy `GitHubStatusBadge`
(`main.tsx:2624`, `:3876`) still renders it in the collapsed row.

**Why it blocks.** This breaks Principle 2 ("green means the Task is done by
its rule"). A green `closed` is simply false.

**Fix.** Tone the badge by PR state: neutral for open or draft, down for
closed, and neutral or warn for merged until the code reaches the default
branch. Better still, reuse `prPresentation` from `workflow-pr.tsx`. One
source should also drive both the collapsed badge and the PR row. Today
`no Actions runs` sits above `checks passing` on the same Task.

### B3. The finish-rule editor is unstyled, and it is clipped on phone.

**Evidence: desktop (`real-rule-desktop.png`).**

- The browser-default `fieldset` and `legend` borders show.
- The checkbox overlaps `Require my check`.
- Everything sits on one horizontal row, with a 110px-tall `Save rule`
  button.
- The approved structure is missing: the question `How does this task
  finish?`, the per-option descriptions, the Required PRs list inside the
  editor, `Also require my check` / `What should you check?`, and the
  consequence sentence placed above the buttons.
- `No PR is linked yet` / `Link a PR` render below the open editor.

**Evidence: phone (`real-rule-mobile.png`).** The editor box runs off the
right edge:

- `…can't finish on me` is cut off.
- The fieldset and panel borders are clipped.
- The editor is indented about 55px.

**Cause.** `.finish-rule-editor` gets `margin: 0 0 12px 44px`
(`workflow.css:108–114`). The ≤700px reset at `:271–274` covers only
`.step-control` and `.step-detail`. The editor form also inherits a
horizontal flex form layout.

**Why the root's layout checks passed.** `capture-real.js:12,23` compares only
`documentElement.scrollWidth` with `innerWidth`. Content clipped inside an
`overflow: hidden` ancestor passes that test. Add an element-level assertion:
every visible element's `getBoundingClientRect().right` must be at most
`innerWidth`.

**Fix.** Style the editor as the vertical form in spec §6. Reset the margin on
phone. Recapture it, including the `Save and finish` variant (§15.6).

### B4. A blocked Step turns its Task Blocked.

**Evidence.**

- `seed-real-app.ts:26–28` reports only Step `Renew GitHub access` as blocked.
  It sends no Task-level report.
- `real-blocked-*` still shows the Task with a red Blocked dial and a
  `Why blocked:` amber banner.
- The Floor shows an error badge on the T-5 station and `1 blocked` in the bay
  tally.
- The approved prototype's blocked scene keeps the Task **Active** (blue)
  under the same conditions. It shows `Now: Blocked: … · on you` and an
  UNBLOCK callout (`simplified-workflow.html:579–582`; spec §16.3: "does not
  change the Task's state").

**Cause.** The legacy roll-up is still in place: `getTaskRollup`,
`promoteParentTask`, and `reconcileAutomaticTaskRollup` in
`src/application.ts` (`~5600–5690`, `1934–1946`).

**Related.** The roll-up's fallback reason at `application.ts:5619` can show
`Review Subtask <uuid>: its historical report has no recorded verification
check.` in the Task banner. That would surface a raw ID and approval
vocabulary to the user.

**Decision needed.** This is server behaviour, but it changes the approved
screen. Remove the Blocked roll-up from Step to Task (keep only Planned → Active
on the first Doing Step). Alternatively, if the behaviour is intended, the user
must approve the change.

### B5. The evidence does not cover the approved interactions.

None of the real captures shows the following:

- The Step state radiogroup open (§15.2).
- The blocked Step form, `Who can unblock it?` (§15.7).
- Step detail with history and an `EARLIER REVIEW` row (§15.4).
- The `Save and finish` variant (§15.6).
- The `Mark done…` and `Reopen…` status menu.
- A T3 DECIDE item with `Open thread details` / `Respond in T3`.
- The `CAN'T CHECK`, `UNAVAILABLE`, and `STALE` + `Check now` states (§15.8).
- `Nothing needs you.`

I read the code for several of these. The radiogroup uses a roving tabindex:
arrow keys move focus only, Space or Enter commits, and Escape returns focus
to the dial. The blocked form autofocuses its first field and maps owners as
spec §5.4.2 says. Reading code does not stand in for the 390px real-app
captures that §8.2 and §15 require. Capture these states, applying the
element-level overflow check from B3, before claiming the UI is ready.

## Should fix before merge

**S1. The Check dialog doesn't show what the agent claimed.**
`task-workflow.tsx:463–467` passes only the static line
`Other finish conditions are met. Deployment remains separate.` Spec §7.3
also requires:

- `Finished by Codex 15m ago · rule: …`
- The agent's finish report. `status.latestTaskReport` is already available.
- The merge proof, for code Tasks.
- The Countersign slot.

Without these, the user records a check without seeing the claim. The dialog
mechanics are good: focus goes to the heading, the background is inert,
scrolling is locked, Tab is trapped, Escape is blocked while saving, and the
phone sheet keeps a 12px inset.

**S2. The `Waiting: Waiting for required pull requests to merge (0 of 1)`
banner is wrong.** It appears on `review`, `stacked`, and `closed`. The word
"Waiting" is doubled. The sentence is false on `stacked`, where the PR merged
but its code hasn't reached main, and on `closed`, where the PR will never
merge. The amber tint fill also uses a surface tint that §3 reserves for the
Floor Counter. Use the rule-line copy from §9 instead:

- `PR #29 merged into feature/base. Waiting for its code to reach main.`
- `PR #24 closed without merging.`

The relevant code is `main.tsx:2589–2603` plus the server's `stateReason`.

**S3. Left-open Steps are not dimmed.** This repeats round-1 should-fix #4.
`.workflow-left-open { color: --ink-dim }` (`workflow.css`) is overridden by
`.workflow-step button.step-name { color: var(--ink) }`, so
`Update help text` renders bright on `real-done-*`. The reorder handle is also
still visible on a Done Task, although it is disabled.

**S4. The Floor's CHECK copy repeats the verb and hides what to check.**
`src/floor.ts:729` builds the label as `` `Check ${task.name}` ``, which
produces `Check Check the Floor loads…` in both the sidecar and the Counter.
Spec §7.1 says the CHECK prose line should be the check text, with the Task as
the sub-line. The same prefixing pattern applies at `:792` and `:828`.

**S5. The phone scoreboard has a text collision.** `15moldest waiting on you`
runs together because `floor.css:1024–1026` forces `display:block !important`
on the last tile. The `Scoreboard ·` pseudo-label with its trailing separator
is still there (round-2 minor 7).

**S6. The callout is placed late and is missing information.**

- It renders after `Link external tracker` and `Details and planning
  metadata` (`real-check-*`). On phone, that puts it four blocks down. Spec
  §5.1 and §8.2 say it always comes first.
- The CHECK item has no source/actor/age sub-line.
- Its button's accessible name has no age.

**S7. The changed-head proof is muted.** The `review-changed` PR row is honest
(`checks not confirmed on this head · reviewed aaaaaaa · not this head`), but:

- It renders in plain dim text, not the warn tone §9 calls for.
- It doesn't say `reported ready at aaaaaaa`.
- The `Now` line still quotes `exact-head evidence is attached` without
  qualification.

Once B1 is fixed, the REVIEW callout should carry the warn sub-line.

## Minor refinements

- Copy that still differs from the spec:
  - The bay tally says `4 waiting`; spec §7.2 says `needs you`
    (`floor.tsx:772`).
  - The tile says `finished today`; spec §7.4 says `done today`.
  - The footer says `1 tracking notes`: the plural is wrong, `not counted` is
    missing, and the footer sits outside the Needs-you panel.
- Zero-Step Tasks show `0 of 0 done` in the Steps header. Spec §8.1 says
  `No steps`.
- Done Tasks show a disabled `Edit` instead of `Reopen to change`.
  Agent-finish Tasks show a disabled `Link a PR` and `No PR is linked yet`,
  which is noise under that rule.
- Activity on a Done agent-finish Task reads `Codex reported ready:`. It
  should read `finished the task`.
- Activity also has these smaller issues:
  - GitHub's initials render as `GI`.
  - There are no day separators.
  - Every row repeats `Oct 9, 01:29 PM` in full.
  - Rows appended during the session have no `aria-live`.
- The provenance line has no merge time. Spec §3 gives the form
  `merged 8 Oct 14:02`.
- With the check enabled, the consequence sentence says it twice:
  `…waits for your check. Your check is also required.`
  (`workflow-panel.tsx:861–866` with `task-workflow.tsx:305–311`).
- While a Step saves, all four segments read `Saving…`. Spec §5.4.2 wants the
  spinner only on the chosen segment.
- Disabled controls lack the title `Reconnect to Factory to edit`.
- After `Mark checked`, focus returns to an opener that has been removed.
- `reportStatusOptions`, which still includes `Complete for verification`, is
  imported by `main.tsx:61` but never rendered. Delete it.

## Confirmed working (from captures and source)

- **Steps.**
  - States are set directly: To do, Doing, Done, Blocked.
  - Every dial has a visible text twin.
  - Done is a matte grey disc and never green.
  - Progress bars are neutral.
  - There are no Accept, Defer, Reject, stamp, or reviewer controls on Steps
    or parent Tasks.
- **Task dials.** Only Done Tasks (`done`, `agentDone`) show the green disc.
  The `In review` Tasks are amber.
- **Provenance.** `Done · PR #16 merged to main · ddddddd ↗` (the commit link)
  and `Done · Codex finished it`.
- **Deployment.** It stays separate: the Check dialog says so, and nothing
  reads "deployed".
- **Zero-Step Tasks** report and finish (`empty`, `review`, `check`,
  `agentDone`).
- **Left open.** The `Left open when the task finished (1)` group keeps the
  recorded state and carries the explanation.
- **Legacy history.** Legacy acceptance keeps its wording, with
  `EARLIER REVIEW`. The generic `Human` actor on the old fixture rule event is
  preserved as recorded.
- **Stacked merge.** It waits with a neutral `MERGED · WAITING` chip. It
  creates no Needs-you item and no "count this merge" action.
- **Needs you.**
  - It counts only REVIEW, CHECK, DECIDE, and UNBLOCK (4).
  - Tracking notes stay outside the count.
  - The sidecar and the Counter both sort oldest first (`floor.ts:1090`,
    `:1255`).
  - UNBLOCK uses the down tone.
- **Earlier root fixes.** Phone checkboxes are 16px inside 44px rows, and
  expanded titles wrap.

## Unresolved objections

1. B4 follows from server behaviour, but it changes an approved screen. Remove
   it, or get the user's re-approval. It must not ship silently.
2. I will not accept "20 layout checks with no overflow" as phone evidence
   while the check reads only document scroll width. B3 proves that check
   misses clipping.
3. A UI-ready verdict needs fresh real-app captures that show B1–B4 fixed, plus
   the B5 states, at 1280×1000 and 390×844.
