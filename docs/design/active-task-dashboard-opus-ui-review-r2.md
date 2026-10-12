## Verdict

**The design and data model are sound and there are no P0s. Fix three small P1s before handing this to you for local review.** All seven of my earlier blockers are resolved. The task, session, status, finish and attention channels are understandable. The remaining problems are layout, type size, contrast and one misleading control, all in CSS or markup. None of them needs a data-model change.

## Prior blockers

| #   | Blocker                        | Status     | Evidence                                                                                                                                                                                                                       |
| --- | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Server-side task cards         | ✅         | T-7, T-8 and T-9 are visible. T-8 has no queue item.                                                                                                                                                                           |
| 2   | Task/session rules             | ✅         | The shared Codex session appears on T-1 and T-3 with "Also linked to". The header counts 3 sessions once each. The approval session attaches to planned T-10. The unmatched session is listed under "Sessions without a task". |
| 3   | Attention from the queue       | ✅         | Matching happens on the server. Card targets carry no action.                                                                                                                                                                  |
| 4   | Steps counted by ID            | ✅ in code | The sample data has no Steps, so no card shows a count.                                                                                                                                                                        |
| 5   | Handoff choice and attribution | ✅         | T-5 shows a human handoff and T-6 an agent handoff, each with reporter and age.                                                                                                                                                |
| 6   | Visibility vs global counts    | ✅         | The hidden chip shows "4 needs you", the global 4 stays, counts drop to 1/0/0/0, and Show all appears.                                                                                                                         |
| 7   | Style guide                    | ✅         | §8 is rewritten with no hazard stripes. It says planned cards are compact, but they aren't yet (P1-1, P2-5).                                                                                                                   |

## P1: fix before handoff

**P1-1. A project with one card stretches that card across the whole width.** The grid uses `auto-fit` (`src/web/floor.css:353`), so a lone card fills all 1423px. I saw this on T-12, on planned T-10 (the "compact" card ends up the biggest on the page) and on the Done card. It also shows in your hidden-project screenshot.

- **Fix:** change `auto-fit` to `auto-fill`.

**P1-2. The card's "Needs you · 1 · Review" box looks like a button but does nothing.** It is a plain paragraph with an amber fill and border (`floor.tsx:631-638`, `floor.css:525-530`). It is the most eye-catching thing on the card, so people will click or tap it and get no response.

- **Fix:** restyle it as a status line (amber dot and text, no fill or border), or reuse the sidebar's REVIEW/CHECK chip look without the box.
- **Also:** stretch the title button's click area over the whole card with `::after { inset: 0 }`. Today only the title opens the task (`floor.tsx:572-581`), and the card holds no other control, so this is safe.

**P1-3. Card text is below the style guide's type scale, and the Blocked chip fails AA contrast.**

- **Sizes I measured** (style guide §4 asks for 10px labels, 11px for mono data, 13px for dense body):
  - 9.44px: section labels (`floor.css:508`) and the session state text such as "Claude · working" (`:612`)
  - 9.76px: handoff attribution (`:522`)
  - 9.92px: state chip and task ID (`:401`, `:417`)
  - 11.2px: reason, finish rule and handoff body (`:474`)
- **Blocked chip contrast:** red `#E5484D` text on an 18% red tint over `--raised` is about **3.4:1** at 10px. AA needs 4.5:1. That is why it's the dimmest chip in the grayscale screenshot. Active is borderline at about 4.4:1.
- **Fix:** raise these to the §4 scale. For chips, use `--ink` text with the coloured border, and render the existing status dial (`statusDefinitions[].dial`) beside the chip. My earlier review asked for "dial plus chip", and the dial gives grayscale users a shape cue.

## P2: polish, can follow

1. **Wasted vertical space on every card (about 48px).** The card's h3 keeps its default 15px top and bottom margins (`floor.css:421`). The facts row always renders, even empty (`floor.tsx:582`). Single-line titles also sit vertically centred inside the 44px button, so titles don't line up across a row (T-8 on desktop).
   - **Fix:** set `margin: 0` on the h3, render the facts row only when it has content, and get the 44px tap height from padding instead of `min-height`.
2. **"Done today" doesn't look expandable.** `display: flex` on the summary removes the disclosure triangle (`floor.css:656-664`). Add a ▸ marker. New Project already had this problem before this branch.
3. **Masthead copy.**
   - "Factory connected Observed 12:14 PM" is missing a separator (`floor.tsx:821-823`).
   - "1 fresh observed sessions" needs a singular form (`:835`).
   - On phone the line wraps so that a "·" starts the next line.
4. **Recent changes times and initials.**
   - Times wrap as "12:11:21 / PM" because the column shrank from 52px to 48px (`floor.css:870`).
   - Times use 12-hour format while the clock uses 24-hour (`floor.tsx:408` vs `:813`).
   - The log shows `CO`/`LU` while cards show `CX`/`CL` (`:404`, this predates the branch).
5. **Planned cards aren't really compact.** They are full cards with only less padding.
   - **Fix:** drop the finish-rule row on planned cards.
6. **Finish rule repeats or reads as unfinished.**
   - On T-7 and T-8 the reason and the finish rule both say "0 of 1 merged".
   - The Done card says "PR merge required" next to "Marked done by Sample operator", which reads as if something is still outstanding.
   - **Fix:** on done cards, show only the finish evidence. Hide the reason when it just restates finish progress.
7. **Colours overloaded.**
   - Hidden chips always get an amber border, even with nothing needing you (`floor.css:180`).
   - The handoff box uses the Active blue, so on a Blocked card it reads as "active" (`:513`).
   - **Fix:** make the hidden chip amber only when it has an attention count, and give the handoff box neutral styling.
8. **"Session status unavailable" gives no reason.** On T-12 it is correct: the sample data maps Release Tools to a T3 project the fake reader never returns (`scripts/preview-active-dashboard.ts:243` vs `:148`). Adding "T3 project not observed" vs "source stale" would help.
   - In stale mode, the sidebar breakdown says "0 decide" while T3 approvals can't be observed (`floor.tsx:1161`, this predates the branch). It should say decisions are unavailable.
9. **Phone length.** The page is 5,727px long and the first card starts at 1,095px. The app shell above the Floor takes 229px and predates this branch.
   - **Minor:** the tracking-notes "Open" button is 41px wide.
   - **Minor:** `aria-label` on a `<strong>` (`floor.tsx:669`) has no effect.

## Channels, mobile, contrast

- **Channels are understandable.** Work state is the chip and left border. Finish is its own row. Handoffs are attributed. Sessions are a separate footer with explicit "No linked session observed" vs "unavailable" text.
- The one muddle is that In review and Needs you are both amber. T-8 is an amber card with nothing needing you. Making the on-card attention marker look like the sidebar's verb chips (P1-2) separates them.
- **Mobile:** Needs you comes first, there is no horizontal overflow at 375px, and every target except that 41px "Open" button is at least 44px. Density and type size need P1-3 and P2-1.

## Evidence and limits

- **What I looked at:** all seven listed screenshots, the reference image, and four unlisted later captures from 12:17–12:18 (1280px and stale mode).
- **My own browser checks:** I signed into the disposable preview in an isolated browser context, read the DOM, took screenshots at 1920 and 375, and opened Done today on the page only. Signing in created a session in the disposable preview database; nothing else was changed. I closed the page afterwards.
- **Keyboard focus image:** it matches the desktop image apart from the clock and ages. No focus ring is visible, so it doesn't show focus. Please capture a crop with focus on a card title and on a visible project chip. Both the chip border and the focus ring are lavender.
- **Not shown in the sample data:** Steps counts, "+N more handoffs" and the manual-hold marker. These rest on tests only.
- **Not verified:**
  - stale-mode card bodies;
  - reduced motion under real OS emulation (the only animation is the log flash, which is turned off);
  - forced colours;
  - real operational data, which wasn't needed for local review.

`★ Insight ─────────────────────────────────────`

- With `auto-fit`, empty grid columns collapse, so a lone item stretches to fill the row. `auto-fill` keeps the empty columns, so every card stays the same width however many there are.
- Chrome shows the `<details>` triangle only while the `<summary>` keeps its default `display: list-item`. Setting it to `flex` removes the triangle without any warning.
  `─────────────────────────────────────────────────`
