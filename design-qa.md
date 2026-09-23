# Floor dashboard validation

- Source visual truth: `docs/design/previews/factory-floor.html`, with the accepted behavior in `docs/design/style-guide.md` section 8.
- Implementation: the authenticated home route `/`. After reviewing the LAN preview, the user requested removal of the old Ledger dashboard and a full-width shared header on every page. Legacy `/ledger` links redirect to `/`.
- Source capture: unavailable. The in-app browser was unavailable, and Chrome rejected the local mockup URL under its URL security policy. No alternate route was used to bypass that restriction.
- Implementation screenshots: `/tmp/factory-floor-artifacts/desktop.png` (1440 × 1080) and `/tmp/factory-floor-artifacts/phone.png` (390 × 844), both at device pixel ratio 1. These use isolated synthetic data, not production records.
- Full-view and focused-region comparison: blocked because no accepted source screenshot could be captured.

## Required fidelity surfaces

Typography, spacing, color tokens, asset fidelity, and copy cannot be declared visually matched from source inspection alone. Browser checks of the implemented app and automated behavior checks will be recorded separately; neither substitutes for source-versus-implementation visual comparison.

## Implementation checks

- Desktop: six bays render in a three-column, two-row grid. Long project headers wrap without colliding with counts. Quiet bays dim, one running worker appears, and pending approval/input workers do not inflate working-now.
- Responsive: no horizontal overflow at 1440, 900, or 390 CSS pixels. Your Turn precedes bays on phone widths.
- Final phone capture confirms queue ages remain visible while long descriptions truncate. A newly accepted synthetic claim adds a Shift Log row with `floor-report-flash`; its stable event ID prevents repeat flashes on polling. Reduced-motion CSS disables animation and retains the info border.
- Initial navigation check: Floor and the then-present Ledger links worked. Approve navigates to the matching project and expands the exact source/thread details after loading. The later Ledger removal and shared-header revision are tracked below.
- Human stamp: review shows the specific claim and evidence; accepting a synthetic claim removes its paper, increments stamped-today, and adds the stamp event. Escape closes the dialog and restores focus. Production records were not stamped.
- Console: one authentication error occurred when the isolated fixture server was restarted, invalidating its prior session. After reauthentication, the tested navigation and Floor render produced no further console errors or warnings.
- Automated validation: 128 tests passed across 29 relevant web, projection, API authorization, T3 integration, and persistence files. TypeScript and browser production build passed. Focused regression checks cover stale observations, archive filtering, source/project isolation, stable timestamps, and worker counting.

The initial source-versus-implementation comparison was blocked by source capture. The user subsequently reviewed the rendered LAN implementation, approved its appearance, and explicitly requested commit and deployment. That rendered implementation and the requested revisions are the accepted delivery target; this does not claim pixel fidelity to the uncaptured HTML mockup.

## Remaining human check

After deployment, confirm the accepted Floor with production observations on desktop and phone. The user has approved the rendered preview; production report verification remains a separate human action.

final result: passed

## User-requested follow-up

The user reviewed the LAN preview positively, then requested removing Ledger and matching the Floor header width across all pages. This is an intentional change from the initial mockup.

- Removed Ledger navigation and rendering; GET/HEAD `/ledger` and `/ledger/` redirect to `/`. Verified the redirect through the LAN address.
- Preserved project creation in a collapsed Floor control and successfully created a synthetic project through it.
- Shared header now sits outside the constrained main content. Project detail, project edit, and Backups measured a 1440-pixel header with a 1280-pixel main at a 1440-pixel viewport. Phone header and document both measured 390 pixels, with no horizontal overflow.
- Browser evidence: `/tmp/factory-floor-artifacts/header-project.png` and `/tmp/factory-floor-artifacts/header-phone.png`.
- Follow-up checks: 83 web/API tests passed; final shell navigation/Floor tests, typecheck, build, formatting, and diff checks passed. The LAN preview was restarted with the current implementation and still listens on all IPv4 interfaces.

Follow-up implementation validation passed. The original source-capture limitation above remains historical and is not a claim of exact mockup fidelity.
