## Verdict

**No P0 or P1 findings remain, so nothing blocks local human review.** All r2 findings are resolved except two small cosmetic leftovers, listed below as P3. There is one new P2: a one-line contrast fix that should go into this batch. This doesn't say anything about user acceptance, CI or deployment.

I didn't edit anything. I ran the two focused test files: 24 passed, 0 failed.

## Resolution of r2 findings

| r2 item                                  | Status | Evidence                                                                                                                                                                                                                      |
| ---------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 lone card stretches                 | ✅     | `auto-fill` is at `src/web/floor.css:367`. Lone T-12 and Done T-11 are the same width as the other cards in a row.                                                                                                            |
| P1-2 amber box looks clickable           | ✅     | It is now plain amber text with no box (`floor.css:561`). The whole card opens the task via `::after` (`:470`), and the card shows a focus ring (`:385`). The title turns lavender when you hover anywhere on the card (T-9). |
| P1-3 type size and chip contrast         | ✅     | Labels and data are 11.04px; reason, finish rule and handoff text are 13px. Chips use `--ink` text (the Blocked chip is about 10.7:1). `StatusIcon` was extracted unchanged apart from the new `decorative` option.           |
| P2-1 wasted vertical space               | ✅     | The h3 margin is 0, the facts row only renders when it has content, and the padding moved to the button with the 2-line clamp on an inner span. T-4 clamps cleanly in the latest desktop capture.                             |
| P2-2 no disclosure marker                | ✅     | Phosphor carets on Done today and New project; the caret rotates when open.                                                                                                                                                   |
| P2-3 masthead copy                       | ◐      | The separator and singular count are fixed. The phone line still starts with "·" (P3-1).                                                                                                                                      |
| P2-4 log times and initials              | ✅     | Log times are 24-hour HH:MM, with CX/CL for Codex/Claude (other actors fall back, e.g. LU for Luna). The masthead "Observed" time is still 12-hour (P3-2).                                                                    |
| P2-5 / P2-6 planned and done cards       | ✅     | Planned cards drop the finish rule. Done cards show only the finish evidence. The merge-wait reason is hidden when it repeats the finish rule, and a test covers this.                                                        |
| P2-7 colour overload                     | ✅     | Hidden chips are amber only when something needs you; the handoff box is neutral.                                                                                                                                             |
| P2-8 unavailable reason and queue caveat | ✅     | Generic unavailable copy (`floor.tsx:713`) and the incomplete-queue caveat (`:1213`).                                                                                                                                         |
| P2-9 phone length and minor items        | ✅     | The Open button is at least 44px wide, the ineffective `aria-label` is gone, and vertical scrolling is accepted as intentional.                                                                                               |
| Focus evidence                           | ✅     | Card and project-chip focus are both visible. These captures were taken before the final title-clamp fix (T-4's third line bleeds through in them), so the focus ring on the final CSS is verified from code only.            |

## Remaining P2 (fix now; one line)

- **Done-card provenance text fails AA contrast.** `.floor-task-provenance` (`src/web/floor.css:567`) puts `--ink-dim` on the green tint over `--raised`, which computes to **4.34:1** for 13px regular text. The 5.70:1 figure you measured applies to plain `--raised` only. This is the only tinted box with dim text.
  - **Fix:** set `color: var(--ink)` (9.92:1), or keep the dim text and drop the tint.

## P3 and residual limits

1. **Phone masthead still wraps with a leading "·".** The `::before` sits inside the nowrap span (`floor.css:51`). **Fix:** use trailing separators instead, e.g. `.floor-freshness-primary::after, .floor-freshness-detail:not(:last-child)::after { content: "·"; margin-left: 5px }`, and remove the `::before`.
2. **The masthead "Observed 12:35:40 PM" is 12-hour while the clock is 24-hour** (`floor.tsx:809`). **Fix:** add `hour12: false`.
3. **Keyboard focus draws two rings,** one on the title button and one on the card (visible in the focus capture). Separately, `.floor-task-title:focus-visible { position: relative }` (`floor.css:299`) makes the title the `::after`'s containing block, so while the title is focused only the title area is clickable. **Fix:** exclude `.floor-task-title` from the shared focus rule and use `.floor-task-card:has(.floor-task-title:focus-visible)` for the card ring.
4. **The merge-wait suppression compares against the exact server sentence** at `src/application.ts:6232`. If that wording changes, the duplicate silently comes back. The counts do agree today, because both sides use `getTaskRequiredPullRequests`. **Fix (later):** share one formatter or use a structured reason code.
5. **A few small type sizes remain.** The hidden chip's "N needs you" is 9.6px and new on this branch. "No linked session observed" is 10.88px and session titles are 11.2px, both sans. The 8.6px sidebar REVIEW/CHECK chips and 9.8px log initials predate this branch, though the branch made them slightly smaller.
6. **Shown only in tests, or not checked:**
   - Tests only: "+N more handoffs", and the final source-unavailable card (its capture is still being produced).
   - Not tested: native reduced motion, forced colours and contrast emulation; the CSS for them is declared but not exercised.
   - Not reviewed: the paired reference comparison PNG, which hasn't been refreshed yet.

`★ Insight ─────────────────────────────────────`

- The title fix worked because `-webkit-line-clamp` only hides lines inside the content box. When padding sat on the clamped element, the third line showed through in the padding. Moving the padding to the parent button stops that.
- `:focus-within` also matches after a mouse click and can't tell keyboard focus from pointer focus. `:has(:focus-visible)` limits the card ring to keyboard focus, the same way the title's own ring is limited.
  `─────────────────────────────────────────────────`
