# Factory, simplified: implementation review (Opus)

Review · 2026-10-15 · Opus 5.5 (independent reviewer) · subject: the uncommitted working tree on `t3/factory-vs-multica` (base `66fc895`), compared against [`factory-simple.md`](factory-simple.md), [`previews/factory-simple.html`](previews/factory-simple.html) and my earlier [design review](factory-simple-opus-review.md)

## Verdict

**Not ready yet: two blockers and six medium issues.** Home is faithful to the reviewed mockup. It answers the three questions in order, shows every queue item once, and fails closed on stale T3. It is a third shorter than before at 1280 px and less than half the height on a phone. The task page is where the remaining problems are:

- it contradicts Home about whether a task needs you;
- its button hierarchy is inverted;
- three of its states read worse than the Home row that links to them.

The new `/tasks` route also 404s when the page is reloaded. Every issue below has a local fix with no model or API change; the 404 needs a one-line static-route change in `src/server.ts` (see B1). After the fixes, a fresh Opus pass should focus on the task page.

## Blockers

| # | Issue | Reproduction | Fix |
| --- | --- | --- | --- |
| B1 | **Reloading All tasks, or opening it in a new tab, shows a raw "Not Found".** `getStaticFile` serves the app shell for `/projects/*`, `/backups` and `/connections`, but not for the new `/tasks` (`src/server.ts:3704-3710`; route added in `src/web/navigation.ts`). | Load `http://127.0.0.1:3016/tasks` directly: the server returns 404. The secondary header's `<a href="/tasks">` (`main.tsx`) fails the same way when middle-clicked. | Add `/tasks` and `/tasks/` to `getStaticFile`, and add a server test. This changes a static route only, not the model, retention or freshness, so it fits "server unchanged" in spirit. If root disagrees, move All tasks to a path the server already serves. |
| B2 | **The task page says "Needs you" for a task that is blocked on an agent.** On Home, T-6 is under In progress with "Blocked on Codex: … Nothing needed from you." Its task page shows a red **Needs you** label and the headline "This task is blocked." Causes: `statusTone` is `blocked` for any `taskState === "blocked"` (`simple-task-detail.tsx:349-351`), the label maps `blocked` to "Needs you" (`:430-432`), and the headline ignores the owner (`:214`). | Open `/projects/45460405-…/tasks/5e5c3525-…` (T-6). | Show "Needs you" only when there is a request or `checkReady`. With no request, label the block "Blocked" and build the headline from `card.handoff`: "Blocked on {owner}: {action}. Nothing needed from you." for agent owners, otherwise "Blocked: {stateReason}". Add a test that Home and the task page agree for agent-owned and you-owned blockers (§6.3). |

## Medium

| # | Issue | Evidence | Fix |
| --- | --- | --- | --- |
| M1 | **Inverted button hierarchy on the task page.** "‹ Home" is the only filled lavender button on the page: `.simple-task-back` has no rule, so it inherits the global `button` style. The primary "Review on GitHub" link is outlined because it lacks the `primary` class. | Computed styles on T-7: Back has background `rgb(148,153,203)`; the action is transparent with a 1 px rule. Code: `simple-task-detail.tsx:382`, `:466-467`. Thread details and Check it do use `primary`. | Make Back a quiet text link (still at least 44 px). Add `primary` to the review link. Give external links an accessible "(opens in GitHub)" hint (§9). |
| M2 | **Three task-page states say less than their Home row, or something different.** (a) T-11 is under Done today on Home ("Marked done by Sample operator", green), but its page shows "Released / Released." in grey. `statusTone` only checks `taskCompleted` or `completed` (`:352`), and the headline falls through to `taskStateLabel` (`:225`). (b) T-1 shows "In progress / In progress.", while its Home row says "Claude is working in “…”. 1 of 2 steps done." (c) T-8 states the merge wait twice: once in the headline (`:209-210`) and again through `stateReason` (`:437`). Its label "Waiting for finish evidence" (`:151`) is jargon, and the GitHub draft state and observation time aren't shown (§6.2). | Pages for T-11, T-1 and T-8. | (a) When `finishMetadata` exists or the card is in `recentlyDone`, use the done tone and `card.finishProvenance`, with "Released" as context. (b) Share Home's `taskSentence` (`simple-floor.tsx:118`) through `home-model.ts` and use it for the fallback headline. (c) Drop `stateReason` when it repeats the headline, label the state "Waiting for a merge", and add the GitHub observation with its time from `githubStatuses`. |
| M3 | **Tracking notes are no longer reachable.** The footer says "2 tracking notes… See Connections", but Connections doesn't list them. Its only headings are Connections, Legacy T3 and Agent credentials. The old Floor opened the first note in the project's observed-findings panel (`HEAD:src/web/floor.tsx:1266-1277`). | Home footer → `/connections`. Code: `simple-floor.tsx:674-686`. | Point the link at `onOpenTarget(trackingNotes[0])` as before, and label it by what it opens ("Review tracking notes"). Alternatively, list the notes on Connections, as the spec's §7 and my earlier requirement 9 assumed. |
| M4 | **Focus is lost when moving between Home and a task.** Pressing Enter on a row opens the task with focus on `<body>`, and Back returns to `<body>` at the top of Home. The `h1` already has `tabIndex={-1}` (`simple-task-detail.tsx:391`), but nothing focuses it. | Keyboard check at 1280: `document.activeElement` was `BODY` after both navigations. | Focus `#simple-task-title` when `task.id` changes. On Home, move focus back to the row title of the task you came from (§9). |
| M5 | **Menus can't be closed from the keyboard.** The header Menu stays open after Esc and after an outside click, and ArrowDown scrolls the page even though the menu has `role="menu"`. More (`simple-task-detail.tsx:395-421`) also ignores Esc, and so does the Send-back form. | Header Menu at 1280 and 390, More on T-7, Send back on T-9 (display only). Code: `simple-app-header.tsx:22-73`. | Close on Esc and on outside pointer-down, returning focus to the trigger. Either add arrow-key movement or drop `role="menu"`/`menuitem` and use a plain disclosure, like More. Esc should also leave Send-back mode (§9). |
| M6 | **A review with several PRs sends you to Factory instead of GitHub.** When `availablePRs.length !== 1`, the primary action and the "Also" action both become "Task controls", which opens All tasks (`simple-task-detail.tsx:465-519`, `:554-571`). The PR links remain only in the collapsed Evidence. | Found in source only: the sample data has no task with several PRs. | Render one GitHub link per `requiredPullRequests[]` entry that hasn't merged. These URLs are status data, not parsed queue strings. Keep "Task controls" only for the zero-PR case. Add a fixture. |

## Polish

- **Double full stop.** Home shows "…report progress.. Nothing needed from you." because `nextAction` already ends in a full stop (`simple-floor.tsx:132`; the same pattern is at `:167`). Strip trailing punctuation before adding one.
- **Remove controls that repeat the row title.** Each Done row has a "Task details" button (`simple-floor.tsx:339-352`). Each blocked-on-you row with no thread also gets "Task details" (`home-model.ts:248-250`). Both duplicate the title button, and on a phone each adds a full-width 44 px bar. The spec gives only Needs-you rows an action, and blocked rows one only when a thread is linked. For review rows, the §10 fallback is right, but label the button "Review PR", not "Task details".
- **Evidence repeats itself.** The simple "Agent sessions" list (`simple-task-detail.tsx:826-860`) is followed by the full legacy panel, which shows the same sessions again. That panel has its own "EVIDENCE" caps eyebrow, three count tiles, mono state chips and "Current reports", which repeat Steps. Inside it, the "session …" toggles are 24 px tall (`task-tracking-panel.tsx:446`). Elsewhere in Evidence:
  - "How it finishes" reads "0 of 0 required merged" when there's no PR (`:791-793`);
  - agent names are raw lowercase `claude`/`codex` (`:832`);
  - PRs appear as raw URLs (`:809`).

  Keep one rendering of the sessions.
- **Middle-dot strings remain**, though §8 drops them: "Live · updated…" and "Offline · last snapshot…" (`simple-floor.tsx:483-489`; `main.tsx:2046`), and the report source line (`simple-task-detail.tsx:449`), whose "· Oct 15…" part wraps onto its own line at 1280. At 390 px the header freshness text wraps to two lines.
- **All tasks** shows default list bullets on touching buttons, because `.all-tasks-project-list` has no CSS (`main.tsx:2282`). It is a project picker, so either say so in its heading or style it as a list.
- **Header widths differ.** The task page header spans 1232 px, while Home's is held to the 52 rem column. Use the same width on both.
- **The task page header never shows "T3 not reporting"** (`main.tsx:2046-2060`); only Home does. Found in source only, because T3 stayed fresh throughout.
- **Disabled controls without a reason.** The disabled "Also needs you" buttons have no linked reason (`simple-task-detail.tsx:533-553`).
- **No skip link** (§9). There are only three tab stops before the content, so this is low priority.

## Design adaptations accepted

These differ from the mockup because data or scope required it. They aren't defects.

- **More has a single item**, "Open task controls in All tasks". I verified it lands on the project page with T-7 expanded, and that Mark done, the status options, Edit, Delete, finish-rule Edit, Replace PR and Add step are all present with today's handlers. Optionally, replace the one-item menu with a direct "Task controls" button.
- **§10 fallbacks:** "An agent is waiting for you in T3" (no input/approval field), "An agent finished" (no `reporter` on check items), and a task-page action for review rows (no `pullRequest` field).
- **The tracker link** moved from the heading line into Evidence.
- **Secondary screens keep the legacy style**: the project page, Connections and the old header (requirement 9).
- **The offline label** reads "Offline · last snapshot 09:30" instead of "Offline since…".
- **Filtering by project** hides the planned-work footer.

## What passed

| Check | Result |
| --- | --- |
| Home hierarchy against the mockup | The answer sentence is the only `h1` (22 px, 500); the filter, Needs you, In progress, Done today and footer follow in mock order. Marks have the right shapes and colours. |
| Every request renders | All 5 queue ids appear exactly once (`data-queue-ids`), including the approval on planned T-10. The agent-blocked T-6 is under In progress, and Done today comes from `recentlyDone`. |
| Subtraction | Home is 2,109 px tall at 1280 (3,203 at baseline) and 2,857 px at 390 (about 6,360). There are no tiles, clock, feed or bays. Grain and vignette are `display: none`. |
| Filter | Choosing Release Tools shows "5 things need you in other projects. Show all projects", and that link restores the full list. |
| Check (display only) | Renders inline: the quoted check, Luna's report, the optional note, Mark checked, Send back… and Cancel. Send back shows "What needs to change?". Nothing was submitted. |
| T3 boundary | Thread details opens Factory's metadata-only panel. No rendered `href` points at T3. |
| Phone at 390 | No horizontal overflow on Home or the check page. Every visible control is at least 44 px. Mark checked is in the first viewport. |
| Focus ring | 2 px accent with `:focus-visible`. |
| Focused tests | `bun test` over `home-model`, `home-freshness`, `simple-task-detail`, `simple-navigation` and `active-task-dashboard`: 21 pass, 0 fail, 87 assertions. |

**Not re-run here:**

- the offline, WebSocket-loss, stale-T3, loading and empty states (root validated them, and `home-freshness.test.tsx` covers them);
- actual mutations;
- forced colours and reduced motion.

## Evidence

- **Browser.** I used my own incognito T3 tab `tab_g_eb894a6f-…` on the disposable sample at `127.0.0.1:3016`, signed in with the preview-only secret. I visited Home at 1280 and 390, the project filter, the header Menu, and the task pages for T-7 (PR review, More), T-9 (check form display), T-6 (agent-blocked), T-1 (active, Evidence), T-11 (done), T-8 (draft PR), T-10 (Thread details) and T-18 (manual hold). I also visited `/tasks` by direct load and by client navigation, and `/connections`. I didn't touch the parent tab, and I closed my own tab afterwards.
- **Screenshots** are in `/Users/agent/.t3/userdata/browser-artifacts/`:
  - `…mv9kt3f2-6c7d4bec.png`: Home at 1280;
  - `…mv9kug3e-646a9afb.png`: T-7;
  - `…mv9kw36n-ddcb0525.png`: T-6 labelled Needs you;
  - `…mv9kwasb-a5f1d44a.png`: T-1;
  - `…mv9kwq53-088947b0.png`: Evidence;
  - `…mv9ky4ey-208086d9.png`: phone Menu;
  - `…mv9kyf9i-2ad5c303.png`: phone check;
  - `…mv9kywdw-fc75dba9.png`: the `/tasks` 404;
  - `…mv9kz9c1-6724917a.png`: All tasks.
- **Scope.** I wrote only this file. I made no app, test or metadata changes, no commit, push or deploy, and I submitted no form.
