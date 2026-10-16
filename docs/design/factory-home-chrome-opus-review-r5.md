# Factory Home chrome: verification review r5 (Opus)

Review · 2026-10-16 · Opus 5.5 (independent reviewer) · subject: the uncommitted working tree on `t3/factory-vs-multica` (base `66fc895`). Scope is limited to verifying the four findings in [`factory-home-chrome-opus-review.md`](factory-home-chrome-opus-review.md) (r4) and checking for regressions introduced by their fixes. Requirements: [`style-guide.md`](style-guide.md) Ledger v0.6.

The selected exact Opus 5.5 model ran this review; no other model was substituted.

## Verdict

**Ready** for human review. All four r4 findings are resolved, and I found no regression in the routes the fixes touch. This is a design-review verdict, not human acceptance.

## Resolutions

Measured with `getBoundingClientRect` and computed styles on the restarted sample (`http://127.0.0.1:3019/`).

| r4 finding | Status | Evidence |
| --- | --- | --- |
| **M1** freshness ran into "‹ Home" | Resolved | `.simple-task-content > .home-freshness` computes `display: flex` and fills its own row. T-9 (opened from Home) and T-7 (direct load) at 1280: freshness bottom 133.2, back top 145.2, a **12 px** gap. At 390: freshness bottom 271.2, back top 283.2, also 12 px. Rendered text order is "Live, HH:MM", then "‹ Home". |
| **M2** task page centred and unpaneled | Resolved | At 1280, `.simple-task-page` spans x=24, w=1232, y=101, the same box as the Home panel (`.simple-home`) and All tasks. Its background (rgb 27, 24, 21), 10 px radius, `--rule` border and 16 px inset match Home. The `.simple-task-content` reading column is left-aligned at x=41 and capped at 832 px (52 rem); the heading row and More button end at x=873 inside it. At 390, the page is at x=12, w=366, and content at x=25, matching Home's freshness x=25. |
| **m1** phone nav labels left-aligned | Resolved | `.app-header .global-nav-link` computes `justify-content: center`. At 390, each link is 118.7 px wide, and label padding is symmetric: Home 43.89/43.90, All tasks 24.6/24.6, Backups 32.31/32.32. The centre offset is ≤ 0.004 px on Home, All tasks and the task route. |
| **m2** All tasks intro touched the list | Resolved | `.all-tasks-project-list` margin is `12px 0 20px`. The gap between the heading block and the list is **12 px** at both 1280 and 390. |

## Regression checks

| Check | Result |
| --- | --- |
| One header, same geometry | One `header` on `/`, `/tasks`, `/backups` and the task routes. At 1280, header y=24, h=65; brand x=24; nav x=613–843. At 390, header h=221 and brand x=12. This is unchanged from r4. |
| Active destination | Home on `/`, All tasks on `/tasks` and task routes, Backups on `/backups` (`aria-current="page"`). |
| Home queue | Three groups, project filter, freshness inside the panel, footer links. 12 rows, each task once. Done today showed 0 rather than r4's 1 because the sample's clock crossed midnight ("Live, 00:00"); this is not a code change. |
| Task focus | Opening T-9 from Home and loading T-7 directly both focus `#simple-task-title`. |
| Missing-task state | An unknown task ID renders "Task not found" in the same panel: x=12, w=366, matching background, at 390. |
| Overflow | `scrollWidth == clientWidth` at 1280 and 390 on every route checked. No task-page descendant extends past the panel. |
| Targets | The back link, More button and primary navigation links remain 44 px tall. |

Note, not a finding: Home's inline-flex freshness line sits about 4 px lower in its panel than the task page's block-level one, at 17 px versus 13 px from the panel top. That difference is too small to matter.

## Method and limits

- I opened one incognito preview tab of my own and closed it afterwards. I did not read or operate any other tab.
- I signed in once with the provided preview-only sample secret. That session login was the only form submitted. I made no task, project, backup or Connections changes, no Factory metadata or CLI writes, and no application or test edits. I made no commits, PRs or deployments.
- I did not rerun build, typecheck, tests, Prettier or `git diff --check`; those results come from the coordinator's brief and were not re-verified.
- Not exercised: Backups and Connections at 1280 (both untouched by these fixes; Backups checked at 390); stale, offline and not-reporting freshness tones; the More menu's open state inside the new panel; forced colours; reduced motion; keyboard-only traversal.
- The only file I wrote is this review.
