# Architecture

## Separation of concerns

```
spec.ts        — content + intent (elements, roles, priorities). No geometry.
surfaces.ts     — geometry + hard constraints for known presets. No layout.
validate.ts     — runtime validation (spec/surface) + candidate hard validation
                  + normalization. No decisions, only accept/reject.
measure.ts      — content → min/preferred size. Framework-independent.
strategies.ts   — content + rect → candidate geometry. Pure functions.
score.ts        — candidate → number. Deterministic, no side effects.
resolver.ts     — orchestrates all of the above + the degradation ladder.
                  The only file that makes a final decision.
render-dom.tsx  — ResolvedLayout → DOM. Makes zero decisions.
App.tsx         — demo chrome: picker, controls, trace panel. UI state only.
```

Each file only talks to the layer below it through plain data (`Rect`,
`MeasuredElement`, `LayoutCandidate`, `ResolvedLayout`) — no file reaches
sideways into another's internals. `resolver.ts` is the only place that knows
the full pipeline order; every other file is independently testable and
independently explainable.

None of `measure.ts`, `strategies.ts`, `validate.ts`, `score.ts`, or
`resolver.ts` imports React. The resolver is plain TypeScript, provable by
`tsconfig.app.json` never pointing at the DOM lib for those files' actual
usage — they'd compile equally well as a Node CLI tool.

## Hard constraints vs. soft preferences

**Hard constraints** (checked in `validate.ts`, a rejected candidate is
never scored, never repaired):
- every box inside the safe-area-adjusted rectangle
- no two visible boxes overlap
- no box below its measured minimum width/height
- no interactive box below `minTapTarget`
- positive width and height

**Soft preferences** (traded off by `score.ts`, never block a candidate):
- preferred element size vs. actual
- hero image aspect ratio vs. actual
- sensible (not maximal) use of available space
- keeping secondary/branding content visible rather than dropped

The line matters: a candidate that violates a hard constraint is deleted
from consideration before scoring ever runs. A candidate that merely scores
low is still a valid, renderable layout — it's just not the winner.

## Candidate generation

Four strategies, each a pure function `(MeasuredElement[], Rect) →
LayoutCandidate | null`:

- **`vertical-stack`** — every element stacked top-to-bottom in content
  order (hero, primary text, secondary text, action, branding), full
  available width. Wins on tall/narrow rectangles.
- **`horizontal-band`** — branding · hero · text-cluster · action as
  side-by-side columns. Wins on very wide/short rectangles.
- **`side-by-side-split`** — hero occupies one column, everything else
  stacked in the other. A middle ground that often wins on landscape phone
  aspect ratios.
- **`adaptive-grid`** — a 2-column grid in content order. Tends to win on
  near-square rectangles.

Critically: **all four run for every surface, every time.** There is no
`if (aspectRatio > X) useStrategy(Y)` anywhere. A strategy may produce
geometry that overflows the rectangle or violates a floor — that's expected
and by design; `validate.ts` is what rejects it, not the strategy itself.
Adaptation emerges from *which strategies survive validation and score well
against the actual rectangle*, not from a lookup table. This is what makes
`mobilePortrait` (320×480) resolve to `vertical-stack` and
`broadcastLowerThird` (1920×250) resolve to `horizontal-band` in the test
suite — not because anything asked "is this surface wide," but because
`vertical-stack`'s total height genuinely overflows a 250px-tall rectangle
and gets rejected, while `horizontal-band` genuinely fits it.

A strategy returns `null` (not broken geometry) when it can't produce a
sensible candidate at all — e.g. zero visible elements.

## Candidate validation

Validation happens in a separate pass from generation, on purpose:
strategies are allowed to be geometrically naive (clamp width down, compute
height from aspect ratio, done) because a single independent validator
enforces every hard rule consistently, regardless of which strategy
produced the candidate. This means adding a 5th strategy later requires
zero changes to what counts as "valid" — the rules live in exactly one
place (`validateCandidate` in `validate.ts`).

Rejected candidates carry a specific reason string (`"cta" falls outside
the safe-area bounds`, `"logo" overlaps "price"`), which is what powers the
resolver trace panel in the demo — every rejection is visible, not silent.

## Scoring

```ts
score =
    0.30 × priorityRetained        // Σ(1/priority) of visible ÷ Σ(1/priority) of all
  + 0.25 × heroShapeQuality        // 1 − normalized deviation from hero's preferred aspect ratio
  + 0.20 × preferredSizeSatisfaction // mean(min(actual/preferred, 1)) across visible elements
  + 0.15 × spaceUtilization        // min(usedArea/rectArea, 0.8) / 0.8
  − 0.10 × truncationPenalty       // fraction of visible elements marked truncated
```

(`score.ts`, `SCORE_WEIGHTS`.)

- **`priorityRetained`** is the largest term (0.30) because it directly
  encodes the assignment's core rule: keeping high-priority content visible
  matters more than any geometric quality. `1/priority` means priority-1
  content contributes far more than priority-3.
- **`heroShapeQuality`** (0.25) penalizes stretching/squashing the hero
  image away from its authored aspect ratio — a hero crammed into the wrong
  shape looks broken even if it technically fits.
- **`preferredSizeSatisfaction`** (0.20) rewards candidates that get closer
  to every element's natural preferred size, not just the bare minimum.
- **`spaceUtilization`** (0.15) is deliberately capped: `min(used, 0.8) /
  0.8` means a candidate using 80%+ of the rectangle scores the same as one
  using 100%. This exists specifically so scoring never rewards stretching
  content to fill space just to inflate the number — "uniform scaling
  passed off as adaptation" is exactly what the assignment warns against.
- **`truncationPenalty`** (−0.10, the only negative term) is a small tie-breaker
  that prefers a non-truncated candidate over an otherwise-similar
  truncated one, without dominating the priority-retained term.

Weights are declared once, together, in `SCORE_WEIGHTS` — not scattered as
inline magic numbers through the scoring functions.

## Degradation

`resolver.ts` builds a `degradeOrder`: every element sorted by priority
descending (lowest priority first), ties broken by id for determinism. It
then walks that order and, per element, tries in sequence:

1. **shrink** — set preferred size to measured minimum, retry full
   candidate generation.
2. **truncate** (text only) — mark the element truncated (affects
   rendering + score), retry.
3. **drop** (skipped entirely for priority-1 elements) — remove the
   element, record why, retry.

State is cumulative: an element shrunk in one pass stays shrunk while the
next lower-priority element is degraded. This is why "reposition" isn't a
separate rung in the code — every retry already regenerates all 4
candidates from scratch against the (now smaller) pool, which *is*
repositioning.

Priority-1 elements go through the same loop and can shrink, but the drop
branch is unconditionally skipped for them — enforcing "priority-1 never
drops from a successful layout" structurally, not by convention.

## Failure semantics

If the degrade loop exhausts every element (all lower-priority content
shrunk/truncated/dropped, priority-1 content shrunk to its floor) and still
nothing validates, `resolveLayout` returns:

```ts
{ ok: false, reason: "no-valid-layout", message: "...", details: string[] }
```

instead of ever emitting geometry that overlaps, clips, or violates a
floor. The same typed-failure path (`ResolveResult`) also covers
`invalid-spec` and `invalid-surface` for malformed input, caught before any
layout attempt runs. A caller can exhaustively `switch` on `reason` and the
compiler will hold them to it.

## Extensibility

- **New surface**: pass any `SurfaceProfile` to `resolveLayout`. Nothing in
  the resolver, strategies, or validator references surface identity —
  proven by the "unknown 5th surface" test and by the demo's "Custom /
  unseen 5th surface" control, which is just user input flowing into the
  exact same function.
- **New renderer (e.g. Canvas)**: consumes `ResolvedLayout` — an array of
  `{ id, x, y, width, height }` boxes plus metadata. A Canvas renderer would
  read the same structure `render-dom.tsx` does and draw instead of
  positioning DOM nodes. Zero resolver changes.
- **Broadcast safe area**: already modeled — `SurfaceProfile.safeArea`
  becomes the available-rectangle transformation every strategy operates
  within. A wider broadcast safe area is just a different `SafeArea` value.
- **Print bleed**: would model as the same kind of constraint — a
  bleed/trim/safe-content transformation feeding the same "available
  rectangle" concept the resolver already consumes. No new layout path
  needed, only a new way to compute `Rect` from a print-oriented profile.

## One deliberate non-rule-violation worth flagging

`src/App.css` has a single `@media (max-width: 1000px)` query. It stacks
the demo's own three control panels (surface picker / preview / trace) on
narrow browser windows. It is UI chrome for *this repository's demo
harness*, not the ad layout engine — every ad element's position comes from
inline styles computed directly from `ResolvedBox` coordinates in
`render-dom.tsx`, completely independent of viewport size or any media
query. The assignment's "no media-query layout engine" rule is about how
the *ad* is composed, and this query never touches that.
