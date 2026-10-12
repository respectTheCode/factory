## Verdict

The direction is sound and fits Factory's existing style. It's not ready to build yet, though: seven issues below need a decision first. The most important is that the cards have to be built from task records on the server. If they're assembled from today's per-project panels ("bays") on the client, tasks that are in review will disappear.

**What this review covers:** I read the source at `b57a014`: `src/floor.ts`, `src/web/floor.tsx`/`.css`, `task-workflow.tsx`, `task-tracking.ts`, `task-summary.ts`, the Floor wiring in `main.tsx`, the Floor-related types in `application.ts`, the style guide and the test names. I looked at the reference screenshot as a reference only. I didn't run the app or check anything visually. I made no edits.

## Blockers

**1. Build one card per task on the server, from task records.**
Today the panel's planned list holds only planned/backlog tasks (`floor.ts:1084-1090`), and the session rows take only active/blocked tasks (`floor.ts:1115-1117`). An in-review task shows up only when it has a "Needs you" item. That item is dropped when the GitHub reading is missing or older than 15 minutes (`:752-754`), or when a merged PR is still waiting to reach the default branch (`:779`). So in-review tasks can vanish from the Floor right now, and no Floor test covers that state. Add a `tasks: FloorTaskCard[]` field to each project in `buildFloorSnapshot`, built from `activeTasks` plus their status. Add it alongside the existing fields rather than replacing them.

**2. Write down the task/session rules.**

- The card key is `taskId`. Inside a card, sessions are de-duplicated by `sourceId:threadId`. The task pass already produces one entry per thread per task (`:1138-1161`).
- A thread linked to several tasks appears on each of those cards, with an "also on T-xx" note from `relatedTargets`. It's still counted once: "working" always comes from `scoreboard.workingNow`, never from adding up card contributors.
- Approval or question threads linked to _planned_ tasks come from a second pass (`:1164-1204`). They must attach to the planned task's card, or they're lost.
- Unmatched and ambiguous threads (`:1205-1232`) can't have a card. They need their own uncounted row, "Sessions without a task (N)", or the requirement to keep unmatched sessions visible breaks.
- "Needs you" items on threads that have no linked task stay in the sidebar only.

**3. Get each card's "needs you" by matching queue items, not by re-deriving it.**
Match `queue` items to cards by `target.taskId` on the server. The queue rules are subtle: handoff owner plus fresh-session suppression (`:821-823`), and the 15-minute GitHub freshness window. A client-side copy would drift. Keep three channels visually separate on the card:

- **work state:** a dial plus chip from `statusDefinitions`;
- **finish line:** the rule (PR merge or agent report), "+ your check" when required, and counts of required PRs merged from merge evidence;
- **contributors:** the server's sessions, already filtered for freshness.

**4. Count Steps by ID, not by position.**
`summarizeTaskProgress` (`task-summary.ts:165`) pairs `status.subtasks[index]` with each step. `status.subtasks` is sorted (`application.ts:3331-3333`), but the Floor's input steps are not (`application.ts:4276`), so reusing it would miscount. Compute `{done, total}` in `floor.ts` from `status.subtasks` alone, using the same rules as `task-workflow.tsx:149-158`: skip won't-do steps, and count complete or released as done.

- With zero Steps, show nothing at all, not "0/0".
- A finished task with open Steps shows "Done · N left open", with no progress dial.

**5. Decide which handoff the card shows, and present it as a claim.**
Handoffs are recorded in two places: `latestTaskReport.handoff` and each step's `status.subtasks[].handoff`. `buildTaskTrackingSummary` only collects the step ones.

- Proposed order: the task-level handoff first. Otherwise the newest handoff on a step that isn't complete or archived, plus "+N more".
- Render it as "Next: {owner} · {action}" with the reporter and age attached. Show nothing when no handoff is recorded.
- Never show `nextSubtaskName` as "Next step". That would be the made-up next action the proposal rules out.

**6. Pin down what the project filters affect.**

- Hiding a project removes it from the grid and from the top counts.
- "Needs you" stays global, which is the contract in the style guide, lines 257-258.
- A hidden project's chip shows a text badge like "1 needs you", so hiding a project can never hide a request.
- Keep the storage key `factory.floor.collapsed-bays.v1` so existing preferences carry over, and add "Show all" when anything is hidden.
- No status filters in v1.

**7. Update the style guide in the same PR.**
The proposal replaces §8's bays, its "no scrolling at 1080p" rule (§8.1) and its "only counters on the Floor" scoreboard (§8.5). If the doc isn't updated, it will contradict the code. Also, §5 reserves hazard stripes for destructive actions, so the reference's striped "Stuck" card must not be copied. Blocked uses a red border plus the blocked dial.

## Lower-priority design issues

- **Ordering:** sort only on recorded data: tasks needing you first (oldest item first), then blocked, in review, active, planned, then by priority and `sortOrder`. Never re-sort on whether a session is running. The 5-second refresh would make cards jump, and the guide forbids movement of position (§9).
- **Density:** the Factory project alone has about 8 planned tasks, and full cards for them would bury active work.
  - Group cards into per-project sections, each with an h2, an open-project link and the counts. This keeps project navigation and matches the chips one-to-one.
  - Show planned tasks as small dashed cards, about 4 per project, then "+N planned".
  - Keep backlog tasks off the grid.
- **Count definitions:** "Blocked" should mean tasks recorded as blocked only. Today's per-project count also adds session errors (`floor.ts:1238-1241`). Show working sessions labeled as sessions, and "—" when the data is stale (`floor.tsx:738`). Keep a single count row rather than both the top strip and the scoreboard.
- **Stale vs no session:** sessions from an unavailable source are silently dropped on the server, so a card would wrongly say "No session observed". Add a per-project flag that sessions are unavailable, and show "Session status unavailable" instead. Use the server's freshness only; the task detail page uses a different 5-minute window (`task-tracking.ts:126`).
- **Recently done:** use the exact rule behind the scoreboard's "done today" (`floor.ts:1301-1305`) so the two numbers match. Note that this rule also counts tasks archived after finishing; that needs a decision. Show who or what finished it via `finishProvenance`, in a section that starts closed.
- **Recent changes:** events are sentences, not "from → to" transitions, so don't draw "X → Stuck" arrows. Consider dropping "completed a turn" events, which may crowd out the rest.
- **Accessibility:**
  - Each card is an `<article>` with an `<h3>` containing one link or button, with an enlarged click area.
  - No nested controls in v1. Putting PR or thread links inside a `<button>` is invalid HTML.
  - No live-announcement region on the grid; use stable `taskId` keys so keyboard focus survives updates.
  - Planned-card text must be at least `--ink-dim`, since the faintest ink is never used for needed values.
  - 44px tap targets; titles clamped to 2 lines with the full title in the accessible name.
- **Phone:** order the page as Needs you → counts → chips (scrolling sideways) → cards in one column → sessions without a task → recent changes → create project. Reuse the existing `display: contents` reordering in `floor.css:912-930`.
- **Opening a card:** pass `{projectId, taskId}` only. If the card carries `action: "check"`, `main.tsx:1536` opens the check dialog.

## How to map the reference

| Reference                                                | Factory v1                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Milestone line, "You are here", "3 left for Public beta" | **Leave out.** There's no milestone model, and turning projects or states into a timeline would be the pipeline diagram §2.4 and §8.2 forbid. |
| "Updated 07:12 · 14 commits · 1 stuck"                   | Freshness time and stale marker plus recorded counts. Leave out commits.                                                                      |
| "In progress · 70%" with a bar, "2 files left"           | Status chip plus an optional "3/5" Steps dial. No percentages, no files (§8.6).                                                               |
| Striped "Stuck" card                                     | Red 45% border plus the blocked dial and the recorded reason. No stripes.                                                                     |
| "Waiting on your live API keys"                          | Only from a recorded handoff or blocked reason.                                                                                               |
| Lavender borders on selected cards                       | Lavender only for keyboard focus. An amber border with text for "needs you".                                                                  |
| "Needed for Public beta" footers                         | Leave out.                                                                                                                                    |
| "Next step" panel                                        | Leave out. Factory has no planner.                                                                                                            |
| "Needs your call … no reply by 10:00 → …"                | The existing "decide" item, showing only the thread's question. Leave out the timeout default.                                                |
| "Changed overnight"                                      | Recent changes using the existing event sentences, without arrows.                                                                            |

## Recommended first version

1. **Server (`floor.ts`).** Add these fields, keeping the existing ones:
   - per project: `tasks`, `unmatchedSessions`, `sessionsAvailable`, `recentlyDone`;
   - `FloorTaskCard` fields: target, state, priority, `stateReason`, `manualHold`, `steps?`, finish rule plus required/merged PR counts and whether a check is ready, `sessions[]`, `handoff?` and `needsYou {count, verbs, oldestAt}`.
2. **UI.** Header and one count row; the existing chips plus hidden-project badges; per-project card sections; the "Needs you" sidebar unchanged; Recent changes; a "Recently done" section starting closed; the sessions-without-a-task row; create project unchanged. Update style guide §8.
3. **Projection tests:**
   - an in-review task with no queue item still gets a card;
   - a thread linked to two tasks shows on both cards but counts once;
   - an approval thread linked to a planned task shows on that card;
   - an unmatched thread gets no card but is listed;
   - Step counts stay right when sort order differs from insertion order;
   - a task with zero Steps shows no count;
   - handoff selection follows the agreed order;
   - a stale source shows "unavailable", not "none";
   - "Recently done" matches "done today";
   - archived tasks are excluded.
4. **Web tests:** card targets carry no `action`, hidden-project badges appear, and accessible names are correct.

**Out of v1:** milestones, percentages and ETAs, made-up next steps, status filters, clickable events, checking a task from the Floor, transition arrows, commit counts, dispatch, and anything that changes production.

For the screenshot round, please include:

- 1080p with real data (9 or more cards);
- a 375px phone;
- greyscale, high-contrast and reduced-motion modes;
- whether focus survives a live update;
- the stale/unavailable state;
- long titles.

`★ Insight ─────────────────────────────────────`

- The current Floor shows the same queue three ways: the sidebar list, the per-project "Counter · Needs you" zone, and the counts. All three come from one server `queue`, while the projection's own `counter` and `reviewNeeded` lists are never filled. The cards should follow that one-source pattern rather than add a fourth way of deciding what needs you.
- The 60-second freshness check on the server is what keeps an old reading from showing a session as working. A card that re-checks freshness on the client would bring that bug back in a new place.
  `─────────────────────────────────────────────────`
