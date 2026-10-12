# Active dashboard local validation

2026-10-11 · T-100 · `t3code/active-task-dashboard` · base `b57a014`

## Environment and checks

The actual Factory app runs at `http://127.0.0.1:3016` with a disposable SQLite
database and in-process fake T3/GitHub readers. No existing database or production
integration was used. See [preview instructions](active-dashboard-preview.md).

Final focused projection, transport, web, workflow and skill-contract checks:
82 tests passed, 353 assertions, zero failures. `bun run build` passed, including typecheck.
Final formatting and diff checks are recorded in the root design QA report.

## Browser evidence

- Desktop 1920×1080, laptop 1280×800 and phone 375×812: no document overflow.
  The phone's project-chip strip deliberately scrolls horizontally.
- One card per task; shared sessions appear on each linked task and count once
  globally. Sample has 11 unfinished tasks across two projects and one archived
  task completed today. In review work without an attention item stays visible.
- All visible new Floor buttons and disclosure summaries measured at least
  44px high. No nested buttons. Title focus and DOM identity survive a live
  snapshot refresh and viewport resize.
- At 200% root text size, both desktop and phone document widths remain at
  their CSS viewport widths, with no task-card internal horizontal overflow.
  This checks text scaling, not native browser zoom.
- Hiding one project updates grid and counts while preserving all four global
  attention items; its hidden chip shows four needs-you items. Reload preserves
  visibility. Hiding both gives the explicit all-hidden state; Show all restores.
- Card navigation opens task detail without the human-check dialog. Needs you's
  Check action opens the existing human-check dialog with report and criteria;
  Cancel closes it without accepting work. Project heading navigation works.
- Done today starts collapsed, expands to the archived finished task and its
  finish provenance. Unmatched observed sessions stay outside task counts.
- Actual unavailable-reader fixture: all 11 unfinished cards show session status
  unavailable, zero cards assert no linked session, task counts remain 5 active,
  2 blocked, 3 in review and 1 done today. Stale approval is removed from the
  canonical queue (four items become three). Fresh mode restored afterward.
- Final fresh-page console inspection showed no errors. Restarting the fixture
  intentionally caused WebSocket connection refused during shutdown; this is
  recorded as preview lifecycle noise, not claimed absent from the whole session.

## Capture paths

All files below live under `/Users/agent/.t3/userdata/browser-artifacts/`.

| State                         | PNG                                                  |
| ----------------------------- | ---------------------------------------------------- |
| Desktop top                   | `browser-screenshot-127-0-0-1-mv40wm08-d6e4b29f.png` |
| Laptop top                    | `browser-screenshot-127-0-0-1-mv4112na-0a206749.png` |
| Phone top                     | `browser-screenshot-127-0-0-1-mv40vnuo-11c3bcb1.png` |
| Phone cards                   | `browser-screenshot-127-0-0-1-mv40w3iu-16e511be.png` |
| Phone unmatched               | `browser-screenshot-127-0-0-1-mv412zk6-fb7db343.png` |
| Expanded done                 | `browser-screenshot-127-0-0-1-mv412rnk-bd0c011a.png` |
| Hidden project                | `browser-screenshot-127-0-0-1-mv40uso1-c5573357.png` |
| Focus                         | `browser-screenshot-127-0-0-1-mv40vnrh-30645105.png` |
| Unavailable source            | `browser-screenshot-127-0-0-1-mv412065-3e23a8b9.png` |
| Check dialog, canceled        | `browser-screenshot-127-0-0-1-mv41352b-f2476c98.png` |
| Grayscale filter              | `browser-screenshot-127-0-0-1-mv40wm3v-7e2d190d.png` |
| Reduced motion rules applied  | `browser-screenshot-127-0-0-1-mv40x893-8c76736c.png` |
| Higher contrast rules applied | `browser-screenshot-127-0-0-1-mv411d1v-fc0c6818.png` |

Desktop screenshots normalize 1920×1080 CSS to 1280×720 PNG. Phone snapshots are
750×1624 PNG for 375×812 CSS. These are tool capture dimensions, not a verified
deviceScaleFactor. The browser does not expose motion/contrast emulation. The last
two screenshots temporarily apply the inner rules from the declared CSS media
queries; native matchMedia stayed false. They verify those declared styles only,
not OS preference matching. Forced-colors and physical touch devices were not tested.

The normalized full comparison and focused card comparison are in ignored local
`output/playwright/active-dashboard/`. The source and implementation have different
content and product state; this is an intentional adaptation, not a pixel clone.

No PR publication, merge, deployment or human acceptance is evidenced here.

Factory T-100 finished report: `57315e22-a3f7-4230-b3bf-20dbe6ea78f9`, epoch 0.
Readback is In review, waiting for a required PR link and confirmed merge; it
is not marked complete. Remote doctor is compatible and healthy at `b57a014`.

## After rendered Opus review

All three P1 findings and the related P2 findings were corrected: consistent
card widths with auto-fill, full-card task navigation, plain attention text,
documented type scale, neutral handoffs, accurate finish evidence, explicit
disclosure icons, compact planned cards, and unavailable-source queue caveat.
The exact existing status dial was extracted for shared use; existing callers
retain their behavior. Chip text contrast is at least 8.80:1, priority text
13.01:1 on regular cards and dim metadata 5.70:1 (6.42:1 on planned cards).

The fixture now has 17 unfinished tasks, six planned, an actual 1/2 Step rollup
(won't-do excluded), a manual hold and a healthy secondary project with no threads.
Planned disclosure verified 4 → 6 → 4. All cards measure about 280px at 1920px;
the lone secondary and Done cards retain that width. Long-title text measures
39.09px at 19.55px line-height: exactly two visible lines. Whole-card click at
the T-9 finish-rule body opens existing detail with zero dialogs.

Keyboard Tab/Shift+Tab produced `:focus-visible` and a visible 2px lavender
outline on both card and project chip. Post-fix stale mode has 15 rendered
unfinished cards (two planned hidden) marked unavailable and zero false
no-session assertions; queue records four items and says its source breakdown
may be incomplete. The actual Steps stay visible while sessions are unavailable.

Final captures (same browser-artifacts directory):

- Desktop: `browser-screenshot-127-0-0-1-mv41oaqn-4b0c0360.png`
- Planned and lone secondary: `browser-screenshot-127-0-0-1-mv41oatt-6a707609.png`
- Phone top: `browser-screenshot-127-0-0-1-mv41oi90-92a1a9da.png`
- Phone Steps/sessions: `browser-screenshot-127-0-0-1-mv41oiar-4d3b8d6f.png`
- Done: `browser-screenshot-127-0-0-1-mv41mrpl-3be9c19a.png`
- Card keyboard focus: `browser-screenshot-127-0-0-1-mv41mbki-3e0afb67.png`
- Chip keyboard focus: `browser-screenshot-127-0-0-1-mv41mjt0-2520e544.png`
- Stale card bodies/Steps: `browser-screenshot-127-0-0-1-mv41pw9w-b4a848cc.png`

Both full-view and card-region paired comparisons were regenerated with the
post-fix capture, opened together with the reference and visually inspected.
Typography, spacing, tokens, assets and copy were reassessed. No remaining
actionable visual mismatch was found in the coordinator's post-fix comparison;
the fresh Opus verification round remains separately recorded.

Opus round 3 confirmed all original P1s resolved and found a final provenance
contrast P2. Changed the Done evidence foreground to ink: 9.92:1 on its green16%
tint. Browser computed styles and the opened post-fix capture confirm it:
`browser-screenshot-127-0-0-1-mv4201y5-140c6ee3.png`. The focused title stays
position static, and clicking the finish-rule body while keyboard focused still
opens detail with zero dialogs (`browser-screenshot-127-0-0-1-mv420228-000fd229.png`).
This tiny correction was verified by the coordinator after Opus round 3; no
fourth Opus review is claimed. Non-blocking P3 notes remain in root design QA.
