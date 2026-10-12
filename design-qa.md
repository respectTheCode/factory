# Active task dashboard design QA

The previous Floor validation is preserved in
[v0.3 validation history](docs/design/floor-validation-v0.3.md).

final result: passed

## Findings and resolutions

- Resolved [P2]: Small colored task-state text needed stronger contrast on tinted
  surfaces. Chip foreground now uses ink; measured minimum 8.80:1 across state
  chips and backgrounds. Semantic border, tint and existing dial remain.
- Resolved [P1]: Lone cards retain the standard width with `auto-fill`, measured
  about 280px at the 1920px viewport, including planned, secondary and Done cards.
- Resolved [P1]: Attention is plain amber text. The title's extended hit area
  opens Task detail from anywhere on the card without invoking a Check action.
- Resolved [P1]: Card text now uses at least 10px labels, 11px mono/session data
  and 13px dense body. Existing shared status dial accompanies each state chip.
- Opus rendered round 2 confirmed all seven initial blockers are resolved.
  Its P1/P2 findings are recorded in
  [full rendered review](docs/design/active-task-dashboard-opus-ui-review-r2.md).
  Spacing, disclosure, compact planned cards, duplicate finish copy, neutral
  handoff styling and unavailable-source copy were corrected with the P1s.

## Visual truth and comparison

Source: `/Users/agent/.t3/userdata/attachments/adcf600c-ccff-4f4b-b497-86e3aeb60c0c-0420e523-5f8d-491e-a2bf-179e15bd836e.jpg`.

Implementation: `/Users/agent/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mv41oaqn-4b0c0360.png`.

Source 2048×1152; implementation CSS viewport 1920×1080, PNG 1280×720.
Both normalized to 1280×720 in the paired full-view comparison:
`output/playwright/active-dashboard/reference-comparison.png`.
Focused card comparison: `output/playwright/active-dashboard/card-comparison.png`.
Both combined inputs were opened and visually inspected. Phone captures are
750×1624 PNG for 375×812 CSS; tool density was observed, deviceScaleFactor was
not exposed. See [validation evidence](docs/design/active-dashboard-validation.md).

State: authenticated Floor, fresh sample observations, all projects visible,
Done today collapsed. Content differs from the reference: this adapts its grid
and attention sidebar to existing Factory records and design tokens. The source
has no equivalent phone or unavailable-source visual, so those are product
resilience checks rather than pixel comparisons.

## Required fidelity surfaces

- Fonts/typography: preserve existing IBM Plex Sans/Mono. Titles have readable
  weight and two-line clamps with full accessible names. Metadata is deliberately
  small but meets the documented scale and contrast. Long titles use an inner
  two-line clamp, measured 39.09px at 19.55px line height, without overflow.
- Spacing/layout: grid plus sidebar matches the reference's primary arrangement.
  Vertical scrolling, per-project sections, separate session evidence and compact
  planned work are intentional Factory adaptations. Needs you comes first on phone.
- Colors/tokens: existing warm Ledger palette replaces cool reference palette.
  State text accompanies color; red blocked and amber attention remain separate.
  Lavender is keyboard focus. Corrected chip contrast exceeds 4.5:1.
- Image quality/assets/icons: existing Factory logo retained; Phosphor icons used
  for project navigation. No new photographic or illustrative assets are needed.
  The reference's milestone rail is intentionally omitted because Factory has no
  milestone model.
- Copy/content: task state, finish rule, recorded handoff provenance and session
  observations are separately labeled. No invented percentages, ETA, milestones,
  planning, completion claims or deployment claims. Sample labels belong only to
  the disposable fixture, not production UI copy.

## Comparison history

1. Initial Opus source/design review: seven design-contract blockers resolved in
   [brief](docs/design/active-task-dashboard.md) before implementation.
2. Full and focused source/implementation comparison: intentional adaptations
   accepted; semantic-chip contrast and Opus P1/P2 corrections requested.
3. Corrected captures: desktop `mv41oaqn-4b0c0360`, phone top
   `mv41oi90-92a1a9da`, phone Steps/sessions `mv41oiar-4d3b8d6f`, planned/secondary
   `mv41oatt-6a707609`, Done `mv41mrpl-3be9c19a`. All use the screenshot filename
   prefix and browser-artifacts base path documented above. Both paired comparison
   inputs were regenerated from the corrected desktop image and opened again.
   The coordinator found no actionable P0/P1/P2 visual issue. Keyboard focus is
   visible in `mv41mbki-3e0afb67` and `mv41mjt0-2520e544`, with focus/DOM identity
   retained after a live refresh (`mv41r3y6-252f2ed1`).
4. A padded title clamp exposed part of a third line. Moving the clamp to an
   inner span fixed it; the final desktop capture and DOM measurements confirm
   exactly two lines. Opus round 3 confirmed all prior P1 findings resolved and
   found one remaining P2: dim provenance text over the green tint (4.34:1).
   Changed it to ink (9.92:1) and recaptured Done:
   `browser-screenshot-127-0-0-1-mv4201y5-140c6ee3.png`. The capture was opened
   and inspected; computed ink RGB234/230/223 over green16% confirms the fix.
   Focused title remains position static; an off-title card click navigates to
   detail with zero dialogs. Focus capture:
   `browser-screenshot-127-0-0-1-mv420228-000fd229.png`.

No actionable P0/P1/P2 finding remains. Opus reviewed three rounds; the final
one-line contrast correction was then validated by calculation, focused test,
computed browser styles and post-fix visual inspection by the coordinator.

## Open questions and limits

Live operational data, physical touch devices, forced-colors, and native OS
motion/contrast preference matching were not verified. Declared media-query
styles were temporarily applied for screenshots, with matchMedia remaining false.
No PR, CI, deployment, merge or human acceptance evidence is claimed.

## Follow-up polish

Opus P3 notes remain: phone freshness separators can lead a wrapped line,
masthead observed time uses 12-hour formatting while the main clock is 24-hour,
some small legacy labels and duplicate focus outlines could be refined. The
merge-wait reason suppression currently relies on the exact server formatter;
a shared structured reason would be a later maintenance improvement.
These do not block local human review. See
[Opus round 3](docs/design/active-task-dashboard-opus-ui-review-r3.md).

## Implementation checklist

- Contrast, type, card size, attention affordance and related P2 corrections
  are complete. Post-fix captures and both paired comparisons were inspected.
- Final focused checks: 82 tests, 353 assertions; build/typecheck, scoped
  Prettier and diff checks pass.
- Opus confirmed all prior P1s resolved; its new provenance P2 is fixed and
  visually verified. Scoped format and diff checks pass.
- Retain fresh local preview and report local evidence on T-100.
