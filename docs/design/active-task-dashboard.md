# Active task dashboard

T-100 · Reference: user-supplied tidyinvoice project-map screenshot · 2026-10-11

## Scope

The Floor becomes a task-focused overview. Keep Factory's Ledger palette,
IBM Plex typography, task detail workflows, and read-only observation boundary.
The reference supplies the card-grid and attention-sidebar layout; its milestone
rail and estimated percentages do not map to Factory's current domain.

## Layout and behavior

- Compact header with connection/freshness and counts explicitly labeled as
  Tasks or observed sessions. Active work remains active without a running agent.
- Project visibility controls filter task cards and their counts. Needs you stays
  global, and hidden project chips retain an attention count. Project detail
  remains reachable. Persist the existing project-visibility preference; provide
  Show all when any project is hidden.
- One card per Task, grouping all linked contributors/sessions. Show task ID,
  project, title, work state, recorded blocker or handoff, optional Step counts,
  and its actual finish condition. Steps completed do not complete their Task.
- Default grid contains Active, Blocked, In review and Planned work, grouped by
  project. Planned cards are compact, initially limited to four with an explicit
  reveal control. Backlog is available through project detail. Done today is a
  separately disclosed section rather than crowding active work, including Tasks
  archived after finishing to match the existing done-today metric.
- Needs you retains Review, Check, Decide, and Unblock actions. Show actionable
  reasons; never promote an agent dependency into a human request.
- Recent changes reuses the bounded event feed. Do not label it "since your last
  visit" without a reliable persisted visit baseline.
- Unlinked or ambiguous observed sessions remain visible in a separate section.
  They are observations, not additional Tasks or inferred associations.
- On phones, Needs you comes before the cards; all primary controls are at least
  44px and keyboard accessible. Explicit empty, loading, error and stale states
  survive the redesign.

## Data boundary

Extend the server Floor projection with typed task cards derived from existing
TaskStatus and report evidence. Reuse existing projection input and subscription;
avoid browser fan-out queries per card. A task's work state, observed session
state, recorded handoff and PR observation must remain independently labeled.
Freshness applies to the relevant source; stale GitHub or T3 observations cannot
imply current review readiness, running work or confirmed completion.

## Validation

Focused projection and web tests cover zero-Step Tasks, finished-but-unmerged,
human checks, blocked work, multiple sessions per Task, unmatched sessions,
archived work, project filtering and stale observations. Typecheck and web build
cover the changed transport/rendering shapes. Browser checks use isolated sample
data at desktop and phone widths; verify task navigation, visibility filters,
keyboard focus, empty states and no horizontal clipping. Opus reviews the design
before implementation and the actual rendered UI before delivery.

No production deployment, merge or human check is part of this build request.

## Opus review decisions

The [initial Opus review](active-task-dashboard-opus-design-review.md) identified
seven design decisions. All are resolved for implementation:

1. Add task-card projection fields alongside the legacy bay fields, sourced from
   task records so In review tasks remain visible without an attention item.
2. Key cards by Task ID and de-duplicate sessions within each by source/thread.
   Shared sessions appear on each linked card with related-task context but count
   only once in the observed-session total. Planned-task sessions attach too.
3. Associate Needs you by canonical queue targets, including related targets;
   do not duplicate the attention rules on the client. Card navigation has no
   review/check action; only sidebar actions invoke those workflows.
4. Count Steps directly from status rows by ID, excluding won't-do and counting
   released or completed as done. Zero-Step cards omit counts. Done cards explain
   remaining open Steps without implying unfinished Task work.
5. Prefer task-report handoff; otherwise newest handoff from an unfinished,
   non-archived Step. Display reporter, report age and additional handoff count.
6. Needs you stays global while grid counts follow visible projects. Keep the
   existing storage key. No status filters in this first version.
7. Update style guide section 8. Blocked cards use red borders and text, no hazard
   stripes. Permit vertical scrolling to preserve readable cards.

Sort by attention (oldest first), blocked, review, active, planned, then priority,
recorded order and ID. Running-session changes never drive ordering. Show session
status unavailable when source observations are missing/stale rather than falsely
asserting no session. Recent changes retains existing event sentences and its
bounded-feed label. Browser proof uses isolated sample records rather than live
operator data; that limitation will be explicit in the final review.
