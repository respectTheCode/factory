# Factory, simplified: Opus review

Review · 2026-10-15 · Opus 5.5 (independent reviewer) · subject: [`factory-simple.md`](factory-simple.md) and [`previews/factory-simple.html`](previews/factory-simple.html) at `66fc895`

## Verdict

**Approve the direction. After the corrections below, the design is ready for implementation.** I applied the corrections to both design files.

The hierarchy answers the user's three questions in the right order, and the subtraction is real:

- one list instead of tiles, sidecar, feed and bays;
- one status block instead of four restatements;
- configuration behind More;
- evidence collapsed.

The draft broke four of the coordinator's constraints, each now fixed:

- it showed stale T3 questions;
- it linked to T3 URLs that don't exist;
- its grouping could hide requests;
- it removed existing deletion and status controls.

It also relied on data the Floor card doesn't carry. No issue needs a new server API.

## Issues found and fixed

| # | Issue | Evidence | Fix in both files |
| --- | --- | --- | --- |
| 1 | §6.4 reversed the fail-closed rule: stale T3 questions stayed listed as "may already be answered". | `src/floor.ts:1265` skips threads whose source isn't fresh. | Withheld while T3 is stale. Needs you says so and points to T3. T-94 falls back to In progress. |
| 2 | Invented T3 links: "Reply in T3 ↗", "Answer in T3 ↗", "Open … thread in T3 ↗", "Tell Claude in T3 ↗". | There is no T3 URL. Today Factory opens its own panel: `main.tsx:1536` `openFloorTarget` → `main.tsx:1202` `openT3ThreadDetail`. | One action, **Thread details**, with no ↗ and no "in T3" claim. It is disabled offline. The banner no longer says T3 links work. |
| 3 | The prototype quoted the agent's question text. | `T3ObservedThread` has only the `hasPendingUserInput` and `hasPendingApprovals` booleans (`t3-coordinator.ts:125`), and the panel is "Metadata only" (`observed-activity.tsx:685`). | Quote removed. Separate sentences for "waiting for your answer" and "waiting for your approval". |
| 4 | Requests could disappear. §6.1 checked "planned → not on Home" before "needs you", and grouping by task dropped thread items that have no task. | The sample instance's queue includes "Approval session attached to planned work". | Needs you now wins first. Rows are built from `snapshot.queue`, deduped by `id`. A request with no task gets its own row ("Rotate staging certificates"). |
| 5 | A task with several requests showed only one; the case wasn't mocked. | `needsYou.count` and `verbs` are already plural. | An "Also:" line on Home, and an "Also needs you" list on the task page with an action for each. Mocked on T-91. In stale mode its T3 approval is withheld. |
| 6 | "Done this week" needed wider server retention. | `recentlyDone` is today only (`floor.ts:1512`). | **Done today**, using the existing `recentlyDone`. Sample Done tasks moved to today. |
| 7 | Existing authority was removed: "Delete is not offered", Set status and Released dropped, and Won't do made to require a reason. | `tasks.remove` with "This cannot be undone" (`main.tsx:2732`); Delete step (`task-workflow.tsx:248`); dispositions without a reason (`main.tsx:3617`). | More keeps every existing action unchanged: Change how this finishes, Mark done or Reopen, Set status, Edit title and steps (with Skip and Delete step), and Delete task. Finishes stay append-only. |
| 8 | Home sentences relied on data the card lacks: "working: mapping v2 thread events", "was working at 14:14", "No agent has reported in 3 days", and a recency sort. | `FloorTaskCard` (`floor.ts:80`) has `steps {done,total}`, fresh sessions only, and no last-activity time. | §6.2 rewritten to card and queue fields only. In progress keeps the `compareTaskCards` order. Ages show only when the data has them. The task page may say more. |
| 9 | Summary links were 27 px on phone, against the spec's own 44 px rule. | Measured at 390 px. | The answer sentence is plain text; the groups follow in the same order. |
| 10 | The check row said "{Agent} … asked you to check it", but the task's finish rule asks, not the agent. | `requireHumanCheck` is on the finish rule. | "Claude finished. It's ready for your check." |
| 11 | The inline check covered only the offline case. | `tasks.check` requires a human session and `expectedRevision` (`server.ts:2213`); Send back is `tasks.reopen` (`main.tsx:2914`). | The spec requires the same mutations and guards, disabling when `canMutate` is false, and showing server errors in place. The offline reason is linked with `aria-describedby`. |
| 12 | Tracking notes vanished from Home. Today they are shown but not counted. | `floor.tsx` sidecar. | A footer count line that links to Connections. |
| 13 | Loading and empty states weren't mocked. | — | Added `?state=loading` (`aria-busy`, no stale rows) and `?state=empty` (one next step, All tasks). |
| 14 | Two names for Home: Back said "All work" while Menu says "All tasks". | — | Back says "Home". |

## Remaining implementation requirements

Each item has an observable check.

1. **Every request renders.** Write a pure grouping function over `snapshot.queue` and the cards. Test that every queue `id` appears on Home, with fixtures for:
   - a thread with no task;
   - a task with two requests;
   - a thread linked to two tasks;
   - an approval on a planned task;
   - a thread request on a completed task outside `recentlyDone`.
2. **Fail closed.** With a stale T3 source: no `input:` or `approve:` rows, the Needs-you note is shown, the header reads "since {lastSuccessfulFetchAt}", and no row says "working" or "was working".
3. **No T3 links.** No rendered `href` points at T3. Thread details goes through `openFloorTarget` and is `aria-disabled` with a reason when offline.
4. **Human check.** It calls the same `tasks.check` and `tasks.reopen` with `expectedRevision`. It is disabled with a described reason when offline or when `canMutate` is false. A revision conflict shows inline, and focus then moves to the status headline.
5. **More.** Each item calls today's handler with today's reason or confirmation, including Delete task, Delete step and Released/Won't do. No new mutation.
6. **No string parsing.** Home sentences use only the fields in §6.2. Never parse queue `id` or `reason` strings; use the §10 fallbacks until the optional read-only fields exist.
7. **Unchanged server.** `src/floor.ts` retention and freshness are untouched. In progress keeps the server order.
8. **Quality floor.** At 390 px: no horizontal overflow, and every interactive target in product UI is at least 44 px. Also check keyboard order, visible focus, reduced motion and forced colours.
9. **Secondary screens.** All tasks reuses today's project page: backlog and planned work, archived tasks, New project and project settings. Connections keeps unmatched sessions, tracking notes and "Choose Factory target". Neither is redesigned in this pass.

Judgment call, not a blocker: Esc-to-Home and ↑/↓ row movement are optional extras. Drop either if it conflicts with browser or assistive-technology shortcuts.

## Evidence

- **Prototype.** I served it from this worktree on `127.0.0.1:8791` and rendered it in my own preview tab at 1280 and 390 px, in the live, stale, offline, clear, loading and empty states. I also checked the T-91 task page with More open (it stays in the viewport, with 44 px items) and the T-62 check while offline (disabled, with a reason). The script passes `node --check`.
- **Baseline.** I opened `127.0.0.1:3016` in a separate incognito tab, signed in with the sample-only secret, and read only. The Floor is 3,203 px tall at 1280. It shows 5 queue items, including the approval on planned work, plus 2 uncounted tracking notes.
- **Scope.** I edited only `factory-simple.md`, `previews/factory-simple.html` and this file. I changed no app code, tests or Factory metadata, and made no commit or deployment.
