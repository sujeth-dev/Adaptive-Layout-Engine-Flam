# Adaptive Layout Engine for Multi-Surface Ads

One declarative ad spec, resolved live against arbitrary surface constraints by a
constraint-based TypeScript engine. No per-surface layout branches, no media
queries deciding what goes where.

```
Ad Spec + Surface Profile → Normalize → Measure → Generate candidates
→ Validate → Score → Degrade if needed → Resolved Layout → Renderer
```

## Setup

```bash
npm install
npm run dev        # demo at http://localhost:5173
npm test           # unit + invariant + fuzz suites
npm run build      # typecheck + production build
npm run typecheck  # tsc only, no emit
```

## Running the demo

Pick one of the 4 required surfaces from the picker, or **Constrained
(degradation demo)** to see priority-based degradation kick in immediately.
**Custom / unseen 5th surface** lets you type in an arbitrary profile —
width, height, min tap target, min text size, viewing distance, touch-only,
safe area — and watch it resolve through the exact same resolver, live.

Drag the width/height sliders on any preset to shrink the surface further and
watch the resolver output panel on the right: strategy chosen, score, omitted
elements, degradation actions, and a full step-by-step trace of every
candidate that was tried and why it was accepted or rejected.

## Resolution flow

```
Ad Spec + Surface Profile
        ↓ validate + normalize (src/validate.ts)
Measured elements
        ↓ measure.ts — min/preferred size per element
Candidate layouts (×4 strategies, src/strategies.ts)
        ↓ validate.ts — bounds, overlap, size floors, tap target
Valid candidates
        ↓ score.ts — weighted scoring
Best candidate  → if none valid → degrade (resolver.ts) → retry
        ↓
ResolvedLayout (typed, geometry only)
        ↓
render-dom.tsx — paints boxes, decides nothing
```

## Layout algorithm

1. **Normalize** the surface: fill in every optional constraint (safe area,
   min tap target, min text size, viewing distance) with an explicit default,
   and reduce the surface to an *available rectangle* (surface minus safe area).
2. **Measure** every element: min/preferred width and height, driven by role
   and surface constraints — not by surface identity. A far-viewing-distance
   or high-`minTextSize` surface raises the effective font floor for *every*
   text element; `minTapTarget` floors button geometry; hero images size
   themselves as a budget of the available rectangle (see
   [ARCHITECTURE.md](ARCHITECTURE.md) for why).
3. **Generate candidates**: all 4 strategies (`vertical-stack`,
   `horizontal-band`, `side-by-side-split`, `adaptive-grid`) run
   unconditionally, every time, for every surface. None of them inspects
   surface identity or an aspect-ratio threshold — they're pure geometric
   compositions over the available rectangle and the measured elements.
4. **Validate** each candidate against hard constraints: every box inside
   the safe area, no two boxes overlapping, no box below its measured
   minimum, no interactive box below `minTapTarget`. Invalid candidates are
   rejected with a specific reason, never silently repaired.
5. **Score** the surviving candidates with a deterministic weighted formula
   (below) and keep the highest score.
6. If **nothing validates**, degrade and retry (next section).

## Priority and degradation

Elements are grouped into **priority tiers** and processed lowest-priority-
tier-first. One rung runs once, globally; the rest run per tier:

0. **Compact spacing** (once, globally): retry with a tighter gap
   (`14px → 10px → 6px`) before touching any element's content or geometry.
1. **Merge** (declared button targets only): if the spec declares an
   `ElementMerge` — e.g. fold `price` into `cta` as "Buy $30" — try it,
   never for a priority-1 source.
2. **Shorten**: switch to a `shortContent`/`shortLabel` variant, if declared.
3. **Iconify** (buttons only): collapse to an `icon` glyph, if declared.
4. **Shrink**: collapse the element to its measured minimum size.
5. **Truncate** (text only): geometry is already at its floor after shrink;
   marks the element so the renderer shows an ellipsis and the scorer
   applies a small quality penalty.
6. **Crop** (hero images only): switch to a tighter `croppedAspectRatio`,
   if declared.
7. **Drop**: remove the element entirely and record why. **Never applied to
   a priority-1 element** — those can shorten/shrink/truncate/crop as a
   last resort, but are never dropped from a successful layout.

"Reposition" isn't a separate step anywhere in this ladder — every attempt
already regenerates all 4 candidates from scratch, so retrying *is*
repositioning. Rungs 1–3 and `croppedAspectRatio`/`merges` are entirely
**optional, additive fields** on the spec — a spec that declares none of
them degrades exactly as rungs 4/5/7 alone always did.

If every legal degradation is exhausted and nothing still validates, the
resolver returns a typed `{ ok: false, reason: "no-valid-layout", ... }`
instead of forcing broken geometry. See ARCHITECTURE.md's "Degradation"
section for how the resolver keeps the reported `degradations[]` honest
even when an element is silently left in a degraded state by a rung whose
own attempt didn't succeed.

## TypeScript design

- `AdElement` is a discriminated union on `type` (`text | image | button`),
  so each variant carries exactly the fields it needs and the compiler
  narrows automatically — a button can't compile without a `label`.
- `SurfaceProfile` (as authored, optional fields) is kept separate from
  `NormalizedSurfaceProfile` (every constraint explicit) — the resolver only
  ever sees the normalized form, so it never null-checks a constraint.
- The resolved output (`ResolvedLayout`) and the failure path
  (`ResolutionFailure`) are both fully typed and returned as a
  discriminated `ResolveResult`, so a caller (or a test) can't accidentally
  read `.boxes` off a failed resolution.
- Everything above is compile-time. Because specs and surfaces can also
  arrive dynamically (a live 5th surface, JSON from a CMS), `validate.ts`
  re-checks every constraint at runtime: duplicate ids, non-positive
  priorities/dimensions, negative or surface-exceeding safe areas.
- Content-variant degradation is additive to the same discriminated union,
  not a parallel type: `shortContent` on `TextElement`, `shortLabel`/`icon`
  on `ButtonElement`, `croppedAspectRatio` on `ImageElement` are all
  optional fields, and `AdSpec.merges` is an optional array of a small,
  fully generic `ElementMerge` shape (`sourceIds`/`targetId`/`mergedLabel`).
  A spec that declares none of them type-checks and behaves identically to
  one written before this feature existed.

## Testing

35 tests across 4 files, all passing:

- `tests/validate.test.ts` — 14 tests: spec/surface runtime validation.
- `tests/resolver.test.ts` — 13 tests: all 4 required surfaces, an unknown
  5th surface, a deliberately constrained surface (verifies branding drops
  before headline/hero), determinism, structural adaptation (portrait vs.
  broadcast vs. kiosk genuinely differ, not just scaled), and impossible
  input producing a typed failure.
- `tests/degradation-ladder.test.ts` — 6 tests: content-variant rungs
  (shorten/merge/iconify) fire before priority-1 content is ever touched,
  a merged element is reported as `merge` (not `drop`) with the source
  correctly omitted, an icon-only button's measured floor never drops below
  `minTapTarget`, the global spacing-compaction rung resolves a surface on
  its own before any content degrades (and never fires needlessly when the
  default gap already fits), and a sanity check on the text-measurement
  fallback path.
- `tests/fuzz.test.ts` — 400 seeded-random surface profiles (width
  200–1920, height 120–1200, randomized safe area / `minTapTarget` /
  `minTextSize` / `viewingDistance` / `touchOnly`, 20% biased toward a tight
  low-end corner so genuinely impossible surfaces get exercised, not just
  hand-picked ones). Last run: **391 resolved, 9 typed failures, 0
  invariant violations.** A second test asserts the resolver never throws
  at the extremes of the fuzzed range.

No component/DOM-rendering test harness exists in this project (no
`@testing-library/react`, no jsdom — `vite.config.ts` runs tests under
`environment: "node"`). Two things that are consequently verified by code
review and manual browser check rather than an automated test: the
icon-only button's `aria-label` (render-dom.tsx), and the real
`CanvasRenderingContext2D.measureText()` path in `measure.ts` (only the
Node fallback estimate is exercised by the automated suite).

## Known limitations

- Text width uses real `CanvasRenderingContext2D.measureText()` against
  the same font family/weight the CSS renders, wherever a canvas is available
  (any real browser). It falls back to a character-count estimate only in
  environments without one (Node — the test/fuzz suite), isolated to
  `measure.ts`. No wrapping; overflow is single-line ellipsis truncation only.
- Fixed element type set: `text`, `image`, `button`.
- No animated transition when switching surfaces.
- No Canvas renderer (bonus, not implemented) — though `ResolvedLayout` is
  renderer-agnostic by construction, so one could consume it without
  touching the resolver.
- Images are colored placeholder boxes with their `alt` text shown, not
  real assets — including the hero's "cropped" state, which only changes
  the aspect ratio fed into the geometry, not an actual image crop.
- Content-variant degradation (`shortContent`/`shortLabel`/`icon`/
  `croppedAspectRatio`/`merges`) is entirely spec-declared and optional; the
  demo spec (`spec.ts`) populates all of it to demonstrate the fuller
  ladder, but the resolver places no requirement on any spec to use it.
- The space-utilization score term intentionally caps below full occupancy
  (see ARCHITECTURE.md) — on a very large surface with only 5 elements,
  the resolver will leave visible empty space rather than stretch content
  to fill it, which is a deliberate choice but can look sparse.
- Scoring weights and the hero size budget are reasoned heuristics
  documented in `score.ts`/`measure.ts`, not empirically tuned.

## Time spent

_Fill in before submitting — this is your actual wall-clock time across the
whole assignment (spec reading, review, iteration), not just the time Claude
Code spent generating code._

## AI tool disclosure

Built with **Claude Code** (Anthropic, Sonnet 5) end-to-end: type design,
the resolver algorithm, candidate strategies, scoring, the degradation
ladder (including the later content-variant/merge/spacing-compaction
extension), the demo UI, and this documentation. Verified along the way
with: 35 automated tests plus a 400-surface fuzz suite, a full
`grep -rn 'surface.id ===' src/` (and equivalents) hardcoding audit, and
repeated manual visual verification by screenshotting the actual running
demo with a headless browser — not just once at the end. That process
caught several real bugs that only surfaced from looking at actual pixels,
each fixed at its root rather than patched around:

- A CSS input-overflow bug and hero images not scaling with available space
  (early pass).
- The CTA button wrapping onto two lines inside a fixed-height pill,
  because `render-dom.tsx` derived its rendered font size independently
  from `measure.ts`'s width calculation instead of sharing one function —
  fixed by extracting `buttonFontSize()` as the single source of truth both
  files call.
- The headline showing an unwanted `text-overflow: ellipsis` on surfaces
  the resolver reported as fully resolved with zero degradation, because
  the character-count width estimate had no safety margin against real
  browser font metrics — fixed by measuring real text width via
  `CanvasRenderingContext2D.measureText()` wherever a canvas is available.
- A button rendered its merged text ("Buy $30") instead of its icon glyph
  even though its box was measured for the icon — caught only by screenshotting
  a real constrained scenario where both a merge and an iconify applied to
  the same button — fixed by making render precedence match measurement
  precedence exactly (icon wins over merge wins over shorten).
- The fuzz suite's own invariant checker produced false "below floor"
  violations once content-variant degradation was exercised, because it
  assumed an element's rendered content matched the resolver's single most
  recent degradation record — several elements could carry multiple
  simultaneous records (e.g. merged *and* iconified), and a naive `Map`
  keyed by id silently collapsed them to one. Fixed by having every
  consumer of `degradations[]` look up by action category, not id alone,
  and by making the resolver reconstruct the full picture via a diff
  against initial pool state rather than recording only "the rung that
  happened to succeed."
