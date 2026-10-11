# Simplified workflow preview: design review, round 2

Review · T-94 · 2026-10-09 · Opus 5.5 (independent design reviewer) · review only

Scope: `docs/design/previews/simplified-workflow.html` (saved 12:05) and the 20
captures in `output/playwright/simplified-workflow/` (recaptured 12:05). The
captures are the 9 screens at both sizes, plus `review-changed` at both sizes.
They were checked against `docs/design/simplified-workflow.md` and the round-1
review (`simplified-workflow-preview-review.md`). The question is whether the
**sample-data prototype** is ready for the user's screenshot approval. Live
implementation, merge, and deployment are separate and remain pending.

## Verdict

**Ready for the user's design approval after two small fixes.** Fix R1 (a
capture-only problem) and R2 (one sample timestamp), then recapture the phone
set. Neither fix changes the design, and neither needs another review round.
All seven round-1 blockers are resolved, and so are the should-fix items I
re-checked.

## Unresolved before showing the user

**R1. The phone captures crop the right 15px, so cards look clipped.** The
`*-mobile.png` full-page captures are 375px wide, but the page was laid out at
390px. The classic scrollbar's 15px was cut off the image instead of being
taken out of the layout. As a result, every main-column card on `active`,
`floor`, `rule`, `review-changed`, `blocked`, and `done` runs into the right
edge with no border. The topbar `DESIGN PREVIEW · SAMPLE DATA` box loses its
right edge too. To confirm this, I rendered `active` and `floor` at a true
375px layout in a separate headless shell, outside your Chrome session. There,
each card keeps its 12px right inset, and the `Finish rule` sentence wraps
differently than in the capture. The design is fine; the capture is not. A
user approving phone screens would read this as overflow. Recapture with
overlay or hidden scrollbars, or with the content width at 390px.
`check-mobile.png` is a 390px viewport capture and is correct. On desktop, the
same effect only shrinks the right margin from 24px to 9px, so it is
acceptable.

**R2. Activity on `active` contradicts itself.** The rows read `14:16`, then
`12:20 Claude finished "Write design spec"`, then `13:10 Kevin created the
Task`. That puts a Step finishing 50 minutes before its Task existed, on the
first Task screen the user sees. Round-1 B3 made provenance coherence a
blocker, so fix this one too. Change the creation time to, say, `09:40`, or
move the row (`simplified-workflow.html` line 454).

## Round-1 blockers: confirmed resolved

| ID | Round 1 | Now |
| --- | --- | --- |
| B1 | Stray chevrons; `.panel button{width:100%}` | Step rows contain only dial, name, meta, and state. No wrapped chevrons at either size. `Link a PR` sits after the rule sentence on phone. |
| B2 | Counts vs. rows | `review` 2 of 2, `blocked` 1 of 2, `done` 3 of 4 (plus 1 left open), Floor `3 TASKS` with 3 rows. The bay tally (1 / 4 / 1) matches the stations and the Counter (3 papers + `+1 more`). |
| B3 | Contradictory provenance | Shift log: T-91 ready 12:20 (2h), T-62 awaiting check 09:20 (5h), PR #16 `8 Oct 14:02 · d4e6f81`. These match `done`. Initials match names. The rule example is now T-97 / PR #20 / `f97a620`. Needs you is sorted oldest first (1d, 5h, 2h, 12m), and the `1d` oldest tile matches. Only R2 remains. |
| B4 | Stale head proof | `head=changed` shows `CHECKS PENDING`, `Not checked on this head`, and `Reviewed a91c4e2 · not this head` in both the PR row and the rail. The callout names the head change, and both sizes are captured. |
| B5 | Floor dials | T-94 blue partial, T-91 amber review, T-88 solid green check disc. |
| B6 | Dialog captures | Viewport-only captures. The page is dimmed, scrolling is locked, and the phone sheet is inset 12px. In the script, the background is inert, focus is trapped, Escape closes the dialog, and initial focus lands on the heading. |
| B7 | `Check now` ambiguity | Human check: `Check…`. GitHub re-poll: `Check now`, only on the STALE card. |

Should-fix items verified: the stacked merge says `waiting for PR #29's code to
reach main` and `not in Needs you`, and shows a PR row. `CAN'T CHECK` (T-98)
and `UNAVAILABLE` (T-96) are separate cards with distinct actions. The closed PR
card has all three actions and the real Needs-you row. The left-open Step is
dimmed with an explanation. UNBLOCK is red everywhere. The blocked note covers
the no-owner fallback. The `7 Oct` legacy row has its own header. Codes are
10px. The phone scoreboard keeps `oldest waiting on you`. Arrow keys move focus
only, and selection commits on click, Space, or Enter.

The brief's core rules hold on every screen. Steps change state directly, with
no approval controls. A zero-Step Task (`empty`, `check`) still reports and
finishes. On-merge Tasks wait for the default branch, and the stacked base
does not count. Agent-finish Tasks finish directly. The human check is opt-in
and its note is optional. Needs you holds only actionable items. T3 DECIDE
opens externally. Earlier-history and deployment rows stay separate from Done
proof.

## Minor: refine during implementation (not approval blockers)

1. **Counter paper order.** Floor Counter papers are ordered 5h, 2h, 1d. The
   sidecar is oldest first. Use the same order in both places.
2. **`Codex finished the Task` on `review`.** The Task is In review, and the
   Floor log says `is ready for review`. Prefer `Codex reported ready: PR #18…`
   so "finished" isn't read as Done.
3. **`Report progress` on `empty`** reads as a human action. Agents report
   progress. Use a note such as `Agents report through the CLI`, or remove it.
4. **Shift log header `TODAY`** also contains the `8 Oct` merge row. Add a date
   split or drop the header.
5. **Segment glyphs.** The state segments show glyphs (○ ◔ ● ⊖) on `active` but
   not on `blocked`. Pick one style.
6. **The check dialog title is shortened** (`…on the M5 mini`). The Task title
   is `…using M4 as reference`. Use the full title, wrapping if needed.
7. **Footer sample IDs** omit T-95 through T-102. Phone `Scoreboard ·` has a
   trailing separator.
8. **Implementation requirements from round 1 still apply.** These cover
   fixture-database behaviour tests (merge-SHA reachability, the 15-minute
   staleness window, `CAN'T CHECK`/`UNAVAILABLE`, left-open Steps,
   always-present provenance) and 390px Chrome checks on the real app.

## Evidence

- Viewed: `floor`, `active`, `review`, `review-changed`, `rule`, `done`,
  `check`, `blocked`, `failures`, and `empty` desktop. Also `active`, `floor`,
  `review-changed`, `rule`, `done`, `check`, and `blocked` mobile.
- Script read: the keyboard handler (lines 779–794), the dialog inert/scroll
  lock (751–773), and the add-step and blocked-owner flows.
  `capture.js` and `interactions.js` were read but not re-run.
- Independent render: a headless shell at a 375px layout for `active` and
  `floor`, written to a temp directory only. No preview, app, or capture files
  were modified.
