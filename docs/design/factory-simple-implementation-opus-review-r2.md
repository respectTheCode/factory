# Factory, simplified: implementation review, round 2 (Opus)

Review · 2026-10-15 · Opus 5.5 (independent reviewer) · subject: the corrected uncommitted working tree on `t3/factory-vs-multica` (base `66fc895`), compared against [`factory-simple.md`](factory-simple.md), my [design review](factory-simple-opus-review.md) and my [first implementation review](factory-simple-implementation-opus-review.md)

## Verdict

**Ready for human review.** Both blockers and all six medium issues from round 1 are fixed, and I confirmed each one in the rendered app. The task page now agrees with Home in every state the sample covers:

- blocked on an agent;
- blocked on you;
- PR review;
- your check;
- a T3 request;
- active;
- draft PR waiting for a merge;
- done and released.

Its button hierarchy is correct, and focus and dismissal behave as §9 asks.

Six minor issues remain. None of them misstates a task's state, hides a request or breaks a flow. Two are worth fixing before merge, because each is a few lines of presentation code:

- the ".," in the report source line;
- the PR link labels.

Scope held:

- the only server change is the two-line `/tasks` static-route fallback;
- the model, retention, authority and freshness are unchanged;
- existing controls sit behind More and All tasks.

## Round 1 findings

| # | Round 1 issue | Status | Evidence |
| --- | --- | --- | --- |
| B1 | `/tasks` 404 on reload | **Fixed** | `getStaticFile` serves `/tasks` and `/tasks/` (`src/server.ts:3706-3707`). `curl` returns 200, and a direct browser load renders All tasks. A new server test (`tests/transport/factory-backups-route.test.ts`) checks both paths return the app shell. |
| B2 | Agent-owned blocker labelled Needs you | **Fixed** | T-6 shows the label "Blocked", a red border, and the same sentence as its Home row: "Blocked on Codex: Resolve the sample dependency and report progress. Nothing needed from you." The stated reason follows as context. T-5 (blocked on you) stays red with "Blocked on you: …" and one action. |
| M1 | Inverted primary hierarchy | **Fixed** | "‹ Home" is a transparent, underlined lavender text link, 44 px tall. On T-7 the only filled control is "Review on GitHub" (`rgb(148,153,203)`); More is outlined. On T-9 the only filled control is Mark checked; on T-10 it is Thread details. |
| M2 | Parity for done/released, active and draft PR | **Fixed** | (a) T-11 has a green border and "Marked done by Sample operator", matching Home, with "Released" as its label. (b) The T-1 headline is Home's sentence: "Claude is working in “…”. 1 of 2 steps done." (c) T-8 reads "Waiting for a merge / Waiting for the required pull requests to merge." with no repeated reason, plus "GitHub pull request is a draft, observed Oct 15, 2026, 10:07 AM." |
| M3 | Tracking notes link went to the wrong place | **Fixed** | "Review tracking notes" opens the project page with the Possible drift panel in view (top at 259 px of a 900 px viewport). That panel holds 2 attention findings, matching Home's count, plus 1 info finding. |
| M4 | Focus lost when navigating | **Fixed** | Pressing Enter on a Home row puts focus on `#simple-task-title`. "‹ Home" puts focus back on that task's row title, scrolled into view with the 2 px accent ring. The browser's history Back does the same (checked on T-8). |
| M5 | Esc and outside-click dismissal | **Fixed** | Esc closes Menu and More, returns focus to the trigger, and doesn't navigate. A real outside click closes Menu, and an outside `pointerdown` closes More. `role="menu"` was removed, so both are plain disclosures. In Send-back mode, Esc returns to the check form with focus on "Send back…". |
| M6 | Several PRs routed to Factory | **Fixed in source and tests** | One GitHub link renders per unmerged required PR. "Task controls" remains only when there is no PR (`simple-task-detail.tsx:604-636`, `:753-770`). The test at `tests/web/simple-task-detail.test.tsx:210-265` covers merged and optional PRs being excluded. The sample has no task with several PRs, so this case wasn't seen in the browser. See finding 2 for the labels. |

**Round 1 polish:**
- **Fixed:**
  - Home's double full stop;
  - the duplicate Done and blocked-row buttons, with review rows now labelled "Review PR";
  - Evidence repeating itself: the legacy panel is gone, sessions appear once with readable agent names, and "No required pull requests are recorded" replaces "0 of 0";
  - middle dots in the header, which fits on one line at 390 px;
  - the All tasks project picker: no bullets, 8 px gap, 44 px buttons;
  - the header width, now 784 px on both screens;
  - missing disabled reasons in Also needs you;
  - the missing skip link: present, and it moves focus to the page heading.
- **Seen in source only:** the task-page header's "T3 not reporting" label (`main.tsx` `taskFreshnessLabel`), because T3 stayed fresh.

The accepted adaptations still stand:
- More has a single item;
- T3 state wording is generic;
- review rows fall back to the task page;
- tracker links are in Evidence;
- secondary screens keep the legacy style.

## Remaining findings (all minor)

| # | Issue | Evidence | Fix |
| --- | --- | --- | --- |
| 1 | **Double punctuation in the report source line.** Round 1's punctuation fix covered Home, not this line. It renders "Codex reported: Sample implementation is ready; its pull request remains open., Oct 15, 2026, 9:58 AM". | T-1, T-7 and T-8 at 1280 and 390. Code: `simple-task-detail.tsx:573-580`, which appends `, {time}` after a summary that already ends in a full stop. | Put the time first: "Codex reported at 9:58 AM: …". Or strip trailing punctuation the way `withSentencePeriod` does (`home-model.ts:132`). Related: Home shows times as `09:58`, while the task page shows `09:58 AM` (`shortTime`) and `Oct 15, 2026, 9:58 AM` (`localTime`). Use one clock style. |
| 2 | **PR links don't say which PR they open.** With several PRs, each primary link reads "Review PR", and the test requires two identical labels (`simple-task-detail.test.tsx:262`). The screen-reader names number PRs differently in different places: in the fixture, PR #23 is "required pull request 2" in the action but "Pull request 3 on GitHub" in Evidence. The visible label is also missing from the accessible name ("Review on GitHub" vs "Review required pull request 1 on GitHub (opens in a new tab)"), so voice commands that use the visible text fail (WCAG 2.5.3). | T-7 accessibility tree. Code: `simple-task-detail.tsx:610-620`, `:757-766`, `:873-884` and `:1021-1027`. | Label each link with its PR number using the existing pure parser `parseGitHubPullRequestUrl` (`src/github.ts:176`). The server already validates required PR URLs with it, and the URL is status data, not a queue string. Use "Review PR #101 on GitHub", with an accessible name that starts with that text and adds "(opens in a new tab)". Update the test to expect distinct labels. |
| 3 | **Cancel drops focus.** After Cancel on the check form, focus falls to `<body>` because the Cancel button unmounts. | T-9, display only. Code: `simple-task-detail.tsx:857-866`. | After closing the form, focus the "Check it" button that replaces it, or the status headline. |
| 4 | **Evidence links are unstyled.** "Pull request 1 on GitHub" (and tracker links, by the same rule) is 19 px tall and uses Chrome's default dark-mode link colour `#9E9EFF`, not the `#9499CB` accent (§8), because `.simple-task-evidence` has no `a` rule. The two Agent sessions rows also wrap differently: one Thread details button sits inline and the other drops to its own line. | T-7 and T-1 with Evidence open. CSS: `simple-task-detail.css:496-560`. | Give Evidence links the `.simple-task-link` treatment (accent, 44 px target), and put each session's Thread details on its own line. |
| 5 | **The skip link is 41 px tall**, against §9's 44 px rule. | Measured on focus at 390 px. CSS: `floor.css:56-65` (10 px padding on 21 px line height). | Add `min-height: 44px`, or use 11.5 px vertical padding. It appears only for keyboard users, so this is the least important item. |
| 6 | **The task column doesn't line up with the header.** At 1280, the task page's column starts at x=224 while the header brand sits at x=272. On Home, both the column and the brand start further in (248 and 272). | T-6 and T-7 screenshots. | Inset `.simple-task-page` to match `.simple-app-header-inner`, or widen the header's inner box to the task column. |

## Browser evidence

All browser checks used my own incognito T3 tab (`tab_i_eb894a6f-…`) on the disposable sample at `127.0.0.1:3018`, signed in with the preview-only secret. I didn't touch the parent's tab or any other agent's tab, and I closed mine afterwards.

| Check | Result |
| --- | --- |
| Home at 1280 | "5 things need you. 7 tasks are in progress. 1 finished today." All 5 queue ids render once. The page is 2,109 px tall. The header reads "Live, 10:06". |
| Home at 390 | No horizontal overflow, and the page is 2,701 px tall (2,857 in round 1). The only control under 44 px is the skip link (finding 5). The first row starts at 281 px. |
| Direct loads | `/tasks`, T-1, T-7, T-9, T-5 and T-10 each load from a full page navigation, and focus starts on the task title. |
| Task pages | I visited T-6 (agent blocker), T-5 (blocked on you), T-7 (review, More), T-9 (check form, Send-back toggle, Esc, Cancel), T-10 (T3 request), T-1 (active, Evidence), T-8 (draft PR) and T-11 (done/released). No rendered `href` points at T3. |
| Phone task page | On T-9 at 390: no overflow, every target is at least 44 px, and Mark checked is in the first viewport (bottom at 696 of 844 px). The Menu fits the viewport (x 170–362). |
| Focused tests | `bun test` over `simple-task-detail`, `home-model`, `home-freshness`, `simple-navigation` and `factory-backups-route`: 27 pass, 0 fail, 118 assertions. I didn't repeat the broad suite. |

**Screenshots** are in `/Users/agent/.t3/userdata/browser-artifacts/`:

- `browser-screenshot-127-0-0-1-mv9m3zil-99243d3b.png`: Home at 1280;
- `…mv9m4dg7-a9237c14.png`: T-6, agent blocker, focus on the title;
- `…mv9m5ig8-17a0949a.png`: T-1, active, with Evidence open;
- `…mv9m625e-d07d2a33.png`: T-7 with More open and the primary review link;
- `…mv9m7ngx-3bf7674a.png`: `/tasks` after a direct load;
- `…mv9m8934-00e5c991.png`: Home at 390;
- `…mv9m8hsw-40172f7f.png`: T-9 check form at 390;
- `…mv9m9nge-5ae6d61c.png`: T-10 at 390 with Menu open.

## Limits

- **Not submitted.** I submitted no check, send-back or form. Root already verified the real check mutation, offline recovery and the fresh-source stale guards on an earlier disposable fixture, and I didn't repeat that.
- **Not seen in the browser:** several PRs on one task (the sample has none), stale T3 on the task-page header, offline-disabled Evidence buttons, forced colours and reduced motion.
- **Scope.** I wrote only this file. I made no app, test or Factory metadata changes, and no commit, push, PR or deploy.
