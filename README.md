# Adaptive Layout Engine for Multi-Surface Ads

One declarative ad spec, resolved live against arbitrary surface constraints by a
constraint-based TypeScript engine. No per-surface layout branches, no media
queries deciding what goes where.

```
Ad Spec + Surface Profile → validate + normalize → measure active content
→ generate Stack/Split/Band/Poster → repair → hard validate → score
→ winner (or degrade + retry) → ResolvedLayout → renderer
```

## Setup

```bash
npm install
npm run dev           # demo at http://localhost:5173
npm test              # unit + checkpoint + repair + score + continuity + fuzz suites
npm run test:browser  # Playwright layout/accessibility/screenshots (Chromium)
npm run build         # typecheck + production build
npm run typecheck     # tsc only, no emit
```

## Running the demo

A **checkpoint gallery** at the top of the page renders the five canonical
surfaces (plus two unseen/impossible stress surfaces) through the real
resolver and renderer, at native scale, for at-a-glance verification.

Below it, pick one of the five presets from the picker — **Mobile
Portrait**, **Mobile Landscape**, **Broadcast Lower-Third**, **Square
Kiosk**, or **Constrained Strip** — or **Custom / unseen 5th surface** to
type in an arbitrary profile (width, height, min tap target, min text size,
viewing distance, touch-only, safe area) and watch it resolve through the
exact same resolver, live.

Drag the width/height sliders on any preset to resize continuously and
watch the resolver output panel on the right: strategy chosen, score,
per-candidate diagnostics for the winning rung, omitted elements,
degradation actions, and a full step-by-step trace of every rung tried.
Dragging also exercises the continuity/hysteresis path — the resolver keeps
the current strategy unless a challenger clearly wins, so a slow drag
doesn't flicker between two near-tied compositions.

## Resolution flow

```
Ad Spec + Surface Profile
        ↓ validate + normalize (src/validate.ts)
Measured elements
        ↓ measure.ts — min/preferred size + shared sizing formulas
Raw candidates (4 strategies, src/strategies.ts)
        ↓ repair.ts — grow toward target proportions, reserve hard minimums
Repaired candidates
        ↓ validate.ts — bounds, overlap, size floors, tap target, font floor,
        ↓               genuine text fit, hero aspect/crop consistency
Valid candidates
        ↓ score.ts — weighted scoring
Best candidate  → if none valid → degrade (resolver.ts) → retry
        ↓
ResolvedLayout (typed, geometry + presentation state)
        ↓
render-dom.tsx — paints boxes, decides nothing
```

## Layout algorithm

1. **Normalize** the surface: fill in every optional constraint with an
   explicit default, and reduce the surface to an *available rectangle*
   (surface minus safe area).
2. **Measure** every element's min/preferred size, driven by role and
   surface constraints — not surface identity.
3. **Generate candidates**: all four strategies — `stack`, `split`, `band`,
   `poster` — run every time, for every surface. None inspects surface
   identity or an aspect-ratio threshold; each is a role-aware pure
   function of the available rectangle. See [ARCHITECTURE.md](ARCHITECTURE.md)
   for exactly what each one builds.
4. **Repair** each raw candidate deterministically: reserve hard minimums,
   then grow it toward its strategy-specific target proportions (Split's
   CTA fill, Band's hero-absorbs-slack, Poster's hero width, Stack's
   re-centering) — repair can only improve soft geometry, never relax a
   hard rule.
5. **Validate** the repaired candidate against hard constraints — bounds,
   overlap, size floors, tap target, font floor, genuine active-text fit,
   hero aspect/crop consistency. Invalid candidates are rejected with a
   specific reason, never silently patched.
6. **Score** the surviving candidates with a deterministic weighted formula
   and keep the highest score.
7. If **nothing validates**, degrade and retry (next section).

## Priority and degradation

A **fixed sequence**, not per-priority-tier grouping — every rung reruns
all four strategies against the mutated pool:

```
A. full content, default gap
B. full content, compact gap
C. brand hidden
D. price -> compact
E. CTA -> compact
F. price may drop
G. hero -> crop, then shrink
H. headline -> compact
I. no-valid-layout
```

**CTA is never dropped** — if it can't coexist with a priority-1 element,
resolution fails rather than dropping it. Priority-1 elements (headline,
hero) can change presentation (compact, cropped, shrunk) but are never
omitted from a successful layout.

If every rung is exhausted and nothing still validates, the resolver
returns a typed `{ ok: false, reason: "no-valid-layout", ... }` instead of
forcing broken geometry.

## TypeScript design

- `AdElement` is a discriminated union on `type` (`text | image | button`),
  so each variant carries exactly the fields it needs and the compiler
  narrows automatically.
- `SurfaceProfile` (as authored, optional fields) is kept separate from
  `NormalizedSurfaceProfile` (every constraint explicit) — the resolver only
  ever sees the normalized form.
- `ResolvedLayout` and `ResolutionFailure` are both fully typed and
  returned as a discriminated `ResolveResult`, so a caller can't
  accidentally read `.boxes` off a failed resolution.
- `ContentVariant` is a plain `"full" | "compact"`. `ElementPresentation`
  (`variant`/`visible`/`cropped`/`fontSize`) lives directly on every
  `ResolvedBox`, so `render-dom.tsx` reads active state straight off the
  resolved layout instead of scanning `degradations[]` to infer it.
- `ContinuityHint` is an additive third parameter to `resolveLayout` — a
  live resize can smooth strategy/content switching without changing the
  pure, deterministic one-shot signature every test relies on.
- Everything above is compile-time. Because specs and surfaces can also
  arrive dynamically (a live 5th surface, JSON from a CMS), `validate.ts`
  re-checks every constraint at runtime.

## Testing

74 Node/vitest tests across 9 files, plus 12 Chromium Playwright tests:

- `tests/validate.test.ts` (14) — spec/surface runtime validation.
- `tests/resolver.test.ts` (13) — all 4 required surfaces, an unknown 5th
  surface, a deliberately constrained surface, determinism, structural
  adaptation across aspect ratios, and impossible input producing a typed
  failure.
- `tests/checkpoints.test.ts` (5) — the five canonical checkpoints from
  `src/checkpoints.ts`, asserting strategy choice and the spec's structural
  targets (hero share/area ranges, CTA fill range, x-ordering, font floors)
  with tolerances, not exact-pixel snapshots.
- `tests/repair.test.ts` (7) — hard-minimum reservation, the
  never-drops-a-box invariant, and each strategy's own repair rule
  (Split's CTA growth, Band's gap-to-hero reclaim, Poster's hero growth).
- `tests/score.test.ts` (9) — priority retention, the hero prominence
  curve's mid-range peak, the dead-region penalty's center-third check,
  crop/degradation penalties, and score bounds.
- `tests/degradation-ladder.test.ts` (7) — each real rung boundary
  (brand hides alone, price+CTA compact together, price drops while CTA
  survives compact, hero crop/headline compact only as a last resort),
  found by sweeping real surfaces rather than hand-waved examples.
- `tests/continuity.test.ts` (8) — genuine strategy adaptation across an
  aspect-ratio path, no local A→B→A oscillation, ±24px neighborhood
  stability around each checkpoint, and additive-only hint verification.
- `tests/composition.test.ts` (9) — extreme aspect ratios, clean failure at
  the minimum, and exploratory profiles outside the five checkpoints.
- `tests/fuzz.test.ts` (2) — 1000 seeded-random surfaces (80–2200 ×
  80–1400, biased toward tight/ultra-wide/ultra-tall/large-safe-area/
  high-floor corners). Last run: **923 resolved, 77 typed failures, 0
  invariant violations.**
- `e2e/composition.spec.ts` + `tests/browser/*.spec.ts` (12) — real
  Chromium checks: required presets resolve to their canonical strategy,
  live 1920×120 resizing, actual `CanvasRenderingContext2D.measureText()`
  calls, zero undeclared text overflow, the CTA's visible label as its own
  accessible name, and the checkpoint gallery rendering through the real
  resolver with no console errors.

Install the browser once with `npx playwright install chromium`, then run
`npm run test:browser`. Its HTML report and visual-review attachments are
written to `playwright-report/`.

## Known limitations

- Text width uses real `CanvasRenderingContext2D.measureText()` wherever a
  canvas is available (any real browser), falling back to a character-count
  estimate only in Node (the test/fuzz suite), isolated to `measure.ts`. No
  wrapping — a box that can't fit its text at any legal font size fails
  validation rather than wrapping or silently clipping.
- Fixed element type set: `text`, `image`, `button`.
- Live resize hysteresis is a scoring-margin heuristic
  (`STRATEGY_SWITCH_MARGIN`/`CONTENT_RESTORE_MARGIN`), not an animated
  transition between surfaces.
- No Canvas renderer (bonus, not implemented) — though `ResolvedLayout` is
  renderer-agnostic by construction, so one could consume it without
  touching the resolver.
- Images are placeholder boxes with their `alt` text shown, not real
  assets — including the hero's "cropped" state, which only changes the
  aspect ratio fed into the geometry, not an actual image crop.
- Scoring weights and the sizing formulas are reasoned heuristics
  documented in `score.ts`/`measure.ts`, not empirically tuned against a
  large corpus of real ad creative.

## Time spent

_Fill in before submitting — this is your actual wall-clock time across the
whole assignment (spec reading, review, iteration), not just the time Claude
Code spent generating code._

## AI tool disclosure

Built with **Claude Code** (Anthropic, Sonnet 5) end-to-end across two major
passes: the original Phase 1–4 build (types, resolver, degradation ladder,
demo UI, initial docs), and a subsequent full refactor to the locked final
contract — new Stack/Split/Band/Poster strategy set, a deterministic repair
stage, a rewritten scoring model, a simplified fixed-sequence degradation
ladder, typed diagnostics, continuity/hysteresis, and five canonical
checkpoints with dedicated Node and Playwright coverage.

Verified throughout with: 74 Node/vitest tests, 12 Chromium Playwright
tests, a 1000-surface fuzz suite, a full `grep -rn 'surface.id ===' src/`
(and equivalents) hardcoding audit, and repeated manual visual verification
by screenshotting the actual running demo — not just once at the end. That
process caught several real bugs only visible from actual pixels or actual
score numbers, each fixed at its root:

- A strategy silently omitting the hero from a candidate (returning
  `boxes.length > 0 ? {...} : null` instead of `null`) when it had nowhere
  legal to place it, instead of rejecting the whole candidate — this could
  let a priority-1 element vanish from a "successful" layout. Fixed by
  returning `null` for the whole candidate whenever a required element has
  no legal placement.
- `sizeText`'s width being clamped to an available budget without adjusting
  its font size, producing a box the active text couldn't actually fit in
  once brand/hero shared its row — fixed by making `sizeText` shrink its
  own font toward `minTextSize` until the content genuinely fits `maxWidth`,
  instead of silently narrowing the box independent of what it needs.
- Hero prominence scoring monotonically-increasing-then-capped meant an
  edge-to-edge `stack` hero on the square kiosk out-scored the intended
  hero-dominant-but-framed `poster` — both hit the cap and stopped being
  differentiated. Fixed by making prominence peak mid-range (like
  `frameUsage` already did) instead of at the ceiling.
- `deadRegionPenalty`'s left/right and top/bottom half checks missed a
  composition that pushes all content to the far edges with a hollow,
  empty middle (each half still has *some* content near its own edge).
  Fixed by adding a direct center-third coverage check.
- My own invariant-check test helper enforced hero-only aspect-lock rules
  against *every* image, including branding — which is deliberately sized
  as a compact wordmark box, not a proportional image — producing false
  positives across the fuzz suite. Fixed by scoping the check to the hero
  role only, matching `validate.ts`'s own hard-check scope.
