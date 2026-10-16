# Factory Home chrome: independent review (Opus)

Review · 2026-10-15 · Opus 5.5 (independent reviewer) · subject: the uncommitted working tree on `t3/factory-vs-multica` (base `66fc895`). It covers the shared-chrome follow-up described in [`style-guide.md`](style-guide.md) v0.6 and [`factory-simple-validation.md`](factory-simple-validation.md) § Shared Factory chrome follow-up.

The selected exact Opus 5.5 model ran this review; no other model was substituted. The API rate limits that stopped rounds 1 and 3 did not recur.

## Verdict

**Not ready.** Home itself now matches the rest of Factory. One shared header renders on every signed-in route. Home, All tasks, Backups and Connections share identical brand, navigation, session and Connections geometry. Home's Ledger panel starts at the shell edge, and its three groups, deduplication, project filter and freshness line are intact.

Three regressions remain, and each is a few lines of CSS:

- **M1.** On every task page, the freshness line runs into "‹ Home".
- **M2.** Task detail is now the only route outside the shell inset and Ledger panel.
- **m1.** At phone width, the primary navigation labels are no longer centred, on every route.

Because the user asked for styling that matches the rest of Factory, these are within the review's purpose rather than cosmetic leftovers. None of them misstates a task's state, hides a request or breaks a flow.

## What passes

Checked in a rendered browser on the restarted sample (`http://127.0.0.1:3019/`) at 1280×800 and 390×844, plus source review of `src/web/app-header.tsx`, `src/web/main.tsx`, `src/web/styles.css`, `src/web/floor.css` and `src/web/simple-task-detail.css`.

| Check | Result |
| --- | --- |
| One header | Exactly one `header` on `/`, `/tasks`, `/backups`, `/connections` and both task routes (T-7 by direct load, T-9 from a Home row). |
| Identical chrome | At 1280, every route renders the same header geometry: header y=24 h=65, brand x=24, nav x=613–843, session and Connections from x=867. At 390, every route has brand x=12 and header h=221. |
| Full brand | Countersigned-F mark (48 px), `FACTORY` wordmark and "Project operations" eyebrow on every route; no Menu or compact header remains. |
| Active destination | `aria-current="page"` plus the selected lavender fill: Home on `/`, All tasks on `/tasks` and on both task pages, Backups on `/backups`. |
| Targets | Primary links, Sign out and the Connections indicator are all 44 px tall at both widths. |
| Links | Real hrefs (`/`, `/tasks`, `/backups`, `/connections`). Plain left clicks route in place; the handler returns early for modifier keys, non-primary buttons and `defaultPrevented`, so new-tab behaviour is native (source review; I did not open extra tabs). |
| Session | "Signed in as …" and Sign out render on every route. The token-handoff hint and disabled-state guard are wired as before (source review; no handoff was in progress). |
| Connections | The indicator reads "T3 1/1 · WS" on every route. On Home and task routes it reports the floor snapshot, as before, and it opens `/connections`. |
| Home panel | At 1280, the Home panel spans x=24, w=1232, matching All tasks (x=24, w=1232) and Backups. At 390, Home, All tasks and Backups all start at x=12. |
| Home content | Needs you 5, In progress 7, Done today 1; 13 rows, each task once; footer counts and "See all tasks" present. Freshness "Live, HH:MM" sits inside the panel. |
| Task focus | Opening T-9 from Home focuses `#simple-task-title`. Direct load of T-7 also focuses the title. |
| Overflow | `scrollWidth == clientWidth` on every route at both widths. |
| Skip link | "Skip to main content" targets `#main-content` (`tabIndex=-1`) and is 44 px tall. |

## Findings

| # | Severity | Finding | Evidence | Suggested fix |
| --- | --- | --- | --- | --- |
| M1 | Medium | **On task pages, the freshness line runs into "‹ Home".** Moving freshness into content placed two inline-flex elements side by side with no gap, so the first line reads "Live, 23:52‹ Home". The text baselines also differ: the status line sits at y=136 inside the button's 121–165 box. | T-7 (direct) and T-9 (from Home) at 1280: freshness x=272–365, back button starts at x=365, gap **0 px**. At 390: gap **0 px** again. `.home-freshness` is `display: inline-flex` (`floor.css:28`); `.simple-task-back` is `inline-flex` (`simple-task-detail.css:11`); both render as siblings in a block `section` (`simple-task-detail.tsx:536–544`). | Give the task page's freshness line its own row (for example, `.simple-task-page > .home-freshness { display: flex; }`), or put both in one flex row with a gap. Keep the status before or after the back link consistently with Home. |
| M2 | Medium | **Task detail no longer shares shell alignment or the Ledger panel.** Every other signed-in route now starts its panel at the shell edge under the full-width header. The task page is still a centred, unpaneled 52 rem column. Going Home → task, content jumps from a full-width panel at x=24 to bare canvas starting at x=272. This contradicts v0.6 ("panel surfaces, controls, and shell alignment"). It also reopens round 2 minor finding #6, which was fixed by aligning the old compact header to this column. | At 1280: brand x=24; Home, All tasks and Backups panels at x=24; task section x=224 (content x=272), transparent background, no border. Source: `.simple-task-page { margin: 0 auto; max-width: 52rem; padding: 32px 48px 56px }` (`simple-task-detail.css:1–9`). At 390 the difference is small (section x=12 vs panel x=12, no surface). | The minimal option is to render the task page inside the same panel and shell inset as Home and All tasks, keeping a 52 rem reading measure inside that panel. If the centred column is intentional, record it as an explicit exception in style-guide v0.6 so the guide and the product agree. |
| m1 | Minor | **At phone width, primary navigation labels are left-aligned inside their equal-width cells, on every route.** The new `.app-header .global-nav-link { display: inline-flex }` turns the label into an anonymous flex item. The older 540 px rule's `text-align: center` no longer centres it. In the base, `/tasks` and `/backups` centred these labels. | At 390, each link is 119 px wide. Label padding is left 11 px, right 77/38/54 px (Home / All tasks / Backups). Computed `justify-content: normal`. The selected Home and All tasks pills show the label pinned left with empty space to the right. `styles.css:2826–2831`, `styles.css:2593–2596`. | Add `justify-content: center` to `.app-header .global-nav-link`. |
| m2 | Minor | **On All tasks, the intro sentence touches the project list.** | At 390 and 1280, "Choose a project…" ends exactly where the list begins (gap **0 px**; `.project-summary` margin-bottom 0). The new list rule sets only a bottom margin. | Add a top margin to `.all-tasks-project-list`, such as 12 px. Not chrome; optional. |

## Observations (not findings)

- **`/connections` shows no active destination.** None of the three primary links is current, and the Connections indicator has no selected state or `aria-current`. This predates the change; the base had the same behaviour. Strictly, it is an exception to v0.6's "the active destination is visible". Consider `aria-current="page"` and the selected outline on the indicator in a later pass.
- **The header is tall at phone width.** At 390 it is 221 px, about 26% of the viewport: four rows for brand, nav, session and Connections. The Connections indicator wraps onto its own row because session (269 px) plus indicator (112 px) exceed the 366 px row. This matches the existing chrome on the other routes, which is what the user asked for, so I am not asking for a change.
- **"‹ Home" on a page where All tasks is current.** The back link returns to Home while the nav highlights All tasks. This follows the stated decision that task routes select All tasks, and the back link restores focus to the Home row, so I am not flagging it.
- **One rendering artefact.** The outlined Backups link in one 1280 screenshot was `:hover`, because the pointer had stayed there after a click. The computed style confirmed it; it is not a selected state.

## Method and limits

- I used one private browser tab of my own and closed it afterwards. I did not read or operate any other tab.
- I signed in once with the provided preview-only sample secret. That session login was the only form submitted. I made no task, project, backup or Connections changes, no Factory metadata or CLI writes, and no application or test edits. I made no commits, PRs or deployments.
- I did not rerun tests, typecheck or build; the coordinator's results are reported in the brief, not re-verified here.
- Not exercised in the browser:
  - modifier-click and middle-click (source only);
  - the stale, offline and T3-not-reporting freshness tones;
  - an in-progress token handoff;
  - the sign-in screen's chrome;
  - forced colours, reduced motion, and keyboard-only traversal of the header.
- Positions are CSS pixels from `getBoundingClientRect` on the running sample. Times shown in the evidence ("23:52" and so on) come from the sample's live clock.
- The only file I wrote is this review.
