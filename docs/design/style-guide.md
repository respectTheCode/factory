# Factory Design System — "Ledger"

v0.2.1 · 2026-08-29 · dark-only · mobile-first · **clean records, dirty room**

Factory is the fifth design system in the family, after Beacon, Forge ("Tally
Console"), Grail, and Watchtower ("The Bridge"). Its language is called
**Ledger**: Factory is the house's own paperwork — a shop ledger in which
agent claims are recorded and wait for a human countersign. v0.2 gives the
ledger its room: a machine shop. The *records* stay clean — disciplined
layout, hairline rules, tokenized type. The *room* is dirty — warm oil-and-
iron neutrals, film grain, hatching, hazard stripes, machined edges. v0.2.1
turns the lights on: indicators (and only indicators) emit an LED glow, and
the mark gains a dimensional stamped-metal rendition with a lit chip.

Machinery appears as **material, never process**: stamped plates, gauge
dials, knurled textures, hazard paint. Conveyor belts, gears-as-workflow,
and pipeline diagrams remain forbidden — the product analysis is explicit
that Factory is a *run substrate, not a factory pipeline*.

Reference implementation: `docs/design/previews/factory-system.html`.
Mark study: `docs/design/previews/factory-marks.html`.

---

## 1. Position in the family

The family shares DNA at the semantic layer, never the component layer:

| Shared (verbatim) | Factory's own |
| --- | --- |
| Signal hexes `#E5484D / #2FBE6B / #F0B429 / #4AA3E0` | Oil-and-iron neutral ramp (§3) |
| House accent lavender `#9499CB` | Prose face: IBM Plex Sans (§4) |
| "Prose identifies; mono measures" (IBM Plex Mono) | Shopwear texture layer (§5) |
| 1px rules instead of shadows; base-4 spacing | Status dials (§6) |
| No fifth hue; color never the only signal | Signature: the Countersign (§7) |
| A mark whose one live element reports state | Mark: the Countersigned F (§10) |

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
2. **Claims are not facts.** An agent's status report is a claim; only a
   human verification makes it a fact. The two are never rendered alike.
3. **Amber means "your turn."** `sig-warn` marks work awaiting a human
   decision — attention, not failure. The dashboard exists to drain the
   amber column.
4. **Machinery is material, not process.** Dials, plates, hazard paint,
   stamps: yes. Gears, conveyors, robots, pipelines: never.
5. **Color is state, never decoration; never the only signal.** Four signal
   hues with fixed meanings; every dot, dial, and chip carries a mono text
   twin. Greyscale legibility is a release test.
6. **Phone first.** The ≤540px layout is the reference layout; tap targets
   ≥44px; the 1280px desktop shell is the adaptation.

## 3. Color

### Neutrals — oil & iron ramp (dark-only)

| Token | Hex | Use |
| --- | --- | --- |
| `--canvas` | `#141210` | page background; `theme-color`; manifest |
| `--panel` | `#1B1815` | panels, hero, sunken fields |
| `--raised` | `#24201B` | cards, secondary buttons, menus |
| `--rule` | `#342E26` | every 1px border and divider |
| `--ink` | `#EAE6DF` | primary text — warm paper-white |
| `--ink-dim` | `#A2988A` | secondary text, eyebrows, timestamps |
| `--ink-faint` | `#635A4D` | disabled, decorative only — never a needed value |

The whole ramp is warm: black with soot and oil in it, ink the color of a
shop traveler card. No light ramp exists (FR-043); `color-scheme: dark`
is declared at `:root`.

### Signals — family-wide hexes, Factory meanings

| Token | Hex | Factory meaning |
| --- | --- | --- |
| `--sig-down` | `#E5484D` | blocked; rejected; destructive actions; disconnected |
| `--sig-ok` | `#2FBE6B` | verified complete; released; accepted; connected |
| `--sig-warn` | `#F0B429` | awaiting verification; attention pending; stale/reconnecting |
| `--sig-info` | `#4AA3E0` | agent actively working; live-update flash |

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

| Role | Face / spec |
| --- | --- |
| `pageTitle` | Plex Sans 600, 20px |
| `sectionLabel` (eyebrow) | Plex Sans 700, 10px, `.18em`, uppercase, `--ink-dim` |
| `itemName` | Plex Sans 600, 13px |
| `body` | Plex Sans 400, 14px / 1.5 |
| `bodyDense` | Plex Sans 400, 13px |
| `data` | Plex Mono 500, 12px |
| `microData` | Plex Mono 400, 11px |
| `stateCode` | Plex Mono 600, 10px, `.08em`, uppercase |

Mono rule: timestamps, counts, durations, branches, git origins, tracker
IDs, and state codes are mono. (A stencil display face was considered for
the industrial voice and rejected: grit belongs to texture, not type.)

## 5. Shopwear — the texture layer

Grit is environmental, layered under or around content, always in the
neutral family, always subtle enough to survive a squint test. Four
utilities, in order of ubiquity:

| Utility | Recipe | Where |
| --- | --- | --- |
| `--grain` | SVG `feTurbulence` noise overlay, `opacity ≈ .08`, fixed, full-viewport, `pointer-events: none` | the whole app, always on |
| `--vignette` | radial gradient darkening toward corners, `rgba(0,0,0,.40)` max | canvas only — oil-stained edges |
| `--hatch` | 45° hairline `repeating-linear-gradient`, `rgba(234,230,223,.065)` 1px / 9px | empty states, placeholder zones, archive panels |
| `--hazard` | 45° stripes `rgba(229,72,77,.08)` 10px/10px over `--raised`, 50%-alpha `sig-down` border | destructive confirm zones ONLY (delete work, remove project) |

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

| State | Dial | Construction |
| --- | --- | --- |
| planned | dashed empty ring | ring `--ink-dim`, `stroke-dasharray 2.5 2.6` |
| active | ring + quarter pie | ring + wedge fill, both `--sig-info` |
| awaiting_verification | **full but unsealed** | dashed ring `--sig-warn` + solid core disc `--sig-warn` |
| blocked | ring + bar | ring `--sig-down` + horizontal bar (do-not-enter) |
| completed | solid stamped disc | disc `--sig-ok`, check stroked in `--canvas` |
| released | open ring + check | ring and check `--sig-ok`, hollow — it left the shop |
| wont_do | ring + slash | ring and 45° slash `--ink-faint` |

The awaiting dial is the system's hinge: the work is *full* (the claim
exists) but the ring is *dashed* (unsealed) — the same dashed-equals-
unverified grammar as the Countersign. Verification seals the ring.

**Progress dials:** a task-level dial may fill as a pie of
`verified / total` subtasks — neutral `--rule` ring, `--sig-ok` wedge,
mono fraction beside it (`3/5`). The pie only counts *verified* work;
claims don't move the needle.

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

## 8. Motion

Exactly three animations: countersign stamp (120ms ease-out), live report
flash (`--sig-info` → `--ink`, 400ms), one indeterminate spinner (800ms
linear). The active dial's wedge does not rotate. Reduced motion: flash
becomes a persistent `--sig-info` left border; the stamp is instant.

## 9. Voice

Unchanged from v0.1: plain, calm, second person, no exclamation marks.
Agents **Report**; humans **Accept / Reject / Defer** — the vocabularies
never mix. `CONTEXT.md`'s controlled nouns and `_Avoid_` lists bind copy.
Empty states direct the next action; errors state what happened and what
to do.

## 10. The mark — the Countersigned F

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

**Two renditions:**

- **Flat** — the canonical `currentColor` form above. Chrome, favicons,
  print, and any use ≤24px. The chip may carry the LED glow at ≥24px;
  below that it stays flat (glow turns to mud at favicon sizes).
- **Dimensional** — for the app icon and any use ≥32px: the F is stamped
  raised metal. Bars fill with a vertical warm-ink gradient
  (`#F6F2EA → #CEC6B8`), over a dark warm extrusion layer offset +3y
  (`#8A8172`), with a soft drop shadow onto the plate
  (`feDropShadow dy 4, stdDeviation 5, opacity .5`). The chip becomes a
  **lit LED**: lavender gradient (`#B4B8E4 → #7F84B8`) with a `#9499CB`
  glow halo (`feDropShadow 0 0, stdDeviation 6, opacity .9`; scale all
  filter values with the render size — the 24-grid rendition in
  `factory-marks.html` uses proportionally smaller ones). The chip is the
  only element that emits light; the F reflects it.

**App icon (v0.2.1):** the dimensional mark on a `#141210` plate with an
**engraved border groove** (inset 1px stroke at `rgba(234,230,223,.10)`,
radius following the plate) and turbulence grain baked into the plate.
Machined plate with one lit indicator, not a sticker.
Source: `src/web/icon.svg`.

**Wordmark:** `FACTORY`, IBM Plex Sans 700, `.18em`, uppercase, mark at
left, 10px gap. Never recolor a letter; never box the mark.

## 11. Implementation wiring

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
  --canvas: #141210; --panel: #1B1815; --raised: #24201B; --rule: #342E26;
  --ink: #EAE6DF; --ink-dim: #A2988A; --ink-faint: #635A4D;
  /* signals — family-wide */
  --sig-down: #E5484D; --sig-ok: #2FBE6B; --sig-warn: #F0B429; --sig-info: #4AA3E0;
  --tint-down: rgba(229,72,77,.16); --tint-ok: rgba(47,190,107,.16);
  --tint-warn: rgba(240,180,41,.16); --tint-info: rgba(74,163,224,.16);
  /* accent — house lavender */
  --accent: #9499CB; --on-accent: #141210; --tint-accent: rgba(148,153,203,.16);
  /* geometry */
  --u: 4px; --r-card: 10px; --r-field: 8px; --r-chip: 6px;
  --edge-machined: inset 0 1px 0 rgba(255,255,255,.04);
  --shadow-overlay: 0 10px 24px rgba(0,0,0,.45);
  --shell: 1280px;
  /* LED glow — indicators only (dials, connection dot, mark chip) */
  --glow-down: drop-shadow(0 0 4px rgba(229,72,77,.55));
  --glow-ok: drop-shadow(0 0 4px rgba(47,190,107,.55));
  --glow-warn: drop-shadow(0 0 4px rgba(240,180,41,.55));
  --glow-info: drop-shadow(0 0 4px rgba(74,163,224,.55));
  --glow-accent: drop-shadow(0 0 4px rgba(148,153,203,.55));
}
```

### 11.1 Open decisions

- **Released vs Complete** — hollow-vs-stamped dial may make the chip
  distinction (§3 outline chip) redundant; revisit once dials are live.
- **Live favicon scope** — v1 or after the attention projection is
  push-driven.
- **Grain on low-end devices** — the fixed turbulence overlay should be
  measured on the phone before shipping app-wide; fall back to vignette
  only if it costs frames.
- **`button.primary`** — `main.tsx` references `.primary` which CSS never
  defined; define (accent fill) or remove in the token pass.
