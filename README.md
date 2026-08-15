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

Ladder: **shrink → truncate → drop**, applied lowest-priority element first,
cumulative across the whole pool. "Reposition" isn't a separate step — every
attempt already regenerates all 4 candidates from scratch, so retrying *is*
repositioning.

- **Shrink**: collapse the element to its measured minimum size.
- **Truncate**: text-only. Geometry is already at its floor after shrink;
  this marks the element so the renderer shows an ellipsis and the scorer
  applies a small quality penalty.
- **Drop**: remove the element entirely and record why. **Never applied to
  a priority-1 element** — those can shrink to their floor as a last resort,
  but are never dropped from a successful layout.

If every legal degradation is exhausted and nothing still validates, the
resolver returns a typed `{ ok: false, reason: "no-valid-layout", ... }`
instead of forcing broken geometry.

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

## Testing

29 tests across 3 files, all passing:

- `tests/validate.test.ts` — 14 tests: spec/surface runtime validation.
- `tests/resolver.test.ts` — 13 tests: all 4 required surfaces, an unknown
  5th surface, a deliberately constrained surface (verifies branding drops
  before headline/hero), determinism, structural adaptation (portrait vs.
  broadcast vs. kiosk genuinely differ, not just scaled), and impossible
  input producing a typed failure.
- `tests/fuzz.test.ts` — 400 seeded-random surface profiles (width
  200–1920, height 120–1200, randomized safe area / `minTapTarget` /
  `minTextSize` / `viewingDistance` / `touchOnly`, 20% biased toward a tight
  low-end corner so genuinely impossible surfaces get exercised, not just
  hand-picked ones). Last run: **390 resolved, 10 typed failures, 0
  invariant violations.** A second test asserts the resolver never throws
  at the extremes of the fuzzed range.

## Known limitations

- No real DOM text measurement — sizes are estimated from character count
  and an average glyph-width factor, isolated to `measure.ts`. No wrapping;
  overflow is single-line ellipsis truncation only.
- Fixed element type set: `text`, `image`, `button`.
- No animated transition when switching surfaces.
- No Canvas renderer (bonus, not implemented) — though `ResolvedLayout` is
  renderer-agnostic by construction, so one could consume it without
  touching the resolver.
- Images are colored placeholder boxes with their `alt` text shown, not
  real assets.
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
ladder, the demo UI, and this documentation. Verified along the way with:
29 automated tests plus a 400-surface fuzz suite, a full
`grep -rn 'surface.id ===' src/` (and equivalents) hardcoding audit, and
manual visual verification by screenshotting the actual running demo
(headless-browser screenshots of all 4 required surfaces plus the
degradation demo) and fixing two real issues that surfaced only from
looking at it (a CSS input-overflow bug, and hero images not scaling with
available space).
