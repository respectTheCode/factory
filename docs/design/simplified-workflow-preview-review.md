# Simplified workflow preview: design review

Review · T-94 · 2026-10-09 · Opus 5.5 (design reviewer) · review only

Scope: `docs/design/previews/simplified-workflow.html` (781 lines, saved
11:54), its README, and the 18 Chrome captures in
`output/playwright/simplified-workflow/` (recaptured 11:55). These were checked
against `docs/design/simplified-workflow.md`, including the coordinator
override at its top. The preview is a **sample-data approval prototype**. The
live workflow has not been implemented, and nothing here claims otherwise.

## Verdict

**Not ready for screenshot approval yet.** The design direction holds. Fix the
six blocking items below, plus the `Check now` rename, then recapture. After
that, the set is ready to show the user. None of the fixes needs a design
change.

What already works:

- **No routine approval controls.** No Accept, Defer, Reject, Verify, or stamp
  controls remain. Approval wording appears only in the T3 DECIDE question and
  in legacy `EARLIER REVIEW` rows. Steps change state directly, and the Done
  Step dial is grey, not green.
- **Finish-rule consequence.** The live sentence covers every combination of
  mode, required PRs, and check. `Save and finish` appears only when the
  default-branch merge already satisfies the rule and no check is required. The
  save result matches the sentence, and there is no "Count this merge" action.
- **Done provenance.** Done shows `Done · PR #16 merged 8 Oct 14:02 · b6767e6`,
  says `merged to main`, and keeps deployment separate.
- **Sample labelling and layout.** Every screen carries the sample label. No
  capture overflows horizontally. The captures were taken with a 15px classic
  scrollbar, so the layout widths were actually 1265px and 375px.
- **Interactions fixed in the 11:54 revision.** Mark checked and Send back now
  update the dial, the status chip, the callout, and the side panel. Step
  changes now update the progress count.

## Blocking: visual and interaction problems in the approval images

**B1. Step-row chevrons fall onto their own line.** This affects mobile
`active`, `blocked`, and `done`, and desktop `active` (the Doing row) and
`done` (the left-open row). `.step-row` defines 4 columns (3 at ≤700px), but
the rows render 5 children (4 on mobile). The extra `⌄` button wraps onto a
separate line, leaving a stray chevron and about 50px of empty space under
every Step. This is the most visible defect in the set.

- The `⌄` button also duplicates the dial button's action. The spec says the
  dial button is the state control. Remove the `⌄`, or give the row a fixed
  named grid.
- The imported `src/web/styles.css:1593-1600` rule
  (`.panel button{width:100%}` at ≤540px) still stretches buttons inside
  panels. One result: on mobile, `Link a PR` renders above the rule sentence
  instead of after it.

**B2. Counts disagree with what is shown.**

- `review`: the heading says `4 of 4 done`, but only 2 Steps are shown.
- `blocked`: the heading says `2 of 4 done`, but only 2 Steps are shown, and
  only 1 of them is Done.
- `floor`, Recent work: the heading says `4 TASKS`, but only 3 rows are shown.

On a progress dashboard, counts that don't match the rows undercut the whole
pitch. Render every Step, or change the counts.

**B3. Provenance contradicts itself across screens.** "Every Done names its
proof" is a core principle, and the sample data currently breaks it:

- The Floor Shift Log says `14:02 KE Kevin checked T-62 · done`. On the same
  page, T-62 is still a pending CHECK in Needs you and on the Counter, and it is
  pending on the `check` screen.
- The Shift Log row `14:20 CX Claude: T-91 is ready` pairs Codex's initials with
  Claude's name. The `review` screen's Activity says Codex finished the task,
  while its new-commits warning says "since Claude reported ready".
- The PR #16 merge appears as `13:54` today on the Floor, but as `8 Oct 14:02`
  on the `done` screen.
- Merge SHA `b6767e6` is used for both T-88's PR #16 and T-91's PR #18 on the
  `rule` screen. T-88's legacy row adds a second merge SHA, `70d8a30`. (Both
  are real commits in this repository, not fictional ones.)
- The `rule` screen reuses T-91 as `CURRENT · AGENT FINISHES`, with PR #18
  merged and the task Active. The `review` screen shows T-91 as ON MERGE, with
  PR #18 open and the task In review. Give the rule example its own Task ID.
- The same T-91 REVIEW item is `2h` old in the sidecar but `4d` old on its
  Counter paper. The tile `oldest waiting on you 5h` contradicts the 1d and 4d
  papers. The sidecar list is not sorted oldest first (spec §7.1).

**B4. Stale proof after new commits.** On `review`, clicking
`Show new commits since ready` changes the review head to `8b0d2e4`. The
evidence panel still shows `CHECKS PASSING` and
`CodeRabbit · Reviewed this head`, and the PR row still shows `checks passing`.
That claims a review that only covered `3f2a9c1`. In that state, show
`CodeRabbit reviewed 3f2a9c1 · not this head`, and show the checks on
`8b0d2e4` as pending or unknown. Spec §15.3 also requires this variant in the
screenshot set, but only the default state is captured. Add a URL state or a
separate capture for it.

**B5. Wrong dials on the Floor.** In Recent work, T-91 shows the blue Active
dial although it is In review (amber). T-88 shows a hollow green ring instead
of the stamped green disc. The Task dial is the only lamp in this design, so it
must be correct.

**B6. Check dialog captures look broken.** The backdrop is `position:fixed`,
but the captures are full-page. On `check-desktop.png`, the page below the
first 1000px is not dimmed. On `check-mobile.png`, the bottom sheet appears in
the middle of the page and touches the right edge. Capture the dialog screens
at viewport size only, or lock page scrolling while the dialog is open.

**B7 (copy, fix before approval). `Check now` means two different things.** On
the `check` screen, it opens the human-check dialog. On `failures`, it re-polls
GitHub for a stale PR. Use `Check…` for the human check (spec §5.3), and keep
`Check now` only for refreshing GitHub data.

## Should fix (not blocking)

1. **Stacked-merge wording.** The consequence sentence
   `waiting for PR #19 to merge to the default branch` can never come true.
   PR #19 has already merged into `feat/base`; only its code can reach `main`.
   Use `waiting for PR #19's code to reach main`. Under Linked PRs, PR #19 is
   labelled `OPTIONAL`, but its row says `waiting for required code`; choose
   one. On `failures`, the waiting state appears only as prose. Add a PR row,
   the Task's state, and an explicit `not in Needs you`.
2. **The T-96 card mixes two states from §9.** `CAN'T CHECK` means GitHub is not
   connected; it offers Open Connections and creates one DECIDE per project.
   `UNAVAILABLE` means a GitHub outage; it offers Try again and creates no
   Needs-you item. The card shows both labels with conflicting actions. Split
   it into two cards.
3. **The closed-PR card is incomplete.** It shows a lone DECIDE chip and only
   `Link another PR`. The spec also lists `Mark not required` and `Open PR ↗`.
   Show the Needs-you row as it will actually appear.
4. **Left-open Step on `done`.** It is not dimmed (the spec uses `--ink-dim`),
   and its `⌄` button does nothing: the row has no `.step-item` ancestor, so
   the toggle handler exits.
5. **UNBLOCK colour differs between screens.** The Counter's UNBLOCK chip is
   amber on `floor` but red on `blocked`, because of an inline override. The
   spec says UNBLOCK stays in the down (red) tone.
6. **Blocked note is too absolute.** On `blocked`, the note "The agent and
   someone else do not place the item in Needs you" ignores the spec §2.4
   fallback: a Step blocked with no owner and no fresh agent session does
   create UNBLOCK.
7. **Wrong add-step message on `check`.** The `+ Add a step` message says the
   Task is finished. T-62 is In review, so the add row is correct; the message
   is wrong.
8. **Date mismatch on `done`.** The Activity row `13:50 Accepted by Kevin · 7
   Oct` appears under an `8 OCT` header.
9. **State codes are too small on mobile.** At ≤700px, the step state codes
   render at 8px. The spec says 10px; small codes hurt greyscale legibility.
10. **Mobile scoreboard.** The mobile scoreboard hides
    `oldest waiting on you`, the only tile about Needs you. Hide a different
    tile instead.
11. **Duplicate verb chips.** Each Needs-you callout shows the verb chip twice:
    once in the header and once on the item.
12. **Spec cleanup (my document).** §11A says `2 of 5 steps done`; the preview's
    `1 of 5` is correct. The §7.1 example list is not oldest first. §9's
    non-default-base row and §16.2 still describe the superseded `Count this
    merge` decision; the override at the top already covers this.

## Requirements for the real app (not preview blockers)

- **Step state keyboard.** The preview's arrow keys move *and* select, and
  selecting saves immediately. In the real app, each arrow press would commit a
  state change. Use a roving tabindex: arrows move focus, and Space or Enter
  commits (spec §13). Escape should return focus to the dial button.
- **Check dialog.** Trap focus. Put initial focus on the heading or the first
  field, not on `×`. Make the background inert, lock page scrolling, and return
  focus to the opener when the dialog closes.
- **One control per action** on Step rows, with at least 44px targets. In the
  preview, `Open` in tracking notes and `Add a note` are 36px.
- **Accessible names in the detail callout.** Each Needs-you item in the task
  detail needs an accessible name that includes the verb, the Task, and the age,
  as the Floor list already does.
- **Behaviour tests on an isolated fixture database:**
  - Merge detection uses the merge SHA's reachability from the default branch,
    not the PR's base field.
  - A stacked merge waits for main and creates no Needs-you item.
  - Observations go stale after 15 minutes, and stale data never changes the
    Task state.
  - `CAN'T CHECK` and `UNAVAILABLE` stay distinct.
  - Left-open Steps never create UNBLOCK.
  - Stamp and review kinds disappear from Needs you.
  - Done always carries a provenance line.
  - Chrome runs at 390px with no overflow.

## Screenshots inspected

`output/playwright/simplified-workflow/`. I viewed all 18 captures in both the
11:50 and the 11:55 sets; the findings above reflect the 11:55 set.

- `floor-desktop.png`, `floor-mobile.png`
- `active-desktop.png`, `active-mobile.png`
- `review-desktop.png`, `review-mobile.png`
- `done-desktop.png`, `done-mobile.png`
- `rule-desktop.png`, `rule-mobile.png`
- `check-desktop.png`, `check-mobile.png`
- `blocked-desktop.png`, `blocked-mobile.png`
- `failures-desktop.png`, `failures-mobile.png`
- `empty-desktop.png`, `empty-mobile.png`

Interaction findings come from reading the preview's script. I did not drive
the page in a browser, to avoid interfering with the coordinator's Chrome
session.
