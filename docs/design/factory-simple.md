# Factory, simplified

Design spec · 2026-10-15 · Opus 5.5 (design lead) · status: **implemented locally after user authorization; revised after the Opus design review in [`factory-simple-opus-review.md`](factory-simple-opus-review.md); [Opus round 2](factory-simple-implementation-opus-review-r2.md) says ready for human review**

Current styling direction: the user requested matching Home to the rest of Factory after reviewing this implementation. The shared Factory header, visible primary navigation, session controls, Connections indicator and Ledger surfaces supersede the compact header/Menu and chrome-specific rules below. The three-group Home and task information hierarchy remain. See [style-guide.md](style-guide.md).

Prototype: [`previews/factory-simple.html`](previews/factory-simple.html). It is a click-through with labelled sample data. It makes no network requests and saves nothing; local actions reset on reload.

The user asked for a simpler Factory. This spec replaces the everyday presentation in [`style-guide.md`](style-guide.md) §5–§9 (Shopwear in the app, glowing dials, the Countersign, the Floor and its motion), the layout in [`active-task-dashboard.md`](active-task-dashboard.md), and the presentation sections (§4–§7) of [`simplified-workflow.md`](simplified-workflow.md). The finish-rule *model* from simplified-workflow.md stays. Only where it appears changes.

## 1. The job

Factory answers three questions, and nothing else on its main screens:

1. **What needs me?**
2. **What is being worked on?**
3. **What got done?**

Home asks them in that order, because only the first one asks you to act. Everything else has an owner outside Factory:

| Concern | Owner | Factory's part |
| --- | --- | --- |
| Running, steering and answering agents | T3 | Show the last observed state with its age, and open Factory's own observed-thread panel. There is no supported T3 link yet. |
| Code review, approval and merge | GitHub | Link to the PR. Record the merge as proof that the task is done. |
| Requirements and priority | Linear / Notion | Link to the record ("Requirements in Linear ↗"). |
| Deployment | The deploy pipeline | None. Factory never says "deployed". |
| Which tasks exist, who must act next, what finished and why | **Factory** | The two screens below. |

## 2. What is wrong today

I audited the shipped T-100 dashboard by navigating an already-running local sample instance (`scripts/preview-active-dashboard.ts`, port 3016) at 1280 and 390 px. I only read and navigated; nothing was written. The production instance requires sign-in and was not accessed.

- Home is about 3,200 px tall on desktop and 6,360 px on a phone. The phone shows about 230 px of chrome before the first task.
- Each Needs-you item appears twice: once in the sidecar and once on its card ("Needs you · 1 · Unblock"). Every card repeats "Finish rule: PR merge required" and "Observed sessions". The page also carries four count tiles, a live clock, project toggle chips, a recent-changes feed and an unmatched-sessions section.
- The detail for an In-review task states the review four times: in the finish-rule banner, the Now line, the Needs-you callout and the PR row. Finish-rule Edit, Replace PR and Add a step sit in the main flow.
- The project page adds four more tiles, a nine-part count sentence, and per-thread "Choose Factory target" selects.

## 3. Information architecture

There are two everyday screens and two menus:

```
/                      Home: the three answers, one list
/projects/:projectId/tasks/:taskId   Task: one status, its requests, history on demand
Menu  ▸ All tasks · Connections · Backups · Sign out                         (secondary)
More  ▸ Change how this finishes… · Mark done… / Reopen… · Set status… · Edit title and steps… · Delete task…   (secondary)
```

1. **Each task appears once.** On Home, a task sits in exactly one group. A request with no task gets its own row, so nothing that needs you is dropped.
2. **Each task has one status sentence**, written for a person, and that sentence is the status. There are no chips, codes or tiles beside it.
3. **Each request has one action**, and it sends you to whoever owns it: GitHub, Factory's own check, or Factory's observed-thread panel for T3. A Home row leads with its oldest request; the task page lists all of them.
4. **Evidence is collapsed, and configuration lives behind More.**
5. **Phone and desktop share one layout**: a single centred column of 52 rem, with no split panes and no grid of cards.

## 4. Home

```
FACTORY                                         ● Live · updated 14:20   [Menu]
─────────────────────────────────────────────────────────────────────────────
6 things need you. 5 tasks are in progress. 3 finished today.
Projects [All projects ▾]

Needs you  6                                      Oldest first.
⊖ Restore Factory GitHub integration in Dokploy               [Thread details]
  Blocked on you: the GitHub token for Dokploy expired.
  Factory  T-73  waiting 1d
● Configure Factory on the M5 mini                                   [Check it]
  Claude finished. It's ready for your check.
● Deploy production automatically from main                   [Review PR #18 ↗]
  Codex says PR #18 is ready. Review it on GitHub.
  Also: Codex is waiting for your approval in T3.
● Rotate staging certificates                                 [Thread details]
  Claude is waiting for your approval in T3. This thread isn't linked to a task.
  Factory  T3 thread, no task  waiting 40m
  …
In progress  5
◔ Support T3 orchestration v2   Codex is working in "Orchestration v2". 1 of 4 steps done.
⊖ Show T3 thread status …       Blocked on Codex: … Nothing needed from you.
◌ Import playlists …            No agent is working on it right now.
Done today  3
✓ Manage agent credentials …    PR #16 merged into main.            done 11:02
6 planned tasks haven't started. See all tasks
2 tracking notes about T3 threads aren't counted here. Review tracking notes
```

- **The answer sentence** is the `h1`, as plain text. The groups follow in the same order, so its clauses aren't links. Its Needs-you count is the number of Needs-you rows. Offline, it reads "As of 14:20, before Factory went offline: …".
- **The project filter** is one `<select>`, saved per device under a new key. It replaces the project chips and bay visibility, and the old hidden-bays preference is ignored. Filtering never hides your work silently: when other projects have work for you, a line says "2 things need you in other projects. Show all projects."
- **The groups and their order:**
  - **Needs you** is oldest first, by each row's oldest request.
  - **In progress** keeps the server's existing order (`compareTaskCards`: blocked, then in review, then active, then priority and manual order). The card has no last-activity time, so there is no recency sort.
  - **Done today** is newest first and is exactly the existing `recentlyDone` (finish recorded today, in Factory's timezone). Older work is in All tasks.
- **Each row** has a mark, a title link to the task, the status sentence, an optional "Also:" line when the task has more requests, and a meta line: project, ID, and an age that says what it measures. The age appears only when the data carries that time: `waiting 1d` (queue item), `seen 1m ago` (fresh session), `reported 2h ago` (handoff), or `done 11:02`.
  - Only Needs-you rows carry an action, as an outlined button. Filled buttons are reserved for the task page.
  - The whole row is one link. The action button sits above that link's hit area, so neither control is nested inside the other. A request with no task has a plain-text title, and its action is its only control.
- **The footer** shows a count of planned or backlog tasks with no activity, plus "See all tasks". Planned work belongs to the trackers and the All tasks screen, not Home. A second line counts tracking notes and opens the existing project findings panel; they stay uncounted, as today.
- **Not on Home:** count tiles, the clock, the activity feed, worker tokens, bays, unmatched sessions, the tracking notes themselves, and the New project form.

## 5. Task

```
‹ Home
Factory  T-91  Requirements in Linear ↗                                   [More]
Deploy production automatically from main
┌ ● Needs you ───────────────────────────────────────────────────────────────┐
│ Review PR #18 on GitHub.                                                    │
│ Codex finished and says PR #18 is ready. This task is done when PR #18      │
│ merges into main.                                                           │
│ GitHub, checked 2 minutes ago: checks passing on a91c4e2, no unresolved…    │
│ [Review PR #18 on GitHub ↗]                                                 │
│ Also needs you                                                              │
│ Codex is waiting for your approval in T3.  waiting 8m       Thread details  │
└─────────────────────────────────────────────────────────────────────────────┘
Steps  2 of 2 done              (read-only; omitted when a task has no Steps)
What happened                   (latest 3; Show all)
▸ Evidence  4 records           (collapsed)
```

- **The status block is the one prominent element:** a 28 px headline that states the status as a sentence.
  - It is followed by one or two plain sentences of context, and a source line saying who reported it, or what GitHub said and when.
  - Then come the oldest request's action and at most one secondary link.
  - Every other request follows under "Also needs you", each with its own action.
  - The border takes the state's colour at about 45% alpha. Nothing else on the page is coloured.
  - The status block may use the task's full status and history (current step name, latest report, GitHub observations). Home rows may not; see §6.2.
- **Thread details** is the only T3 action. It opens Factory's existing observed-thread panel: metadata only, with no transcript and no question text. It has no ↗ and never says "in T3", because Factory has no supported T3 link.
- **The human check** is the only in-Factory write in the everyday flow. It renders inline in the status block, with the same API and guards as today's `HumanCheckDialog`:
  - the check text quoted, the agent's report, and an optional "What you checked" field;
  - **Mark checked** (`tasks.check` with `expectedRevision`) and **Send back…** (`tasks.reopen` with the reason). Send back requires "What needs to change?"
  - Both are disabled, with the reason shown and linked by `aria-describedby`, when Factory is offline or the signed-in session can't record a check (`canMutate` false; the server requires a human session). A server rejection, such as a changed revision, shows in place and records nothing.
  - After sending back, the page says the agent sees the note "the next time it reads the task", that Factory doesn't message the agent, and names its T3 thread. Factory never claims to have messaged the agent.
- **Steps** are read-only progress. A step blocked on someone shows "Blocked: reason" in red. Steps left open when the task finished are dimmed and labelled "Left open", with the line "steps don't decide when a task is done". Editing steps moves to More → Edit, including today's Skip and Delete step.
- **What happened** is this task's append-only feed (the existing `TaskActivity`). It names the actor first and shows three rows by default.
- **Evidence** is a collapsed `<details>` element containing:
  - **How it finishes:** read-only, with a pointer to More;
  - **Pull requests:** GitHub facts with their source and time;
  - **Agent sessions:** T3 observations with their age, each with Thread details;
  - **Handoffs** and **Earlier reviews:** legacy verifications, kept verbatim;
  - **Requirements:** the tracker link;
  - an intro note: "Factory records it; it doesn't judge the work."
- **More** opens secondary screens. Each keeps today's API, reasons and confirmations:
  - Change how this finishes…;
  - Mark done… or Reopen…, each with a required reason;
  - Set status…, today's menu: Backlog, Planned, Active, Blocked (with a reason), Released and Won't do;
  - Edit title and steps…;
  - Delete task…, with today's confirmation that it can't be undone.

  Finishes and reopens stay append-only. This design moves these controls; it doesn't change what they do.

## 6. State mapping

### 6.1 Group, first match wins

| # | Existing data (`snapshot.queue`, `FloorTaskCard`) | Group |
| --- | --- | --- |
| 1 | A queue item targets the task directly, through a step, or through `relatedTargets` (`queueTargetsTask`) | **Needs you** |
| 2 | A queue item matches no task card on Home: a T3 thread with no linked task, or a task that isn't otherwise shown | **Needs you**, as its own row (linking to the task page when there is a task) |
| 3 | In `recentlyDone` | **Done today** |
| 4 | Backlog or planned, with no session and no handoff | Not on Home (footer count; All tasks) |
| 5 | Any other task card: active, blocked, in review, or planned with a session | **In progress** |

Needs you wins over every other rule, so grouping can never hide a request. This case is real: the sample instance already has a T3 approval on a planned task.

Build Needs you from `snapshot.queue`, not from `needsYou.count`:

- Group items by task and dedupe by item `id`.
- A row's sentence and action come from its oldest item. The others appear as "Also:" on Home and under "Also needs you" on the task page, each with its own action.
- A thread item linked to several tasks appears on each of those rows, as the cards count it today.
- Tracking notes stay out of the queue and the count, as today.

### 6.2 Status sentences and actions

The mark's colour carries one meaning only: amber means it's your turn, blue means an agent is observed working, red means blocked, and green means done. The mark's shape and the sentence carry the same information, so colour is never the only signal.

Home rows use only the queue item and `FloorTaskCard` fields named here. The card has no current-step name, latest-report text or last-activity time, and it drops stale sessions. The task page's status block may say more from the task's full status.

| Situation | Source data | Mark · label | Home row sentence | Action |
| --- | --- | --- | --- | --- |
| Blocked on you | queue `unblock` (`summary` is the reason); current owner rule | red ring+bar · Blocked on you | Blocked on you: {summary}. | Thread details, if a session is linked |
| Check due | queue `check` | amber disc · Needs you | {Agent} finished. It's ready for your check. | **Check it** (in Factory) |
| PR ready | queue `review` | amber disc · Needs you | {Agent} says PR #n is ready. Review it on GitHub. | Review PR #n ↗ (needs the PR URL; see §10) |
| Agent waiting for an answer | queue `decide`, thread target, `input:` item | amber disc · Needs you | {Agent} is waiting for your answer in T3. | Thread details |
| Agent waiting for approval | queue `decide`, thread target, `approve:` item | amber disc · Needs you | {Agent} is waiting for your approval in T3. | Thread details |
| Request with no task | thread item with no `target` | amber disc · Needs you | As above, plus "This thread isn't linked to a task." | Thread details |
| Tracking broken | queue `decide`, work target: PR closed unmerged, not found or no access, no PR after finish, GitHub not connected | amber disc · Needs you | Factory can't tell when this is done: {reason}. | Choose what finishes it (secondary) / Open Connections |
| Agent working | a card session with state `working` | blue ring+wedge · In progress | {Agent} is working in "{threadTitle}". {done} of {total} steps done. | — (Thread details on the task page) |
| T3 not reporting | `sessionsAvailable` false and no fresh session | dashed ring · In progress, not confirmed | T3 isn't reporting, so Factory can't see this task's agent. | — |
| Blocked on an agent or someone else | `state: blocked`; handoff `agent` or a named owner | red ring+bar · Blocked on {owner} | Blocked on {owner}: {stateReason}. Nothing needed from you. | — |
| Waiting for a merge | `agentReportedFinished`, `mergedPrCount < requiredPrCount`, no queue item | dashed ring · Waiting for a merge | {Agent} reported it finished. Waiting for its required PR to merge. | — (draft, base branch or GitHub-unknown detail on the task page, with source and time) |
| No agent working | sessions empty or idle; `sessionsAvailable` true | dashed ring · No agent working | No agent is working on it right now. | — |
| Done today | `recentlyDone`, `finishProvenance` | green disc · Done | PR #n merged into main. / {Agent} finished it. / You checked it. / You marked it done: {reason}. / Finished under the earlier review process. | View merge commit ↗ (task page, merge only) |

{Agent} comes from `worker.identity` or the reporter ("Claude", "Codex"). When neither is known, write "An agent".

Wording rules:

- Use "You" when the actor is the signed-in human, and a name otherwise.
- Never write `approved`, `verified`, `shipped`, `deployed`, `healthy`, `passing` or `working now` on Factory's own authority.
- When repeating a fact from GitHub or T3, name the source and the time.

### 6.3 Blocked on the agent vs blocked on you

This is the existing `nextOwnerKind` rule, made visible. **On you** goes in Needs you with a red mark and an action. **On an agent or a named person** goes in In progress with a red mark, the owner's name, and "Nothing needed from you". An unowned blocker with no fresh agent session counts as on you, as it does today.

### 6.4 Freshness: three sources, each honest on its own

- **Factory connection.** When the connection is lost:
  - the header shows "Offline since 14:20";
  - a banner explains that you're seeing what was true at 14:20, that checks and thread details are paused, and that links to GitHub still work;
  - the answer sentence is prefixed "As of 14:20";
  - Mark checked, Send back and Thread details are disabled (`aria-disabled`) with a reason, and GitHub and tracker links stay live.
- **T3 observations** are fresh within the existing 60 s window.
  - When T3 is stale, the header shows "T3 not reporting since 14:14", from the connection's `lastSuccessfulFetchAt`.
  - **T3 questions and approvals stay withheld while T3 is stale.** This is today's fail-closed rule: `buildFloorSnapshot` skips threads whose source isn't fresh. Needs you instead says "T3 hasn't reported since 14:14, so questions and approvals from agents aren't shown here. Check T3 directly."
  - Rows for tasks with no fresh session say "T3 isn't reporting, so Factory can't see this task's agent." Factory never says "is working" or "was working at", because the card drops stale sessions.
- **GitHub observations.** An observed merge with a merge SHA is final. Any other state, when stale or unavailable, is shown as last known, with its time. Factory never infers that a PR is ready or merged.

## 7. Removed, secondary, elsewhere

| Surface today | New place |
| --- | --- |
| Bays, Bench/Stations/Counter, worker tokens, overhead badges, working arc, approval blink | **Removed** |
| Count tiles, scoreboard, live clock | **Removed**; the answer sentence replaces them |
| Global Shift Log / Recent changes | **Removed** from Home; per-task "What happened" replaces it |
| Duplicate Needs-you renderings (sidecar, card count, Now line, callout, papers) | **One** row on Home and **one** status block on the task |
| Countersign slot and stamp animation | **Removed**; the check is a plain button |
| Grain, vignette, hatch, hazard, LED glow, caps eyebrows, mono state chips | **Removed** from the app UI (favicon chip may stay) |
| Finish-rule chip, Edit, Replace PR in the task flow | **Secondary**: More → Change how this finishes; also reached from a "tracking broken" item |
| Inline step state control, reorder, Add a step, Skip and Delete step | **Secondary**: More → Edit title and steps (today's confirmations) |
| Mark done, Reopen, status changes, Released, Won't do | **Secondary**: More (today's reasons and semantics) |
| Report form, sessions, handoffs, PR packet, screenshots, earlier reviews | **Evidence** (collapsed) |
| Project chips and visibility toggles | One project filter |
| Planned/backlog lists, archived tasks, project settings, New project | **Secondary**: Menu → All tasks |
| Unmatched/ambiguous sessions, "Choose Factory target" | **Secondary**: Connections (observations, not tasks) |
| Tracking notes | **Secondary**: Connections, with a count line in Home's footer |
| T3 approval or input requests on threads with no task | **Kept** in Needs you as their own rows |
| Start, steer, stop or answer an agent | **Elsewhere**: T3. Factory shows the observed thread; it has no T3 link yet |
| Approve or merge code | **Elsewhere**: GitHub. Factory never adds a second approval to a merge-rule task |
| Requirements and priority | **Elsewhere**: Linear/Notion via the tracker link |
| Delete task | **Secondary**: More → Delete task… (today's confirmation) |

## 8. Visual language

- **Keep:** the Ledger neutrals (`#141210` canvas, `#1B1815` panel, `#342E26` rule, `#EAE6DF` ink, `#A2988A` dim), the four signal hexes with one meaning each, the lavender accent `#9499CB` for links, primary buttons and focus, IBM Plex Sans for words, and IBM Plex Mono only for task IDs, times and SHAs. Keep the flat Countersigned-F mark and the `FACTORY` wordmark. This is not a brand reskin.
- **Drop:** the "clean records, dirty room" environment, glow, textured surfaces, dials-as-gauges, the circles-versus-squares grammar, caps eyebrows, mono chips, middle-dot meta strings, and cards.
- **Type scale (desktop / phone):**

  | Role | Size and weight |
  | --- | --- |
  | Status headline | 28 / 23 px, 600, balanced wrap |
  | Answer sentence | 22 / 19 px, 500 |
  | Task title | 22 px, 600 |
  | Row title | 15 px, 500 |
  | Body | 15 px / 1.55 |
  | Meta | 12–13 px |

- **Marks** are 16 px inline SVGs. The shapes reuse the existing dial vocabulary without glow:

  | Mark | Shape |
  | --- | --- |
  | Needs you | Solid amber disc |
  | Working | Blue ring with a quarter wedge |
  | Not confirmed | Dashed ring |
  | Blocked | Red ring with a bar |
  | Done | Green disc with a check |

  Step marks use the same shapes, but a finished step is grey, never green.
- **Motion:** a 140 ms fade when the route changes, and a disclosure caret. No ambient motion. `prefers-reduced-motion` removes both.

## 9. Keyboard and accessibility

- Skip link. One `h1` per screen. Every group is a labelled `<section>` holding an `<ol>`.
- On Home, ↑, ↓, Home and End move between task links. Enter opens a task.
- On a task page, focus starts on its title, and Esc returns to Home with focus on that task's row. Esc also closes menus and the Send-back form.
- Row actions get the visible label plus the task title as their accessible name ("Review PR #18, Deploy production… (opens outside Factory)"; "Thread details, Restore Factory GitHub integration…"). Only GitHub and tracker links say "opens outside Factory".
- After Mark checked or Send back, focus moves to the new status headline, and a polite live region confirms.
- Interactive targets are at least 44 px, with no exceptions in product UI; the answer sentence has no links. The prototype's own control bar uses 32 px and is not product UI.
- Loading sets `aria-busy` on the answer sentence and shows no rows until the first snapshot arrives.
- Visible 2 px accent focus ring. Forced-colours fallback. Colour is never the only signal.

## 10. Implementation boundaries

**This is a presentation change on the existing model.** It needs no new write APIs, no migration and no data deletion. The finish-rule model, reports, the CLI, history and the human-check API all stay. Agents' instructions don't change.

**Suggested order:**

1. **Status presentation.** Write two pure functions in `src/web/`:
   - one that groups `snapshot.queue` and the task cards into Home rows (§6.1);
   - one that maps a task card, its queue items, source freshness and the viewer to `{ group, mark, label, row, also, headline, context, source, action, link }`.

   Unit-test every row of §6.2, and test that every queue item `id` renders.
2. **Home.** Replace the body of `Floor` in `src/web/floor.tsx`, and most of `floor.css`, with the answer sentence, the filter and three lists. Keep the `projects.floorUpdates` subscription and the stale/offline inputs.
3. **Task route.** Add `/tasks/:ref` to `src/web/navigation.ts`. Compose the page from existing pieces:
   - `TaskActivity` for What happened;
   - `StepDial` in a read-only list;
   - the `HumanCheckDialog` logic rendered inline, with the same mutations, `expectedRevision` and error handling;
   - `finishProvenance` and `TaskProvenance`, with copy aligned to §6.2;
   - `TaskTracking` inside Evidence.
   `FinishRulePanel`, step editing, the status menu and Delete task move behind More unchanged.
4. **Secondary screens.** The existing project page becomes All tasks, and the existing Connections page absorbs observations and tracking notes. Restyle both only enough to match. Thread details keeps today's route into the observed-thread panel.
5. **Style guide.** Write a v0.5 addendum that records §8 and retires §5–§9.

**Data.** No server change is required:

- **Done today** is the existing `recentlyDone`. Don't widen retention for this design.
- **T3:** there is no supported T3 deep link. "Thread details" uses today's `openFloorTarget({ projectId, threadId, sourceId })` path into the observed-thread panel (`openT3ThreadDetail`). Replace it with a T3 URL only after T3 documents one.
- **Stale T3:** questions and approvals stay withheld (§6.4). No server change.
- **Planned-not-started count:** derive it from `bench`.

**Optional read-only projection fields.** Each one only saves the client from parsing strings. Never parse queue `id` or `reason` strings in the UI; until a field exists, use the fallback.

| Field | Fallback until it exists |
| --- | --- |
| `pullRequest { number, url }` on `review` items | The row action opens the task page, which already has the PR link. |
| `request: "input" \| "approval"` on thread items | Today only the `input:`/`approve:` id prefix distinguishes them; write "is waiting for you in T3". |
| `reporter` on `check` items | "An agent finished." |
| `finishKind` on done cards | Show `finishProvenance` as written. |

**Tests likely touched:** `tests/web/active-task-dashboard.test.tsx`, `floor.test.ts`, `navigation.test.ts`, `simplified-workflow.test.tsx` and `ledger-styles.test.ts`, plus a grouping test where every `snapshot.queue` id appears on Home, including a request with no task and a task with two requests.

**Out of scope:** starting or steering agents, GitHub approvals, tracker sync, deployment status, production deploys, and any change to Factory metadata.

## 11. Prototype

Serve it from the repository root so the bundled Plex fonts load, for example `python3 -m http.server` and then `/docs/design/previews/factory-simple.html`. Opened directly as a file, it falls back to system fonts.

- Routes: `#/`, `#/task/T-91`, `#/task/T-62/check`.
- Data states: `?state=live` (default), `stale` (T3 not reporting), `offline`, `clear` ("Nothing needs you"), `loading` and `empty` ("No tasks yet"). The prototype bar switches between them.
- Each sample task demonstrates one case:

  | Task | Case |
  | --- | --- |
  | T-73 | Blocked on you, with Thread details |
  | T-62 | Your check, with Mark checked and Send back |
  | T-115 | Tracking broken |
  | T-91 | PR review, plus a second request (an approval in T3) |
  | "Rotate staging certificates" | A T3 request with no task |
  | T-94 | Agent waiting for an answer in T3; withheld while T3 is stale |
  | T-71, T-38 | Working |
  | T-20 | Blocked on Codex |
  | T-112 | Waiting for a merge; the task page shows GitHub unknown |
  | T-131 | No agent working |
  | T-88 | Done today by merge, with a step left open and an earlier review |
  | T-126 | Done today by the agent |
  | T-43 | Done today by hand |

- External links, Menu, More, Thread details and secondary actions only show a toast. Check and Send back change this page alone and say so.

**Not shown in the prototype:**

- the secondary screens (All tasks is today's project page, and Connections is today's page, restyled);
- a viewer who can't record checks; it renders like the offline check, with its own reason.

Data names, IDs, PRs and SHAs are illustrative.
