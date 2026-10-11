# Simplified workflow: Steps, finish rules, and Needs you

Design spec · T-94 · 2026-10-09 · Opus 5.5 (design) · status: **screenshots approved by the user**

Coordinator decisions for the approval preview (2026-10-09):

- Do not turn old, agent-finished work without PRs into a bulk decision queue.
  Preserve deliberately requested manual human checks, old rejection/defer
  decisions, and historical evidence. Ordinary legacy non-code completion
  should follow the direct-finish policy without inventing an approval.
- A merge into a temporary or stacked branch does not complete the Task and
  does not create a "Count this merge" decision. Wait for the required code to
  reach the repository's default branch. Show that waiting state plainly.
- These decisions supersede the legacy migration queue and non-default-base
  decision recommendations in sections 9, 10, and 16 below.

Implementation review clarification (2026-10-09): required/optional labels on
PR rows are read-only. Requirement changes belong to the finish-rule draft,
including the closed-PR action. Cancel discards the draft. Saving validates the
Task revision and workflow epoch, applies the rule and all PR requirements
together, and records the actor and changes in Activity. If the draft would
finish the Task, show the consequence and use **Save and finish**. A deliberate
Task hold prevents that completion and must be reflected in the consequence.
The server exposes this distinction as `manualHold`: an agent's Blocked report
remains historical evidence and does not become a deliberate human hold. A
rule-caused agent-report finish keeps the report author as its proof; the human
rule change appears separately in Activity. Collapsed PR summaries cover every
required canonical PR, including Step links, and exclude optional links.

This spec covers the UI for the approved model: Factory is a **progress
dashboard and exception inbox**. Optional subtasks become lightweight inline
**Steps**. Agents finish Steps directly, with no review approval. Tasks finish
by a **finish rule**:

- Ordinary code Tasks finish when Factory confirms that all required linked PRs
  have merged.
- Non-code Tasks finish when the agent reports them finished.
- A human check is opt-in for either kind of Task.

**Needs you** lists only work that requires the user: decisions, blockers on
the user, PR reviews, and explicit human checks.

It works within Ledger (`docs/design/style-guide.md` v0.3): it uses existing
tokens, dials, chips, motion, and the Floor. It adds no colour, typeface,
animation, or approval system.

Scope boundaries:

- T3 executes the work, and Factory observes it. No control in this spec
  starts, steers, or approves an agent inside T3; T3 links only open the
  thread.
- History stays append-only. Earlier reports, verifications, and PR-merge
  acceptances remain visible as recorded and are never relabelled.
- Factory never presents a deployment as a consequence of a merge. Deployment
  is separate evidence.
- The user approves screenshots of this design before implementation is
  finished (§15).

---

## 1. Principles for this change

1. **The approval layer goes; the record stays.** Remove stamps, the
   Accept/Defer/Reject controls on subtasks, and the task acceptance form.
   Keep reports, history, evidence, and the PR review packet.
2. **Green means the Task is done by its rule.** Steps never turn green, never
   glow, and never count as shipped. Only the Task dial uses the green stamped
   disc.
3. **Every Done names its proof.** A Done Task always has a provenance line:
   `PR #18 merged · 3f2a9c1`, `Claude finished it`, `Kevin checked it`, or
   `Kevin marked it done: <reason>`.
4. **Squares mean the human decides, and are now rare.** The Countersign slot
   (§7 of the guide) appears only on an explicit human check.
5. **Needs you contains only what the user alone can do.** Bookkeeping, such as
   reconciliation findings or unlinked threads, leaves the count.
6. **Make the minimum structural change.** Keep the project page's task rows,
   the Floor layout, the status dials, and the tracking panel. Change their
   contents rather than their layout.

## 2. Vocabulary and state model (UI-facing)

### 2.1 Task states

The dials stay the same. Two labels change, and the amber state changes its
meaning.

| `WorkStatus`            | Label (new)   | Dial (unchanged)       | Means                                                                                  |
| ----------------------- | ------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `backlog`               | Backlog       | sparse dashed ring     | unchanged                                                                              |
| `planned`               | Planned       | dashed ring            | unchanged                                                                              |
| `active`                | Active        | ring + quarter, info   | the agent is working, or has not yet reported the Task finished                        |
| `awaiting_verification` | **In review** | amber, full + unsealed | the agent reported it finished; the Task now needs your PR review or merge, or your check |
| `blocked`               | Blocked       | ring + bar, down       | unchanged; the reason states who can unblock it                                        |
| `completed`             | **Done**      | green stamped disc     | the finish rule is satisfied, or a human marked it done with a reason                  |
| `released`              | Released      | hollow ring + check    | a human disposition that it shipped (unchanged and separate from Done)                 |
| `wont_do`               | Won't do      | ring + slash           | unchanged                                                                              |

The amber dial keeps its grammar: the work is full because the agent finished,
and the ring is unsealed because the finish rule is not yet met.

### 2.2 Step states

Steps are the existing Subtask records under a new UI name. They are not
grouped by status. They stay in author order, like a checklist.

| Step state | State code | From `reportedState`       | Step dial (14px, **matte, never glows**)               |
| ---------- | ---------- | -------------------------- | ------------------------------------------------------ |
| To do      | `TODO`     | `backlog`, `not_started`   | dashed ring `--ink-dim`                                |
| Doing      | `DOING`    | `in_progress`              | ring + quarter wedge `--sig-info`                      |
| Done       | `DONE`     | `complete`                 | solid `--ink-dim` disc, `--canvas` check (**not green**) |
| Blocked    | `BLOCKED`  | `blocked`                  | ring + bar `--sig-down`                                |

The task dial is the only lamp. The steps are its labels.

### 2.3 Finish rules

| Rule                              | Short label     | Finishes when                                                       | Agent "finished" report does                |
| --------------------------------- | --------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| **PR merge** (code)               | `ON MERGE`      | Factory observes every required linked PR merged, with a merge SHA  | moves the Task to **In review** (REVIEW PR) |
| **Agent finishes** (non-code)     | `AGENT FINISHES` | the agent's Task-level finished report is recorded                  | finishes the Task (**Done**)                |
| + **Your check** (opt-in, either) | `+ YOUR CHECK`  | the conditions above are met **and** you record the check           | in-review → CHECK after other conditions    |

The rules work as follows:

- A confirmed merge finishes a code Task even if the agent never reported it
  finished, and even if some Steps are still To do, Doing, or Blocked
  (see §5.4.4).
- Steps all being Done never finishes a Task. A finish report, a merge, a
  check, or a human mark-done finishes it.
- "Mark done…" in the status menu is a human override and needs a reason. It is
  recorded as `Kevin marked it done: <reason>` and never as an approval.

### 2.4 Needs you kinds

The human verbs are Review, Check, Decide, and Unblock. Agent verbs never
appear in Needs you.

| Chip      | Tone       | Appears when                                                                                                                                                                 | Click target                                       |
| --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `REVIEW`  | `sig-warn` | A PR-merge Task is In review, and a required PR is open and not a draft                                                                                                      | task detail, scrolled to PR; ↗ opens the PR on GitHub |
| `CHECK`   | `sig-warn` | A Task with `+ your check` has met all its other conditions                                                                                                                 | Check dialog (§7.3)                                |
| `DECIDE`  | `sig-warn` | T3 approval pending; T3 question pending; or a Factory decision: a required PR closed without merge, an agent finished with no PR linked, a PR not found, GitHub not connected, or a migrated Task | T3 thread (T3 items) or task detail          |
| `UNBLOCK` | `sig-down` | A Task or Step is Blocked with the owner set to you (`nextOwnerKind: human`), or Blocked with no owner and no fresh agent session (current rule)                            | task detail, scrolled to the blocker               |

The following leave Needs you:

- **STAMP**: subtask claims.
- **review**: a Task awaiting verification with no claim.
- **reconcile findings**: these become an uncounted footer line,
  `3 tracking notes · Open`.

## 3. Visual grammar additions

All additions use existing tokens.

| Element             | Spec                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step dial           | 14×14 SVG, 1.4px stroke, the §2.2 shapes. No `--glow-*`. It sits inside a 44×44 transparent button.                                                                                                                                                                                                                         |
| Step state code     | `stateCode` (Plex Mono 600 · 10px · .08em · uppercase) in the dial's colour: `--ink-dim` for TODO and DONE, `--sig-info` for DOING, `--sig-down` for BLOCKED. Always visible. It is the dial's text twin.                                                                                                                   |
| Verb chip           | The existing `.floor-kind` (mono 600 · 9px · 6px radius · 16% tint · 45% border). Add `review`, `check`, and `decide` in the warn tones; `unblock` stays down.                                                                                                                                                            |
| Needs-you callout   | `--panel` fill, 1px `rgba(240,180,41,.45)` border (the bay attention border), radius `--r-card`, padding 12/14. No tint fill: amber surface tint stays reserved for the Floor Counter.                                                                                                                                    |
| Finish rule line    | Eyebrow `FINISH RULE` + one prose sentence (`body`) + an accent `Edit` text button (44px hit area). The rule chip (`ON MERGE` / `AGENT FINISHES` / `+ YOUR CHECK`) is a neutral `stateCode` chip with a `--rule` border.                                                                                                     |
| PR row              | Line 1: `PR #18` mono accent link, title (`bodyDense`), state chip. Line 2: `microData` `--ink-dim`: `checks passing · 0 open threads · head 3f2a9c1 · checked 4m ago`. Right: `required` / `optional` in mono `--ink-dim`.                                                                                                |
| PR state chips      | `DRAFT`, neutral · `OPEN`, neutral · `MERGED`, ok · `CLOSED`, down · `NOT FOUND` / `NO ACCESS`, down · `CAN'T CHECK` / `UNAVAILABLE`, warn · `STALE`, warn                                                                                                                                                                  |
| Human-check slot    | The existing 14×14 Countersign slot, dashed `--ink-dim` while waiting, filled `--tint-ok` + `--sig-ok` ✓ when checked (the 120ms stamp, the existing animation). It appears only beside `Your check`.                                                                                                                       |
| Done provenance     | `microData` line under the Task title: `Done · PR #18 merged 14:02 · 3f2a9c1` (the SHA links to the commit). Prose verdicts and mono measures, per the guide.                                                                                                                                                              |
| Earlier-review chip | A neutral `stateCode` chip `EARLIER REVIEW` (`--rule` border, `--ink-dim` text) on legacy verification history rows.                                                                                                                                                                                                       |

There is no new animation. The 120ms stamp is reused only for the human check,
and the live-report flash is reused for new Activity rows.

## 4. Collapsed task row (project page)

The structure is unchanged: dial menu, thread dots, row toggle, meta, and
progress bar. Only the contents change.

```
◔  T-94  Simplify tasks, checklist steps, and PR completion      ●●   ▸   More
   High · 1 of 5 steps done · ON MERGE · no PR yet
   ▓▓▓▓▓▓░░░░░░░░░  (accent fill — unchanged colour; counts Done steps)
   Now  CX · 4m — Building the screenshot preview from the spec
```

- The meta line changes `x/y subtasks done` (which counted *verified* steps) to
  `x of y steps done` (which counts Done steps). The bar fill stays
  `--accent`, never green. With no Steps, the meta line shows `No steps` and no
  bar appears.
- The rule chip and PR summary are compact: `ON MERGE · PR #18 open`, or
  `AGENT FINISHES`. Done Tasks show their provenance line instead.
- The `Now` line replaces `Next:`. It shows the first available item in this
  order:
  1. the Needs-you reason, prefixed by its verb chip (`REVIEW PR #18 is ready
     for your review`);
  2. the blocked reason, prefixed `Blocked:` in `--sig-down`;
  3. the latest Task-level report;
  4. the current Doing Step (`Doing: <step>`);
  5. `No updates yet.`
- `What to verify:` becomes `What to check:` and appears only for human checks.
  `Why blocked:` is unchanged.
- **Group order (recommended, low-risk):** In review, Blocked, Active, Planned,
  Backlog, Done, then the archive. Done moves to the bottom because a dashboard
  should lead with exceptions. This changes only the order of
  `liveWorkStatusOrder`.

## 5. Task detail (expanded row)

### 5.1 Section order

| #   | Section                    | Shown when                                     | Component (proposed)                                    |
| --- | -------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| 1   | Needs-you callout          | ≥1 Needs-you item targets this Task or its Steps | `TaskNeedsYou` (new, small)                             |
| 2   | Finish rule + linked PRs   | always (not archived)                          | `FinishRule` (new) → `FinishRuleEditor` inline          |
| 3   | Steps                      | always; empty state if none                    | `TaskSteps` (new) → `StepRow`, `StepStateControl`, `StepDetail` |
| 4   | Activity                   | always                                         | `TaskActivity` (new; replaces per-subtask History text) |
| 5   | Evidence (collapsed)       | always                                         | existing `TaskTracking`, retitled; `ScreenshotProof`; T3 History |
| 6   | Add Step / edit / tracker  | as today                                       | existing forms, relabelled                              |

The following are removed from the detail: `ReviewerControls` (Task and
Subtask), `TaskAcceptanceForm`, `VerificationActions`, the subtask status
groups, and the `Sign in to verify` hint.

### 5.2 Desktop wireframe (≥1280px; content column about 860px)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ◔  T-94  Simplify tasks, checklist steps, and PR completion     ●●  ▾   More │
│    High · 1 of 5 steps done · ON MERGE · no PR yet                            │
│    ▓▓▓▓▓▓░░░░░░░░░                                                            │
│    Now  CX · 4m — Building the screenshot preview from the spec               │
├───────────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────────────────────────────┐ │
│ │ NEEDS YOU                                                                 │ │
│ │ [DECIDE] Approve the UI screenshots before final implementation           │ │
│ │          Question in T3 · Claude · 12m ago                  Open in T3 ↗ │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│ FINISH RULE  [ON MERGE]                                                 Edit │
│ Finishes when its required PRs merge. No PR is linked yet.        Link a PR  │
│                                                                               │
│ STEPS                                                                 1 of 5 │
│  ●  Write design spec                               DONE      CL · 2h     ›  │
│  ◔  Build screenshot preview                        DOING     CX · 4m     ›  │
│  ◌  Implement Steps and finish rules                TODO                  ›  │
│  ◌  Chrome functional check                         TODO                  ›  │
│  ◌  Open PR and babysit to ready                    TODO                  ›  │
│  +  Add a step                                                                │
│                                                                               │
│ ACTIVITY                                                                      │
│  14:31  CX  Codex set “Build screenshot preview” to Doing                     │
│  14:02  CL  Claude finished “Write design spec”                               │
│  13:10  KE  Kevin created the task                                            │
│  Show all (9)                                                                 │
│                                                                               │
│ ▸ Evidence · sessions, handoffs, PR packet, screenshots                       │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Needs-you callout (in detail)

- It lists every Needs-you item for this Task and its Steps, oldest first. Each
  item has a verb chip, a prose line saying what is wanted, a mono sub-line
  (source, actor, age), and one primary link: `Open PR ↗`, `Check…`,
  `Open in T3 ↗`, or `Go to blocker`.
- If there are no items, the callout is not rendered at all; no empty box
  appears.
- A REVIEW item may carry warning sub-lines (§9): `New commits since Claude
  reported ready (3f2a9c1 → 8b0d2e4)`, or `Checks failing on 8b0d2e4` in
  `--sig-down`.

### 5.4 Steps

#### 5.4.1 Step row

| Part      | Spec                                                                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handle    | The existing `ReorderHandle` (⋮⋮) is visible on hover and focus on desktop and always visible on touch. Keyboard ↑/↓ keeps working. It is disabled on Done Tasks.                                                                             |
| Dial      | A 44×44 button containing the 14px step dial. `aria-label="Step 2, Build screenshot preview: Doing. Change state"`. Activating it toggles the inline state control (§5.4.2).                                                                |
| Name      | Plex Sans 500 13px; Done steps use `--ink-dim` with no strikethrough, for legibility. Up to 2 lines on phone, 1 line with ellipsis on desktop. Activating it toggles Step detail (§5.4.3).                                                   |
| State     | The always-visible state code (`DONE`, `DOING`, …).                                                                                                                                                                                         |
| Meta      | Mono `microData`: the initials of whoever last changed it, and the age (`CX · 4m`). `PR #19` if the Step has its own PR link.                                                                                                              |
| Blocked   | A second line in `--sig-down` body: `Blocked: GitHub token expired`, followed by an owner twin: `· on you` (warn) / `· on Codex` / `· owner not stated`.                                                                                     |
| Min size  | 44px row height. The whole row does **not** act as one button, because the dial and the name have distinct actions.                                                                                                                          |

#### 5.4.2 Inline state control

The control expands in place under the row. There is no popover, so it works
the same way on phone and desktop.

```
 ◔  Build screenshot preview                        DOING     CX · 4m     ›
 ┌─────────────┬─────────────┬─────────────┬─────────────┐
 │   To do     │  ● Doing    │    Done     │   Blocked   │   radiogroup, 44px tall
 └─────────────┴─────────────┴─────────────┴─────────────┘
```

- **To do, Doing, or Done:** the change saves immediately on selection. Done
  needs no reason. An optional `Add a note` link opens a one-line note field,
  stored as the report's evidence. The control collapses after the save, and a
  new Activity row flashes.
- **Blocked:** the control expands a short form before saving:

  ```
  What's in the way?            [ GitHub token for Dokploy expired          ]
  Who can unblock it?           (•) Me   ( ) The agent   ( ) Someone else
                                [Save as blocked]  [Cancel]
  ```

  `Me` maps to handoff `nextOwnerKind: human` and creates UNBLOCK. `The agent`
  maps to `agent`. `Someone else` maps to `unknown`, with a free-text name.
- Every change appends a report with the signed-in operator as reporter. The
  reporter's name shows in Activity (`Kevin set … to Done`). Agents produce the
  same rows through the CLI.
- **While saving:** the selected segment shows the existing 800ms spinner and
  the other segments are disabled. **On failure:** the row reverts and an
  inline error appears under it: `Couldn't save the step. Factory is
  unreachable. Try again.` with a `Try again` button.
- **Escape** closes the control and returns focus to the dial button.

#### 5.4.3 Step detail and history

Activating the step name expands an indented detail panel (`--panel`, 1px
`--rule`).

```
 ▾ Build screenshot preview
   Notes      Static HTML from the spec using real Ledger tokens.
   PR         —                                     Link a PR
   History
     14:31  CX  Doing                 Codex · source t3-m4 · thread …a91c
     14:02  CX  To do                 Codex
   Screenshots                                       (existing ScreenshotProof)
   Edit · Skip step · Delete
```

- History is the full append-only report list for this Step, newest first. Each
  row has a time, an actor token, a state code, the reporter attribution
  (existing `formatHistoryReportAttribution`), and the note or evidence on a
  second line when present.
- Legacy verifications interleave by time with the `EARLIER REVIEW` chip, for
  example `Accepted by Kevin · 4 Oct [EARLIER REVIEW]` or
  `Accepted by PR Merge · merge 70d8a30 [EARLIER REVIEW]`. Their wording comes
  from the existing `verificationAttribution` and stays verbatim.
- **Edit** opens the existing subtask edit form, relabelled `Step title`,
  `Description`, and `Evidence`. The `Evidence` label contract is kept.
- **Skip step** is the existing `wont_do` disposition. A skipped Step shows the
  `ring + slash` dial, takes no part in the count, and stays in history.
  **Delete** keeps its existing confirmation. Recommended copy:
  `Delete “X” and its history? Skip keeps the history.`

#### 5.4.4 Steps left open when a Task finishes

When a Task becomes Done (by merge, finish, check, or mark-done) while some
Steps are not Done:

```
 STEPS                                                           3 of 4 done
  ●  Add Connections credential form                DONE   CL · 2d
  ●  Scope tokens to projects                       DONE   CL · 2d
  ●  Audit log entries                              DONE   CX · 1d
 ▸ Left open when the task finished (1)
     ◌  Update Connections help text                TODO   — · 3d
```

- The open Steps keep their recorded state; nothing rewrites them. They go into
  a collapsed group, render at `--ink-dim` with their dials unchanged, and
  produce **no** UNBLOCK items, even if Blocked on you.
- If someone changes one of these Steps later, the change is just a report. It
  never reopens the Task.

#### 5.4.5 Add a step

- An inline input at the end of the list: `+ Add a step` turns into a text
  field on focus. Enter saves and keeps focus for the next Step. Escape
  cancels. The optional description lives in Step detail rather than in the
  add row; this is simpler than the current two-field form.
- On Done or archived Tasks, the add row is hidden. `Reopen` restores it.

### 5.5 Activity (task history)

- This is one append-only feed for the Task, newest first, and reuses the Shift
  Log row grammar (`time · initials · sentence`, actor first). Six rows are
  visible, followed by `Show all (N)`.
- It includes:
  - Task-level reports and Step changes;
  - PR events: linked, marked ready by an agent report, merged, closed, and
    new head after a ready report;
  - human checks and send-backs;
  - finish-rule changes;
  - mark-done and reopen actions;
  - legacy verifications, with the `EARLIER REVIEW` chip.
- Day separators use mono `--ink-dim` (`TODAY`, `8 OCT`).
- Example sentences:
  - `Claude reported: Opening PR after tests pass`
  - `Claude finished the task: PR #18 is ready — CI passing on 3f2a9c1, CodeRabbit reviewed this head`
  - `GitHub: PR #18 merged · 3f2a9c1. Task done.`
  - `Kevin checked it: Floor loads on M5 mini with live dots`
  - `Kevin sent it back: Dots are missing for archived threads`
  - `Kevin changed the finish rule: on merge → agent finishes`
  - `Kevin marked it done: Shipped in T-87 instead`

### 5.6 Evidence (existing tracking panel, demoted)

- `TaskTracking` stays as it is behind a collapsed
  `▸ Evidence · sessions, handoffs, PR packet, screenshots`. Inside it, three
  changes apply:
  - Retitle it `Evidence` / `Sessions, handoffs, and PR packet`.
  - Remove every *acceptance* reading. The Contributors list now reads
    `ST-271 · Done (reported by Claude)`. Remove the Review packet's
    `Factory acceptance` cell and footer note. Change the success text to
    `Update added.`
  - The report form's target select gains `This task` as its first option.
    The states for a Task are Active, Blocked, and Finished; the states for a
    Step are To do, Doing, Done, and Blocked.
- The existing Task `ScreenshotProof` and T3 `HistoryThreadLinks` move inside
  Evidence.

### 5.7 Status menu (dial)

- Remove `Accept task and all subtasks` and `Use subtask status`.
- Keep Backlog, Planned, Active, Blocked (with a reason), Released, and
  Won't do.
- Add `Mark done…`, which requires a reason: `Why is this done without its
  finish rule?` It records a human finish rather than an approval.
- When the Task is Done, add `Reopen…`, which requires a reason and returns the
  Task to Active. On reopen, PRs that already merged become
  `merged before reopen · not required`, so the old merge cannot instantly
  re-finish the Task. The rule line then reads `Needs a new PR to finish.`
- `In review` cannot be selected directly. The Task reaches it through the
  agent's finish report.
- Change the note `Task status is directly editable; child reports may advance
  it.` to `Agents report progress. The finish rule decides when it's done.`

## 6. Finish-rule editing

The editor is inline: `Edit` on the rule line expands it in place.

```
FINISH RULE
┌─────────────────────────────────────────────────────────────────────────┐
│ How does this task finish?                                              │
│  (•) When its required PRs merge                                        │
│      Code work. Factory confirms each merge on GitHub.                  │
│  ( ) When the agent finishes                                            │
│      No code. The agent's finish report completes it.                   │
│                                                                         │
│ Required PRs                                                            │
│  [✓] PR #18  Deploy production from main          OPEN                  │
│  [ ] PR #17  Spike: Dokploy webhook               CLOSED · not merged   │
│  [ https://github.com/…/pull/…                ]  [Link PR]              │
│                                                                         │
│  [✓] Also require my check                                              │
│      What should you check?                                             │
│      [ Production /health reports 3f2a9c1 after deploy             ]    │
│                                                                         │
│ After saving: finishes when PR #18 merges, then your check.             │
│ [Save rule]   [Cancel]                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Default for new Tasks:** PR merge if the project has a Git origin;
  otherwise Agent finishes. The default carries the hint `(default)` until it
  is saved.
- The PR list collects the Task PR and every Step PR. All are required by
  default, and each has its own checkbox. `Required PRs` is hidden when Agent
  finishes is selected; the links stay as evidence.
- `What should you check?` is required while the check box is on (1–500
  characters). The text becomes the CHECK item's prose line.
- **Consequence sentence.** It updates live and must be truthful:
  - `After saving: finishes when PR #18 merges.`
  - `After saving: finishes when the agent reports it finished, then your check.`
  - If saving would satisfy the rule now, the sentence reads
    `Saving finishes this task now: PR #18 already merged.` and the button
    becomes `Save and finish`.
  - If no required PR remains under the merge rule, the sentence reads
    `No required PR. This task can't finish on merge until you link one.` in
    warn.
- Saving appends an Activity row. Rule editing is locked on Done Tasks: the
  `Edit` button is replaced by `Reopen to change`.
- Errors appear inline above the buttons, and the editor stays open with the
  user's input intact.

## 7. Needs you and the Floor

### 7.1 Sidecar: "Your turn" becomes "Needs you"

```
NEEDS YOU
 4   things only you can do
     1 review · 1 check · 1 decision · 1 unblock
 [REVIEW]  PR #18 is ready for your review                          2h
           T-91 Deploy production automatically from main
 [CHECK ▢] Confirm the Floor loads on the M5 mini                   5h
           T-62 Configure Factory on the M5 mini
 [DECIDE]  Approve the UI screenshots before final implementation  12m
           T-94 · question in T3 · Claude
 [UNBLOCK] GitHub token for Dokploy has expired                     1d
           T-73 Restore Factory GitHub integration in Dokploy
 ─────────────────────────────────────────────────────────────────────
 3 tracking notes · not counted                                  Open
```

- The layout is unchanged: 56px mono count, prose sub-line, oldest first, 5
  visible plus `+N more`. The count sub-line names all four kinds. Zero counts
  render in `--ink-faint`, which is decorative because a zero needs nothing.
- When the queue is empty, the panel reads `Nothing needs you.` and its border
  drops to `--rule`, as today.
- `tracking notes` (reconcile findings) appear in an uncounted footer and open
  the project page's Observed Activity section.

### 7.2 Bays

- The tally changes from `working · waiting · blocked` to
  `working · needs you · blocked`. `needs you` counts the bay's Needs-you
  items.
- The **Counter** zone's label changes from `Counter · stamp` to
  `Counter · needs you`. Papers keep their geometry (`--tint-warn` fill, 35%
  border, the >3d emphasis, and at most 3 plus `+N more`).
  - Each paper has a verb chip at the left instead of the empty slot.
  - CHECK papers show the verb chip **and** the square slot.
  - UNBLOCK papers use a 45% `sig-down` border while keeping the warn tint.
    This is a deliberate exception: blocked-on-you is still *your turn*.
- **Stations** are unchanged. Recommended small gain: the station sub-line
  prefers the associated Task's current Doing Step (`Doing: Build screenshot
  preview`) over the thread title.
- The Bench is unchanged.

### 7.3 Check dialog

This replaces the stamp dialog. It reuses the `floor-review` shell, focus
trap, and backdrop.

```
YOUR CHECK
T-62  Configure Factory on the M5 mini
Finished by Claude 5h ago · rule: agent finishes + your check

What to check
  Open Factory on the M5 mini and confirm the Floor loads with live T3 dots.

Agent's finish report
  Factory runs under launchd on the M5 mini; Tailscale serve on :443;
  /health ok at 09:41. Evidence: launchctl list, curl /health.

What you checked (optional)
  [                                                            ]

 ▢  [Mark checked]   [Send back…]   [Cancel]
```

- **Mark checked** records the check and finishes the Task. The slot stamps
  (120ms), the dialog closes, and the paper leaves on the next render.
- **Send back…** reveals a required `What needs to change?` field and returns
  the Task to Active. It appends a handoff to the agent (`nextOwnerKind:
  agent`).
- On a code Task with a check, the dialog also shows
  `PR #18 merged 14:02 · 3f2a9c1`, so the check concerns the merged result.
- Behaviour matches the current dialog: errors appear inline, the dialog cannot
  be closed while saving, and Escape cancels.

### 7.4 Scoreboard and Shift Log

| Tile (old)       | Tile (new)              |
| ---------------- | ----------------------- |
| stamped today    | **done today** (`sig-ok`) |
| reports today    | **updates today**       |
| working now      | working now             |
| oldest unstamped | **oldest waiting on you** |

The Shift Log uses the same grammar with the new sentences:

- `Claude finished “Write design spec” on T-94`
- `Claude: T-91 is ready for review`
- `GitHub: PR #18 merged · T-91 done`
- `Kevin checked T-62 · done`
- `Kevin sent T-62 back`

## 8. Empty states and phone

### 8.1 Empty and edge states

| State                                           | Rendering                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task, no Steps, no updates                      | Steps: `No steps. Agents can report progress on the task itself, or add steps to track its parts.` + `+ Add a step`. Now: `No updates yet.` Section on `--hatch`. |
| Task, no Steps, has updates                     | The Steps section shrinks to one line: `No steps · Add a step` (dim). The Now line and Activity carry the progress.                              |
| Merge rule, no PR linked                        | Rule line: `Finishes when its required PRs merge. No PR is linked yet.` + `Link a PR`.                                                            |
| All Steps Done, Task not finished (merge rule) | Now: `Steps done. The task finishes when PR #18 merges.` Never `shipped` or `complete`.                                                          |
| Needs you empty                                 | `Nothing needs you.` (existing)                                                                                                                   |
| Project with no tasks / all archived            | Existing copy, unchanged.                                                                                                                         |

### 8.2 Phone (≤540px, reference layout)

```
┌──────────────────────────────────────┐
│ ◔ T-94 Simplify tasks, checklist  ▾  │
│   steps, and PR completion           │
│ High · 1 of 5 steps · ON MERGE       │
│ Now · CX 4m · Building the           │
│ screenshot preview                   │
├──────────────────────────────────────┤
│ NEEDS YOU                            │
│ [DECIDE] Approve the UI screenshots  │
│ before final implementation          │
│ Question in T3 · 12m     Open in T3 ↗│
├──────────────────────────────────────┤
│ FINISH RULE [ON MERGE]         Edit  │
│ Finishes when its required PRs       │
│ merge. No PR is linked yet.          │
│ Link a PR                            │
├──────────────────────────────────────┤
│ STEPS                        1 of 5  │
│ ●  Write design spec          DONE   │
│ ◔  Build screenshot           DOING  │
│    preview                           │
│ ┌────────┬────────┬────────┬───────┐ │
│ │ To do  │●Doing  │ Done   │Blocked│ │
│ └────────┴────────┴────────┴───────┘ │
│ ◌  Implement Steps and        TODO   │
│    finish rules                      │
│ +  Add a step                        │
├──────────────────────────────────────┤
│ ACTIVITY …                           │
│ ▸ Evidence                           │
└──────────────────────────────────────┘
```

- Sections are full width. The Needs-you callout always comes first. Step meta
  (initials and age) drops to the Step detail; the state code stays.
- The segmented control uses four equal 44px buttons. The blocked form's owner
  radios stack vertically.
- PR rows stack: number, state chip, and `required` on line 1; the title on
  line 2; the evidence micro-line on line 3.
- On the Floor, Needs you moves to the top, as today. Papers are full width,
  with verb chips kept.
- The Check dialog becomes a full-width sheet with a 12px margin. Its actions
  stack full width, in the order Mark checked, Send back…, Cancel.
- No horizontal overflow at 390px. This is a release check.

## 9. Failure and stale PR states

The rule for staleness: **an observed merge with a merge SHA is final**, because
merges cannot be undone. Open and closed observations go stale. A Task never
changes state on stale or unavailable non-merge data.

| Situation                                        | PR row / rule line                                                                                                                         | Needs you                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| GitHub not configured for the repo              | `CAN'T CHECK` (warn). Rule: `Factory can't confirm merges until GitHub is connected.` + `Open Connections`                                | One `DECIDE` per project: `Connect GitHub so Factory can confirm merges (3 tasks)`                 |
| Observation stale (open PR, >15 min old)        | `checked 2h ago` in warn mono + `Check now` (the existing reconcile call)                                                                   | none                                                                                                |
| Check failed (rate limit / outage)              | `UNAVAILABLE` (warn) + `GitHub didn't answer at 14:02. Try again.`                                                                         | none                                                                                                |
| PR not found / no access                        | `NOT FOUND` / `NO ACCESS` (down)                                                                                                           | `DECIDE` `Fix or unlink PR #18 on T-91`                                                             |
| Required PR closed without merge                | `CLOSED · not merged` (down). Rule: `PR #17 closed without merging. Link another PR or mark #17 not required.`                            | `DECIDE` with `Link another PR` / `Mark not required` / `Open PR ↗`                                 |
| 1 of 2 required merged                          | Merged row `MERGED` (ok); open row `OPEN`. Rule: `1 of 2 required PRs merged. Waiting for PR #19.`                                        | `REVIEW` for #19 if the agent reported it finished                                                  |
| New commits after the ready report              | Head line in warn: `head 8b0d2e4 · reported ready at 3f2a9c1`                                                                              | `REVIEW` stays, with a warn sub-line                                                                |
| Checks failing on head                          | `checks failing` (down) in the micro-line                                                                                                  | `REVIEW` stays, with a down sub-line (you decide whether to send it back on GitHub)                 |
| Merged into a non-default base (stacked PR)     | `MERGED → feat/base` (warn)                                                                                                                | none; wait for the merged code to reach the default branch                                         |
| Agent finished, merge rule, no PR               | Rule: `Claude finished, but no PR is linked.`                                                                                              | `DECIDE` with `Link a PR` / `Switch to agent finishes` / `Reopen`                                   |
| Merge observed, Steps still open                | Task Done; Steps go to `Left open when the task finished` (§5.4.4)                                                                         | none                                                                                                |
| Step save fails / Factory disconnected          | The row reverts and shows an inline error. While disconnected, controls are disabled with the title `Reconnect to Factory to edit` and the existing banner. | none                                                                                     |
| T3 source stale                                 | The existing stale treatment: tokens idle, `· stale observation`. T3 `DECIDE` items are withheld while the source is stale (current rule). | none                                                                                                |

## 10. Historical data: no fabricated approvals

| Legacy record                                              | New presentation                                                                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subtask with `complete` report, no verification            | A Done Step. History: `Done · reported by Claude`. No "accepted" text appears anywhere.                                                                                                                  |
| Accepted verification (human, reviewer, or `pr_merge`)     | Kept verbatim in Step history and Activity with `EARLIER REVIEW`. Merge SHA and screenshots stay linked.                                                                                                 |
| Rejected or deferred current report                        | A Blocked Step (matches today's effective state). Blocked line: `Rejected by Kevin in an earlier review: <reason>`. Owner not stated; not in Needs you.                                                  |
| Task `awaiting_verification`, required PRs already merged  | Finishes by the merge rule on first observation. Provenance: `Done · PR #16 merged 7 Oct · finished by merge rule on 12 Oct`. Factory shows a one-time dismissible Floor note: `9 tasks finished under the new merge rule · See list`. |
| Task `awaiting_verification`, no merged PR                 | Classify by the recorded scope and finish rule. Ordinary non-code agent-finished work may finish directly; preserve deliberately requested manual checks and rejected/deferred history. Do not create a bulk decision queue.                                        |
| Completed / released Tasks                                 | Unchanged. Their accepted history shows with `EARLIER REVIEW`.                                                                                                                                           |

## 11. Example content (for the screenshot preview)

All IDs, PR numbers, SHAs, and times below are **sample data**. Previews must
label them as such.

### A. In progress: T-94 (merge rule, no PR yet, one decision)

- **Header:** `◔ T-94 Simplify tasks, checklist steps, and PR completion` ·
  `High · 1 of 5 steps done · ON MERGE · no PR yet`.
- **Now:** `CX · 4m — Building the screenshot preview from the spec`.
- **Needs you:** `[DECIDE] Approve the UI screenshots before final
  implementation` · `Question in T3 · Claude · 12m ago`.
- **Steps:**
  1. Write design spec · DONE · CL 2h
  2. Build screenshot preview · DOING · CX 4m
  3. Implement Steps and finish rules · TODO
  4. Chrome functional check · TODO
  5. Open PR and babysit to ready · TODO

### B. PR review: T-91 (merge rule, agent finished)

- **Header:** amber dial, `T-91 Deploy production automatically from main` ·
  `4 of 4 steps done · ON MERGE · PR #18 open`.
- **Now:** `[REVIEW] PR #18 is ready for your review`.
- **Finish rule:** `Finishes when PR #18 merges.`
- **PR row:** `PR #18 Deploy production from main [OPEN] required` /
  `checks passing · CodeRabbit reviewed this head · 0 open threads · head
  3f2a9c1 · checked 2m ago`.
- **Activity:** `14:20 CX Codex finished the task: PR #18 is ready — CI passing
  on 3f2a9c1, CodeRabbit reviewed this head.`
- **Variant for §9:** `head 8b0d2e4 · reported ready at 3f2a9c1` (warn).

### C. Done via merge: T-88 (one Step left open)

- **Header:** green stamped disc, `T-88 Manage agent credentials and project
  access from Connections`.
- **Provenance:** `Done · PR #16 merged 8 Oct 14:02 · b6767e6`.
- **Steps:** 3 of 4 done; `▸ Left open when the task finished (1)` →
  `Update Connections help text · TODO`.
- **Activity:** `GitHub: PR #16 merged · b6767e6. Task done.`
- **Legacy row:** `Accepted by Kevin · 7 Oct [EARLIER REVIEW]`.
- **Deployment:** the Task does not say "deployed" anywhere. A deploy preview
  link, if reported, shows only inside Evidence as an artifact claim.

### D. Explicit human check: T-62 (non-code, agent finishes + your check)

- **Header:** amber dial, `T-62 Configure Factory on the M5 mini using M4 as
  reference` · `No steps · AGENT FINISHES + YOUR CHECK`.
- **Finish rule:** `Finishes when the agent reports it finished, then your
  check.` followed by `▢ Your check: Open Factory on the M5 mini and confirm
  the Floor loads with live T3 dots.`
- **Needs you:** `[CHECK ▢] Confirm the Floor loads on the M5 mini · Finished
  by Claude 5h ago`.
- **After Mark checked:** `Done · Kevin checked it 14:20 · "Floor loads; 3 live
  dots"`. The slot is filled green ✓.

### E. Blocked on you, for the Floor and Needs you: T-73

- **Step:** `Rotate Dokploy GitHub token` · BLOCKED ·
  `Blocked: GitHub token for Dokploy has expired · on you`.
- **Needs you:** `[UNBLOCK] GitHub token for Dokploy has expired · T-73 · 1d`.

## 12. Copy deck

| Key                    | String                                                                         |
| ---------------------- | ------------------------------------------------------------------------------ |
| Needs-you title        | `Needs you`                                                                    |
| Needs-you count line   | `{n} review(s) · {n} check(s) · {n} decision(s) · {n} unblock(s)`              |
| Empty                  | `Nothing needs you.`                                                           |
| Tracking notes         | `{n} tracking notes · not counted`                                             |
| Rule, merge            | `Finishes when its required PRs merge.` / `Finishes when PR #{n} merges.`      |
| Rule, agent            | `Finishes when the agent reports it finished.`                                 |
| Rule, + check          | `…, then your check.`                                                          |
| Partial                | `{a} of {b} required PRs merged. Waiting for PR #{n}.`                         |
| Steps all done         | `Steps done. The task finishes when PR #{n} merges.`                           |
| Left open group        | `Left open when the task finished ({n})`                                       |
| Mark done reason       | `Why is this done without its finish rule?`                                    |
| Reopen reason          | `What still needs doing?`                                                      |
| Send back reason       | `What needs to change?`                                                        |
| Check field            | `What should you check?`                                                       |
| Check note             | `What you checked (optional)`                                                  |
| Blocked fields         | `What's in the way?` · `Who can unblock it?` · `Me` / `The agent` / `Someone else` |
| Step save failure      | `Couldn't save the step. {reason} Try again.`                                  |
| Disconnected title     | `Reconnect to Factory to edit`                                                 |

The voice follows the guide's existing rule: plain, calm, second person, with
no exclamation marks. Never write `shipped`, `deployed`, `approved`, or
`verified` for Steps or for merge-finished Tasks.

## 13. Accessibility

- The step state control is a `role="radiogroup"` labelled
  `State for step {name}`. Arrow keys move between options; Space or Enter
  selects. The Blocked form receives focus on its first field.
- Every dial and chip has a text twin: the state code is visible, and verb
  chips are text. Greyscale legibility remains a release test. The Done step
  dial (grey disc) differs from To do (dashed ring) by shape alone.
- The Needs-you list is an `<ol>` of buttons. Each accessible name includes the
  verb, the request, the Task ID, and the age (for example
  `Review: PR #18 is ready for your review, T-91, 2 hours`).
- Activity uses `aria-live="polite"` only for rows appended during the session,
  not on the initial render.
- The Check dialog keeps the existing focus trap and return-focus behaviour.
  Its slot has the `aria-label` `Awaiting your check` or `Checked`.
- Tap targets are at least 44px everywhere: dial buttons, segments, the rule
  `Edit`, and `Check now`.

## 14. Files and components likely affected

### UI (this design)

| File                                   | Change                                                                                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/web/main.tsx`                     | Task row body (about lines 2650–4185): drop the subtask status groups, `VerificationActions`, `ReviewerControls`, `TaskAcceptanceForm`, and the per-subtask History button; mount the new sections in §5.1 order. Collapsed meta and `Now` line (about 2875–2936). `TaskStatusMenu`: remove accept and rollup, add `Mark done…` and `Reopen…`. `ReportStatusMenu`: replaced for Steps. `StatusIcon` labels. `VerificationActions`: delete. |
| `src/web/task-steps.tsx` (new)         | `TaskSteps`, `StepRow`, `StepDial`, `StepStateControl`, `StepDetail`, `AddStep`. Reuses `ReorderHandle` (export it from `main.tsx` or move it).                                                                                                              |
| `src/web/finish-rule.tsx` (new)        | `FinishRule` (line + PR rows + check slot), `FinishRuleEditor`, `LinkedPullRequestRow`. Reuses the label logic of `GitHubStatusBadge` and `githubStatusLabel`; move both out of `main.tsx`.                                                               |
| `src/web/task-activity.tsx` (new)      | `TaskActivity` feed; reuses `formatHistoryReportAttribution` and `verificationAttribution`.                                                                                                                                                               |
| `src/web/task-needs-you.tsx` (new, small) | Task-scoped Needs-you callout.                                                                                                                                                                                                                         |
| `src/web/status-presentation.ts`       | Labels `completed → Done` and `awaiting_verification → In review`; `stepStateOptions` (To do, Doing, Done, Blocked); `reportStatusOptions` loses `Complete for verification`; the optional group order (§4).                                              |
| `src/web/task-summary.ts`              | `summarizeTaskProgress` counts `reportedState === "complete"` (Done), not `accepted`. Steps no longer use `groupSubtasksByStatus`.                                                                                                                        |
| `src/web/task-tracking-panel.tsx`, `task-tracking.ts` | Retitle to Evidence; remove the acceptance cells and copy; add the `This task` report target and state set.                                                                                                                                 |
| `src/web/reviewer-controls.tsx`        | No longer mounted. Keep the file while history uses its types, or delete it after §16.4 is decided.                                                                                                                                                        |
| `src/web/reviewer-presentation.ts`     | `EARLIER REVIEW` labelling helper; `mergeReconciliationMessage` copy for `Check now`.                                                                                                                                                                      |
| `src/web/floor.tsx`                    | `FloorAction.kind` becomes `review`, `check`, `decide`, or `unblock`. Your turn → Needs you; count sub-line; tracking-notes footer; Counter label and papers; review dialog → Check dialog; scoreboard labels; `normalizeFloorSnapshot` mapping.            |
| `src/web/floor.css`                    | `.floor-action-review/-check/-decide` chip tones; UNBLOCK paper border; tracking-notes footer.                                                                                                                                                             |
| `src/web/styles.css`, `task-tracking.css` | Step row, segmented control, step dial, rule line, PR rows, Needs-you callout, Activity rows, left-open group. Tokens only.                                                                                                                              |
| `src/web/history.ts`                   | Step-history row formatting, if it is not moved into `task-activity.tsx`.                                                                                                                                                                                  |

### Server and contract (for coordinator awareness; not designed here)

- `src/floor.ts`: queue actions (`review_pr`, `check`, `decide`, `unblock`),
  removal of `stamp` and `review`, reconcile findings moved to an uncounted
  list, `doneToday`, and the oldest-needs-you timestamp.
- `src/application.ts`: Task-level reports; finish-rule fields
  (`finishRule`, `requiresHumanCheck`, `humanCheckText`, required flag per PR);
  automatic merge finish; human check and send-back records; reopen semantics;
  removal of the verification gate on Steps.
- `src/reconciliation.ts` and `src/github.ts`: periodic merge observation, base
  branch, staleness.
- `src/cli.ts` and `skills/software-factory/SKILL.md`: Task report and finish
  verbs. Agents stop being told to wait for human verification.
- `CONTEXT.md`: update the glossary. Subtask becomes Step, which drops the
  `checklist item` avoid. Verification narrows to an explicit human check. Add
  Finish Rule. Status Report may now finish non-code Tasks.
- `docs/design/style-guide.md`: §2.2 ("Claims are not facts" becomes "every
  Done names its proof"), §6 (amber label, progress counts Done Steps), §7
  (Countersign only for human checks), §8.4–8.5 (Counter, Needs you,
  scoreboard), and §10 (human verbs: Review / Check / Decide / Unblock / Mark
  done / Reopen).

### Tests likely touched

These are in `tests/web/`:

- `floor.test.ts`
- `task-summary.test.ts`
- `status-presentation.test.ts`
- `task-tracking-render.test.tsx`
- `task-tracking.test.ts`
- `reviewer-presentation.test.ts`
- `workflow-controls.test.ts`
- `task-row-layout.test.ts`
- `subtask-evidence-editing.test.ts`
- `history.test.ts`
- `ledger-styles.test.ts`

## 15. Screenshot set for approval

Capture each frame at **1280×1000** and **390×844** using the §11 sample data,
labelled as sample:

1. Floor: Needs you with all four kinds, Counter papers (one CHECK with its
   slot, one old paper), the new scoreboard, and the tracking-notes footer.
2. T-94 detail (A): in progress, with the DECIDE callout and one Step's state
   control open.
3. T-91 detail (B): In review, the PR row, the REVIEW callout, and the
   new-commits variant.
4. T-88 detail (C): Done via merge, the provenance line, the left-open group
   expanded, and Step history with an `EARLIER REVIEW` row.
5. T-62 detail (D): the human check, plus the Check dialog open.
6. The finish-rule editor open, with the `Save and finish` consequence variant.
7. The blocked Step form (`Who can unblock it?`) and the resulting UNBLOCK
   paper (E).
8. Failure states: required PR closed (DECIDE), a stale PR row, and
   `CAN'T CHECK`.
9. An empty Task: no Steps and no updates.

**Recommendation:** build these as a static preview,
`docs/design/previews/simplified-workflow.html`, that imports the real
`:root` tokens and the Floor and task class names. The approved screenshots
then match the shipped CSS, and the user approves the design before the server
work lands. Chrome functional checks then run on the real app with an
isolated fixture database, as in T-85.

## 16. Open decisions (with recommendations)

1. **Default rule.** Use PR merge when the project has a Git origin, otherwise
   Agent finishes. Agents may set the rule when they create a Task.
2. **Merges into a non-default base.** Recommend that only merges into the
   repository's default branch satisfy the rule automatically. For other bases, wait until the merged code reaches the default branch.
   Do not create a decision or override solely because a stacked PR merged.
3. **Task state when Steps change.** Recommend:
   - The first Step moving to Doing moves a Planned Task to Active.
   - A Blocked Step shows on the Task, and creates UNBLOCK if it is on you,
     but it does not change the Task's state.
   - Only Task-level reports, the finish rule, and humans set Blocked,
     In review, or Done.

   This replaces the current subtask roll-up for those states.
4. **Reviewer assignment UI (T-72).** Recommend hiding it from the task detail
   in this release. The reviewer's earlier verifications stay in history. A
   human check is performed by the signed-in human only.
5. **Migration banner.** Recommend the one-time `finished under the new merge
   rule` list (§10) for transparency instead of silent completion.
6. **Group order.** Move Done to the bottom (§4). This is optional and does not
   block approval.
