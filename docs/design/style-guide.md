# Factory Design System — "Ledger"

v0.4 · 2026-10-11 · dark-only · mobile-first · **clean records, dirty room**

Factory is the fifth design system in the family, after Beacon, Forge ("Tally
Console"), Grail, and Watchtower ("The Bridge"). Its language is called
**Ledger**: Factory is the house's own paperwork — a shop ledger in which
agent claims and completion evidence are recorded, with human checks when
explicitly required. v0.2 gives the
ledger its room: a machine shop. The _records_ stay clean — disciplined
layout, hairline rules, tokenized type. The _room_ is dirty — warm oil-and-
iron neutrals, film grain, hatching, hazard stripes, machined edges. v0.2.1
turns the lights on: indicators (and only indicators) emit an LED glow, and
the mark gains a dimensional stamped-metal rendition with a lit chip.

Machinery appears as **material, never process**: stamped plates, gauge
dials, knurled textures, hazard paint. Conveyor belts, gears-as-workflow,
and pipeline diagrams remain forbidden — the product analysis is explicit
that Factory is a _run substrate, not a factory pipeline_.

v0.4 makes **the Floor** (§8) task-focused: a card per Task, observed
sessions grouped within it, and an exception-focused Needs you queue.
It remains useful on a spare display and a phone. Task state, reports,
confirmed PR merges and opt-in human checks keep their own provenance;
session activity never implies completion. The Floor never becomes a
diagram of how work flows.

Reference implementation: `docs/design/previews/factory-system.html`.
Floor study: `docs/design/previews/factory-floor.html`.
Mark study: `docs/design/previews/factory-marks.html`.

---

## 1. Position in the family

The family shares DNA at the semantic layer, never the component layer:

| Shared (verbatim)                                    | Factory's own                    |
| ---------------------------------------------------- | -------------------------------- |
| Signal hexes `#E5484D / #2FBE6B / #F0B429 / #4AA3E0` | Oil-and-iron neutral ramp (§3)   |
| House accent lavender `#9499CB`                      | Prose face: IBM Plex Sans (§4)   |
| "Prose identifies; mono measures" (IBM Plex Mono)    | Shopwear texture layer (§5)      |
| 1px rules instead of shadows; base-4 spacing         | Status dials (§6)                |
| No fifth hue; color never the only signal            | Signature: the Countersign (§7)  |
| A mark whose one live element reports state          | The Floor and worker tokens (§8) |
|                                                      | Mark: the Countersigned F (§11)  |

Beacon, Forge, and Watchtower sit on a cool blue-black canvas ladder.
**Factory steps off the ladder on purpose.** Grail proved a sibling may
switch materials (warm paper light mode, cool ink dark mode); Factory
switches materials for the whole product: it is the shop floor, the only
sibling whose subject is the work itself, so its dark is soot and oil, not
blue steel. Signals and accent are untouched, so it still reads as family
at a glance — the cool lavender accent actually lands harder on warm ground.

## 2. Principles

1. **Clean records, dirty room.** Layout, type, and data are disciplined and
   tokenized; grit lives only in the environment — background grain, panel
   texture, edge treatments — never in the information. If a texture ever
   competes with a value, the texture loses.
2. **Claims preserve provenance.** Agent reports, confirmed PR merges and
   explicit human checks are separate evidence. Task completion follows its
   configured finish rule; session activity is never completion evidence.
3. **Amber means "your turn."** `sig-warn` marks work awaiting a human
   decision — attention, not failure. The dashboard exists to drain the
   amber column.
4. **Machinery is material, not process; people are tokens, not sprites.**
   Dials, plates, hazard paint, stamps: yes. Gears, conveyors, pipelines,
   flow diagrams: never. Agents may appear on the Floor as **worker
   tokens** — a circle with mono initials and one over-head badge — but
   never as robots, avatars, or pixel-art figures. A token shows _who is
   at which station_; it never animates _how the work is done_.
5. **Color is state, never decoration; never the only signal.** Four signal
   hues with fixed meanings; every dot, dial, and chip carries a mono text
   twin. Greyscale legibility is a release test.
6. **Phone first.** The ≤540px layout is the reference layout; tap targets
   ≥44px; the 1280px desktop shell is the adaptation.

## 3. Color

### Neutrals — oil & iron ramp (dark-only)

| Token         | Hex       | Use                                              |
| ------------- | --------- | ------------------------------------------------ |
| `--canvas`    | `#141210` | page background; `theme-color`; manifest         |
| `--panel`     | `#1B1815` | panels, hero, sunken fields                      |
| `--raised`    | `#24201B` | cards, secondary buttons, menus                  |
| `--rule`      | `#342E26` | every 1px border and divider                     |
| `--ink`       | `#EAE6DF` | primary text — warm paper-white                  |
| `--ink-dim`   | `#A2988A` | secondary text, eyebrows, timestamps             |
| `--ink-faint` | `#635A4D` | disabled, decorative only — never a needed value |

The whole ramp is warm: black with soot and oil in it, ink the color of a
shop traveler card. No light ramp exists (FR-043); `color-scheme: dark`
is declared at `:root`.

### Signals — family-wide hexes, Factory meanings

| Token        | Hex       | Factory meaning                                              |
| ------------ | --------- | ------------------------------------------------------------ |
| `--sig-down` | `#E5484D` | blocked; rejected; destructive actions; disconnected         |
| `--sig-ok`   | `#2FBE6B` | verified complete; released; accepted; connected             |
| `--sig-warn` | `#F0B429` | awaiting verification; attention pending; stale/reconnecting |
| `--sig-info` | `#4AA3E0` | agent actively working; live-update flash                    |

Three forms each: solid, text/border, 16% tint. State borders ≤55% alpha.
No fifth signal, ever. On the warm ramp, saturation is what separates
signal amber from environmental warmth — so no neutral may exceed the
saturation of `--ink-dim`.

### Accent

`--accent` `#9499CB` (house lavender) · `--on-accent` `#141210` ·
`--tint-accent` `rgba(148,153,203,.16)`. Primary buttons, links, selected
tab, focus (`2px solid`, offset 2px). The accent stays cool so any warm
saturated hue is a genuine signal. Contrast floor 4.5:1; `--ink-faint`
exempt and never load-bearing.

## 4. Typography

Unchanged from v0.1. Two faces, bundled and self-hosted; a third is
forbidden.

- **IBM Plex Sans** 400/500/600/700 — prose, chrome, names, headings.
- **IBM Plex Mono** 400/500/600 — data, always `tabular-nums`.

| Role                     | Face / spec                                          |
| ------------------------ | ---------------------------------------------------- |
| `pageTitle`              | Plex Sans 600, 20px                                  |
| `sectionLabel` (eyebrow) | Plex Sans 700, 10px, `.18em`, uppercase, `--ink-dim` |
| `itemName`               | Plex Sans 600, 13px                                  |
| `body`                   | Plex Sans 400, 14px / 1.5                            |
| `bodyDense`              | Plex Sans 400, 13px                                  |
| `data`                   | Plex Mono 500, 12px                                  |
| `microData`              | Plex Mono 400, 11px                                  |
| `stateCode`              | Plex Mono 600, 10px, `.08em`, uppercase              |

Mono rule: timestamps, counts, durations, branches, git origins, tracker
IDs, and state codes are mono. (A stencil display face was considered for
the industrial voice and rejected: grit belongs to texture, not type.)

## 5. Shopwear — the texture layer

Grit is environmental, layered under or around content, always in the
neutral family, always subtle enough to survive a squint test. Four
utilities, in order of ubiquity:

| Utility      | Recipe                                                                                          | Where                                                        |
| ------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `--grain`    | SVG `feTurbulence` noise overlay, `opacity ≈ .08`, fixed, full-viewport, `pointer-events: none` | the whole app, always on                                     |
| `--vignette` | radial gradient darkening toward corners, `rgba(0,0,0,.40)` max                                 | canvas only — oil-stained edges                              |
| `--hatch`    | 45° hairline `repeating-linear-gradient`, `rgba(234,230,223,.065)` 1px / 9px                    | empty states, placeholder zones, archive panels              |
| `--hazard`   | 45° stripes `rgba(229,72,77,.08)` 10px/10px over `--raised`, 50%-alpha `sig-down` border        | destructive confirm zones ONLY (delete work, remove project) |

**Machined edge:** cards and raised surfaces carry
`box-shadow: inset 0 1px 0 rgba(255,255,255,.04)` — a milled top edge
catching light. This is the one permitted depth cue on chrome besides
`--shadow-overlay` (menus/dialogs). Still no drop shadows on cards and no
gradients as decoration.

**Only indicators emit light.** Glow is semantic, exactly as in Forge
(where only tally rails and health LEDs may emit): a `drop-shadow(0 0 4px
<signal> @ 55%)` halo is applied to signal-colored status dials, the
connection dot, and the mark's chip — and to nothing else. Neutral dials
(planned, wont-do) stay matte: unlit positions on the gauge. Buttons,
chips, text, and cards never glow. Under `prefers-contrast: more`, glow
turns off with the rest of Shopwear.

Rules: grain and vignette never exceed the stated opacities; hatch never
sits under body text; hazard is Forge's escalation grammar and is reserved
for destructive zones — never for blocked/awaiting states, which have their
own signals. Under `prefers-contrast: more`, all four utilities turn off.

## 6. Status dials

One circular grammar for all work states — a gauge that reads as positions
on a single dial, not seven unrelated icons. 16×16, 1.6px ring stroke,
drawn inline SVG with a text twin (`<title>` + adjacent state code).

| State                 | Dial                  | Construction                                            |
| --------------------- | --------------------- | ------------------------------------------------------- |
| planned               | dashed empty ring     | ring `--ink-dim`, `stroke-dasharray 2.5 2.6`            |
| active                | ring + quarter pie    | ring + wedge fill, both `--sig-info`                    |
| awaiting_verification | **full but unsealed** | dashed ring `--sig-warn` + solid core disc `--sig-warn` |
| blocked               | ring + bar            | ring `--sig-down` + horizontal bar (do-not-enter)       |
| completed             | solid stamped disc    | disc `--sig-ok`, check stroked in `--canvas`            |
| released              | open ring + check     | ring and check `--sig-ok`, hollow — it left the shop    |
| wont_do               | ring + slash          | ring and 45° slash `--ink-faint`                        |

The awaiting dial is the system's hinge: the work is _full_ (the claim
exists) but the ring is _dashed_ (unsealed) — the same dashed-equals-
unverified grammar as the Countersign. The Task finish rule seals the ring.

**Progress dials:** a task-level dial may fill as a pie of
`done / total` Steps — neutral `--rule` ring, `--sig-ok` wedge,
mono fraction beside it (`3/5`). The count records Step progress; it does not establish Task completion.
Step indicators stay matte and neutral, including Done.

Signal-colored dials carry the LED glow (`--glow-*`, §5) — they are lit
positions on the gauge. Planned and wont-do stay matte and unlit.

Dials pair with state chips (v0.1 spec unchanged: mono 600 · 10px ·
`.08em` · uppercase · radius 6 · 16% tint · 45%-alpha border · never a
pill) — dial in list rows, chip where space allows, never color alone.
Chips themselves never glow; the dial is the lamp, the chip is the label.

## 7. Signature — the Countersign

Unchanged in role from v0.1; sharpened by the dials: **circles are what
the machine reports; squares are what the human decides.**

Every subtask carrying an agent's `complete` claim renders a 14×14 stamp
slot beside its state chip: dashed `--ink-dim` border while **awaiting**
(the hole where the verification belongs — never amber; the emptiness is
the signal); fills `--tint-ok` + `--sig-ok` ✓ on **accept** (120ms stamp);
`--tint-down` + `--sig-down` ✕ on **reject**; dashed with a centered dim
dot on **defer**. No claim, no slot. The Attention lane is the column of
empty slots. Claims are mono (`agent · complete · 2h ago`); verdicts are
prose (`Accepted · 14:20`).

## 8. The Floor

The Floor is the home screen and ambient overview. One glance answers
**what needs me**, **what is moving or blocked**, and **what just happened**.
Task records own work state; T3 observations describe sessions independently.

### 8.1 Layout

Desktop: task cards on the left, a 300–440px attention sidecar on the right.
A compact masthead shows observation freshness. One summary row counts visible
projects' Active, Blocked and In review Tasks and Done today; observed working
sessions are explicitly labeled and de-duplicated by source/thread, not card.
Readable cards may scroll vertically; do not truncate active work to fit 1080p.

Phone: Needs you precedes the summary, project controls and one-column cards.
Recent changes follows the cards. Primary controls have at least 44px tap areas.
Project headings open project detail for editing; Task titles open existing Task
detail without triggering an opt-in human check dialog.

### 8.2 Project sections and Task cards

Group cards under project headings. Each card is one Task, keyed by Task ID:
title and ID, work-state label, recorded reason, optional Step counts, finish
condition, attributed handoff and a separate observed-session summary. Use an
article with a heading and a primary button; do not nest interactive controls.

Active and In review Tasks remain visible without a running session or a
Needs you item. Blocked Tasks use a red border and text, never hazard stripes.
Needs you uses amber with an explicit action label. Planned cards are compact
and dashed, initially four per project with an explicit reveal control. Backlog
remains available in project detail, with its count disclosed. Recently Done
starts collapsed and uses the same local-day rule as Done today, including
Tasks archived after completion.

Step counts exclude won't-do Steps and count released or completed Steps as
done. Zero-Step cards omit counts. Steps never determine Task completion. A
Done Task with open Steps says how many remain open without showing unfinished
Task progress. PR merges count only with evidence of reaching the default branch
in the current workflow epoch. Agent-finished, In review, opt-in human check,
Done and deployment remain distinct.

Cards sort by oldest attention item, Blocked, In review, Active and Planned,
then recorded priority and order. Session activity never determines ordering.
No position animation occurs when data updates.

### 8.3 Project visibility and observed sessions

The project strip toggles card sections and their summary counts. Hidden IDs
persist with `factory.floor.collapsed-bays.v1` so prior preferences survive.
Show all restores visibility. Each hidden project's chip retains its attention
count. Needs you stays global regardless of visibility and says so explicitly.

Linked sessions attach to every associated Task, de-duplicated inside the card
by source/thread. A shared session identifies its related Tasks but contributes
once to the observed-session count. Sessions linked to Planned Tasks remain
visible on those cards. Session state never replaces Task state.

Unmatched or ambiguous sessions appear under Sessions without a task; they are
not Tasks and cannot imply associations. Unknown agent identity stays neutral.
Missing, stale or unavailable source evidence says Session status unavailable,
rather than falsely saying no session was observed. Working indicators require
fresh source evidence; connection freshness and Task reports are separate.

### 8.4 Recorded handoffs

Prefer the current Task report's handoff. Otherwise use the newest handoff from
an unfinished, non-archived Step, with an additional-handoff count. Show next
owner, recorded action, reporter and report age. Handoffs are claims, not
dispatches. Omit the handoff when none was recorded; never infer a next action
from Step order, file counts, session activity or an estimated plan.

### 8.5 Sidecar

- **Needs you** is the global queue of actionable PR reviews, opt-in checks,
  decisions and human blockers, oldest first. REVIEW, CHECK and DECIDE use amber;
  UNBLOCK uses red. Routine Step reports and agent dependencies do not create
  requests. Tracking notes remain separate and uncounted. When empty, say
  Nothing needs you.
- **Recent changes** uses the latest twenty observed event sentences, newest
  first. It does not invent transition arrows or imply a complete history.
  Do not label it since your last visit without a persisted visit baseline.
- The previous duplicate scoreboard and per-project Counter are retired.
  Summary labels must distinguish Tasks, sessions and human requests.

### 8.6 What the Floor never does

No transcript bodies, file lists, model names or worktree paths. No milestones
without an explicit milestone model, estimated percentages, ETA promises,
automatic timeout decisions, dispatch, approval or completion writes.
Task cards navigate to the existing detail workflow. Sidebar actions open the
corresponding review/check/decision context. New project remains a disclosed,
permission-aware planning control.

## 9. Motion

Five animations, and no others:

| Animation             | Spec                                  | Where                       |
| --------------------- | ------------------------------------- | --------------------------- |
| countersign stamp     | 120ms ease-out scale 1.6→1            | slot on accept              |
| live report flash     | `--tint-info` → transparent, 400ms    | Ledger row, Shift Log row   |
| indeterminate spinner | 800ms linear                          | loading only                |
| working arc           | 2px `sig-info` arc, 1.6s linear orbit | worker token, working state |
| approval blink        | 1.2s `steps(2)` opacity 1→.35         | over-head `?` badge only    |

The active dial's wedge still does not rotate; the dial is a gauge and
the token is the thing that moves. Tokens do not travel between zones —
a state change re-renders the station in its new zone; a 200ms opacity
crossfade is permitted, position tweening is not. Reduced motion: flash
becomes a persistent `--sig-info` left border, the stamp is instant, the
arc becomes a static `sig-info` ring, and the badge does not blink.

## 10. Voice

Unchanged from v0.1: plain, calm, second person, no exclamation marks.
Agents **Report**; humans **Accept / Reject / Defer** — the vocabularies
never mix. `CONTEXT.md`'s controlled nouns and `_Avoid_` lists bind copy.
Empty states direct the next action; errors state what happened and what
to do.

## 11. The mark — the Countersigned F

Geometry unchanged from v0.1 (it already reads as stamped plate-work): an
F built as two record bars on a spine, with the detached countersign chip
right-aligned to the top bar. Bars `currentColor`; only the chip is
colored.

```svg
<svg viewBox="0 0 24 24" fill="none" role="img"
     aria-label="Factory mark — nothing awaiting verification">
  <rect x="4.5" y="3"    width="15"  height="3.5" rx="0.6" fill="currentColor"/>
  <rect x="4.5" y="3"    width="3"   height="18"  rx="0.6" fill="currentColor"/>
  <rect x="4.5" y="10.5" width="9"   height="3.5" rx="0.6" fill="currentColor"/>
  <rect x="16"  y="10.5" width="3.5" height="3.5" rx="1"   fill="#9499CB"/>
</svg>
```

Chip states (unchanged): static/brand `--accent`; live favicon `--sig-ok`
clear / `--sig-warn` attention pending / `--ink-faint` disconnected. Only
the chip takes color; text twin required; ship per-state favicon files
and swap the `<link>`.

**Two renditions — dimensional is the mark; flat is its small-size
utility form:**

- **Dimensional (primary)** — the brand mark, used everywhere ≥32px: app
  icon, mastheads, lockups, marketing, README. The F is stamped raised
  metal: bars fill with a vertical warm-ink gradient (`#F6F2EA →
#CEC6B8`) over a dark warm extrusion layer offset +3y in 128-scale
  (`#8A8172`), with a soft drop shadow onto the plate (`feDropShadow
dy 4, stdDeviation 5, opacity .5`). The chip is a **lit LED**: lavender
  gradient (`#B4B8E4 → #7F84B8`) with a `#9499CB` glow halo
  (`feDropShadow 0 0, stdDeviation 6, opacity .9`). Filter and offset
  values scale with the render size (at 24-grid: offset +0.75, shadow
  dy 1 / stdDeviation 1.25, glow stdDeviation 1.5). The chip is the only
  element that emits light; the F reflects it.
- **Flat (utility)** — the `currentColor` form above, sharing the same
  geometry. For chrome ≤24px, favicons, print, and greyscale. No
  gradients, no shadows; no glow below 24px (it turns to mud at favicon
  sizes).

**App icon (v0.2.1):** the dimensional mark on a `#141210` plate with an
**engraved border groove** (inset 1px stroke at `rgba(234,230,223,.10)`,
radius following the plate) and turbulence grain baked into the plate.
Machined plate with one lit indicator, not a sticker.
Source: `src/web/icon.svg`.

**Wordmark:** `FACTORY`, IBM Plex Sans 700, `.18em`, uppercase, mark at
left, 10px gap. Never recolor a letter; never box the mark.

## 12. Implementation wiring

1. **Token layer** — `:root` block below into `src/web/styles.css` +
   `color-scheme: dark`; migrate hexes (`#111827→--canvas`,
   `#0f172a→--panel`, `#172033→--raised`, `#334155→--rule`,
   `#38bdf8/#7dd3fc→--accent`); status pills → dials + chips (§6).
2. **Shopwear** — grain/vignette as fixed pseudo-elements on `body`;
   hatch/hazard utility classes; machined-edge on `.task-card`/panels.
3. **Fonts** — bundle Plex Sans + Plex Mono woff2 in `src/web/fonts/`,
   `@font-face`, register in `getStaticFile()` (`src/server.ts`), add to
   service-worker `appShell`.
4. **Logo** — `src/web/icon.svg` (done); header lockup in `main.tsx`;
   maskable 192/512 PNGs + apple-touch-icon; live-favicon swap driven by
   the attention projection. Sync `theme_color`/`background_color` to
   `#141210` in `index.html` + `manifest.webmanifest`.
5. **Cache** — bump service-worker cache name and `?v=` params in
   `index.html` / `main.tsx` together on any asset change.

```css
:root {
  color-scheme: dark;
  /* neutrals — oil & iron */
  --canvas: #141210;
  --panel: #1b1815;
  --raised: #24201b;
  --rule: #342e26;
  --ink: #eae6df;
  --ink-dim: #a2988a;
  --ink-faint: #635a4d;
  /* signals — family-wide */
  --sig-down: #e5484d;
  --sig-ok: #2fbe6b;
  --sig-warn: #f0b429;
  --sig-info: #4aa3e0;
  --tint-down: rgba(229, 72, 77, 0.16);
  --tint-ok: rgba(47, 190, 107, 0.16);
  --tint-warn: rgba(240, 180, 41, 0.16);
  --tint-info: rgba(74, 163, 224, 0.16);
  /* accent — house lavender */
  --accent: #9499cb;
  --on-accent: #141210;
  --tint-accent: rgba(148, 153, 203, 0.16);
  /* geometry */
  --u: 4px;
  --r-card: 10px;
  --r-field: 8px;
  --r-chip: 6px;
  --edge-machined: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  --shadow-overlay: 0 10px 24px rgba(0, 0, 0, 0.45);
  --shell: 1280px;
  /* LED glow — indicators only (dials, connection dot, mark chip) */
  --glow-down: drop-shadow(0 0 4px rgba(229, 72, 77, 0.55));
  --glow-ok: drop-shadow(0 0 4px rgba(47, 190, 107, 0.55));
  --glow-warn: drop-shadow(0 0 4px rgba(240, 180, 41, 0.55));
  --glow-info: drop-shadow(0 0 4px rgba(74, 163, 224, 0.55));
  --glow-accent: drop-shadow(0 0 4px rgba(148, 153, 203, 0.55));
}
```

6. **The Floor** — the `home` view in `main.tsx` receives authoritative
   snapshots through the human-authenticated `projects.floorUpdates`
   WebSocket subscription. Factory mutations invalidate the shared feed
   immediately. While viewers are subscribed, one server refresh loop
   checks T3 observations every five seconds and broadcasts activity,
   freshness, Task cards, Needs you, Recent changes and recorded counts together.
   Reconnecting viewers receive a fresh snapshot before actions are enabled.

### 12.1 Open decisions

- **Released vs Complete** — hollow-vs-stamped dial may make the chip
  distinction (§3 outline chip) redundant; revisit once dials are live.
- **Live favicon scope** — v1 or after the attention projection is
  push-driven.
- **Grain on low-end devices** — the fixed turbulence overlay should be
  measured on the phone before shipping app-wide; fall back to vignette
  only if it costs frames.
- **`button.primary`** — `main.tsx` references `.primary` which CSS never
  defined; define (accent fill) or remove in the token pass.
- **Legacy threads** — unmatched T3 threads from before Factory (26 in
  the Factory project alone) must not appear as idle tokens; the Floor
  should draw only sessions with a Work Association or a running turn.
