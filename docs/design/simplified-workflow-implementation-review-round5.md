# Simplified workflow: implementation UI review, round 5

Review · T-94 · 2026-10-09 · Opus 5.5 (independent UI reviewer) · review only

Scope: a bounded check of the S16, focus, and brief changes made after round 4,
in `/Users/agent/.t3/worktrees/factory/simplify-workflow` at commit
`d8084eeb12603ab0fdd93dd9126a1a00f9196fe9`. I did not repeat the full audit.
Round 4's dispositions still stand; the spec, its 2026-10-09 clarification, and
`simplified-workflow-validation.md` ("Release candidate and S16 follow-up") are
the references.

Evidence I used:

- **Source.**
  - `task-workflow.tsx`: the callout actions and the `ruleEditRequest` shape.
  - `workflow-pr.tsx`: `LinkPullRequest` and `TaskPullRequestLinkForm`.
  - `workflow-panel.tsx`: `FinishRulePanel`, specifically `openEditor`, the
    edit/link request effect, the focus effect, and Save/Cancel.
  - `workflow-focus.ts`.
  - `main.tsx`: the Task `onLink`.
  - `server.ts`: `tasks.update` input.
  - `application.ts`: the `updateTask` revision guard.
  - `cli.ts:973` and `brief.ts:276`.
- **Tests.**
  - `finish-rule-draft.test.ts`: the `Task PR replacement form` suite.
  - `simplified-workflow.test.tsx`: Step-only closed row.
  - `workflow-focus.test.ts`.
  - `project-brief-cli.test.ts`: `names a manual hold only when the Task is
    deliberately blocked`.
  - `task-workflow-api.test.ts`: `manualHold` hydration.
- **Timing.** The last source and test writes were at 15:47:43. The suite log
  `/tmp/factory-release-suite.log` (629 pass, 0 fail, 3,022 assertions) was
  written at 15:49. The captures were taken at 15:52, and the commit is from
  15:53. The worktree is clean.
- **Logs.** `/tmp/factory-s16-chrome.log`, which holds the Playwright script,
  and its console file.
- **Captures I viewed directly.**
  - `s16-step-only-desktop`.
  - `s16-replacement-mobile`.
  - `s16-stale-desktop` and `s16-stale-mobile`.
  - `s16-saved-desktop` and `s16-saved-mobile`.
- **What I did not do.** I did not drive a browser, start a server, change
  fixtures, re-run tests, or make git changes. This file is the only one I
  wrote.

## Verdict

**Ready**, for UI, accessibility, and workflow.

- S16 is fixed as recommended.
- Round-4 minors 1, 2, and 7 are fixed.
- The delta introduces no blocking issue and no regression.
- The new notes below are all optional polish.

This verdict says nothing about PR, CodeRabbit, CI, merge, or deploy readiness.
Those gates remain separate.

## Round-4 dispositions

| #   | Item | Status | Evidence |
| --- | ---- | ------ | -------- |
| S16 | `Link a replacement PR` overwrote the Task PR even when the closed PR came from a Step; a plain link replacement gave no disclosure | **Fixed** | See the S16 detail below. |
| Minor 1 | Mark-not-required focus leaked into later `Edit` opens | **Fixed** | `openEditor` clears `editorFocusUrl` before opening. Save (on success) and Cancel both clear it. A plain `Edit` therefore focuses the `legend` (`tabIndex={-1}`). Closing through the `Edit` toggle doesn't clear it, but the next `openEditor` does, so the leak can't happen. The journey confirms the checkbox is focused, then Cancel; the `Replace Task PR #36` action then gets URL-field focus. |
| Minor 2 | `Change finish rule` clicked the `Edit` toggle through the DOM, which closed an open editor | **Fixed** | Both `Change finish rule` buttons (no-PR and closed-PR) now call `setRuleEditRequest({ id, action: "edit" })`. The request effect always calls `setEditing(true)`, and the focus effect re-runs on `editRequest?.id`. An open editor stays open and its legend gets focus. There is no `querySelector` click left in `task-workflow.tsx`; the only one, at line 643, is the unrelated heading lookup. |
| Minor 7 | The brief's `manualHold` meant `workStateSource === "manual"` | **Fixed** | `cli.ts:973` now passes `status.manualHold`, the server's exact definition, and `brief.ts:276` prints `, manual hold` only from it. The CLI test asserts that a manually set active Task doesn't print it and that a deliberately blocked one does. |

Minors 3–6 and 8 were optional and are untouched. That's fine.

### S16 detail

- **Gating.** `Link a replacement PR` renders only when two things are true: the
  closed row's URL equals `task.pullRequestUrl`, and the row has a `task` source
  whose id is this Task (`task-workflow.tsx:372–391`). A Step-only closed row
  offers `Open PR ↗`, `Mark not required`, and `Change finish rule`. The render
  test asserts this with a Task PR #36 present and a Step-sourced closed row.
  `s16-step-only-desktop` shows exactly those three actions under `Decide how to
  handle closed PR #37`. The journey throws if a replacement button exists.
- **Disclosure.** With a Task PR present, the section button reads
  `Replace Task PR #36`. The form:
  - is labelled `Replace Task PR #36`;
  - says `Replaces PR #36 on this Task.`;
  - shows the old URL as a link;
  - warns, when the old link was required, `Replacing this required link may
    finish this Task if every remaining required PR has a confirmed merge to
    the default branch.`;
  - submits with `Replace PR`.

  Without a Task PR, the button stays `Link a PR` / `Link`. `s16-replacement-mobile`
  reads cleanly at 390 px: the amber warning wraps, the URL field has a visible
  focus ring, and nothing is clipped.
- **Concurrency.** `reveal` captures the opening `revision`, `url`, and
  `required`. `stale` compares the current `taskRevision` and Task URL with the
  captured values.
  - **What the stale form does.** It keeps showing the replacement context it
    opened with, raises a `role="alert"` warning, and disables submit. Pressing
    Enter is guarded too, through `!disabled` in `onSubmit`.
  - **What it sends.** `expectedRevision` comes from the opening snapshot, not
    the live one (`workflow-pr.tsx:285`). It reaches `tasks.update`, and
    `updateTask` throws `FactoryConflictError` on a mismatch, so the server is
    authoritative even if a client check is missed.
  - **What the captures show.** `s16-stale-*` shows the alert below the warning
    and a dimmed `Replace PR` at both widths.
- **Result.** `s16-saved-*` shows the result after Save:
  - The rows are #37 (`CLOSED`, still `required`) and #39 (`OPEN`, `required`).
    The section button reads `Replace Task PR #39`.
  - The Task is not Done. DECIDE for #37 is still open, the summary line is
    red: `PR #37 closed · 0 of 2 merged`.
  - Activity has a separate Kevin row naming #36 unlinked and #39 required.

  This is the intended outcome: the Step's PR was untouched, and the replacement
  was an explicit human action.

## Optional polish (none blocks)

1. **REVIEW after a replacement still credits the old report.**
   `s16-saved-*` shows `PR #39 · … Required PR is open · Codex · Task report ·
   3m ago`. That report predates #39. In this fixture both heads are `aaaaaaa`,
   so no warning appears. With real data the head would differ, and the existing
   `New commits since Codex reported ready …` line would flag it. That makes this
   low risk.
2. **The Activity wording is a little off for a replacement.** It reads `Kevin
   changed the finish rule: Changed PR requirements: PR #36 no longer linked;
   PR #39 required.` The rule didn't change, and "changed" appears twice.
   Something like `Kevin replaced Task PR #36 with #39 (required)` would be
   clearer.
3. **Focus isn't returned when the PR form closes.** After Cancel or a
   successful Save, the form unmounts and focus falls to `body`. Returning focus
   to the `Replace Task PR` / `Link a PR` button would keep keyboard users in
   place. This pattern existed before and isn't a regression.
4. **`Change finish rule` silently resets an open draft.** With the editor open,
   the edit request rebuilds the draft from saved state. This has the same
   discard-without-saying-so character as round-4 minor 3.
5. **Dual-source closed PR.** If the same closed URL is both the Task PR and a
   Step's PR, `Link a replacement PR` appears. Replacing it removes only the Task
   source, so the PR stays required through the Step and the DECIDE item
   remains. The case is narrow, and the result is visible and audited.
6. **A first link has no consequence line.** The finish warning is keyed on the
   old link being required. Under `ON MERGE` with no required PR, linking a URL
   that has already merged can finish the Task with no warning. This is the
   user directly answering `Link a PR`, so it's acceptable as is.
7. **A Step PR's origin isn't shown in the list.** Rows don't say
   `Linked from Step …`. Round 4 allowed omitting the action instead, which is
   what was done.

## Evidence limits

- `/tmp/factory-s16-chrome.log` contains the script but not its printed
  `STATUS`, `DETAIL`, or `S16_RECORDS` output, and the console file shows only
  page messages. I confirmed the post-save and reload claims (Task PR #36→#39,
  Step #37 still required, Task unfinished) from the `s16-saved-*` captures,
  the script's own assertions, and the source. I did not confirm them from
  logged JSON.
- The journey's background update sent `expectedRevision: before.revision`, but
  `tasks.status` exposes `taskRevision`, so the guard was probably omitted. The
  update still bumped the revision, so the stale-form proof holds. Only that
  request's own guard went untested; the server guard is covered by source.
- I didn't view `s16-step-only-mobile`, `s16-replacement-desktop`, or the
  layout records. I rely on the script's overflow and broken-image throws for
  them.
- There is no rendered-component test for `LinkPullRequest`'s `stale`
  computation itself. The form is tested with `stale` passed in, and the
  computation was exercised in Chrome.

## Unresolved objections

None. There are no blockers for UI, accessibility, or workflow.
