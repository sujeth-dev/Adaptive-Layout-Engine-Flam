# Architecture

## Separation of concerns

```
spec.ts        — content + intent (elements, roles, priorities). No geometry.
surfaces.ts     — geometry + hard constraints for known presets. No layout.
validate.ts     — runtime validation (spec/surface) + candidate hard validation
                  + normalization. No decisions, only accept/reject.
measure.ts      — content → min/preferred size + shared sizing formulas.
strategies.ts   — content + rect → raw candidate geometry. Pure functions.
repair.ts       — raw candidate → geometry that fits its target proportions.
                  Can only improve soft geometry, never relax a hard rule.
score.ts        — candidate → number. Deterministic, no side effects.
resolver.ts     — orchestrates all of the above + the degradation ladder.
                  The only file that makes a final decision.
checkpoints.ts  — the five canonical checkpoint definitions. Golden test
                  data only — never imported by an engine file.
render-dom.tsx  — ResolvedLayout → DOM. Makes zero decisions.
App.tsx         — demo chrome: picker, controls, trace panel. UI state only.
```

Each file only talks to the layer below it through plain data (`Rect`,
`MeasuredElement`, `LayoutCandidate`, `ResolvedLayout`) — no file reaches
sideways into another's internals. `resolver.ts` is the only place that knows
the full pipeline order; every other file is independently testable and
independently explainable.

None of `measure.ts`, `strategies.ts`, `repair.ts`, `validate.ts`, `score.ts`,
or `resolver.ts` imports React. The resolver is plain TypeScript, provable by
`tsconfig.app.json` never pointing at the DOM lib for those files' actual
usage — they'd compile equally well as a Node CLI tool.

## Final target flow

```
Ad Spec + Surface Profile
      ↓
validate + normalize
      ↓
measure active content
      ↓
generate Stack / Split / Band / Poster
      ↓
repair candidate geometry
      ↓
hard validate
      ↓
score valid candidates
      ↓
winner
      ↓
if none fits: apply next priority degradation, rerun all four
      ↓
ResolvedLayout
      ↓
DOM renderer
```

The five known surfaces (`checkpoints.ts`) are golden verification points
only — the resolver never reads a checkpoint id or dimension.

## Hard constraints vs. soft preferences

**Hard constraints** (checked in `validate.ts`, a rejected candidate is
never scored):
- every box inside the safe-area-adjusted rectangle
- no two visible boxes overlap
- no box below its measured minimum width/height
- no interactive box below `minTapTarget`
- positive width and height
- resolved font size at or above `minTextSize`
- the active full/compact text genuinely fits its resolved box at its
  resolved font size — no silent renderer ellipsis
- the hero's resolved aspect ratio matches whichever declared aspect
  (original or cropped) is currently active — geometry may shrink, the
  image never stretches or squashes

**Soft preferences** (traded off by `score.ts`, never block a candidate):
- priority-weighted content retention
- frame usage (peaks mid-range, not at 100% occupancy)
- hero aspect fidelity and prominence (also peaks mid-range)
- opposing-edge visual balance
- preferred element size vs. actual
- gap consistency, semantic hierarchy, and edge/origin alignment
- dead-region avoidance, degradation, crop, and excessive-enlargement penalties

The line matters: a candidate that violates a hard constraint is deleted
from consideration before scoring ever runs. A candidate that merely scores
low is still a valid, renderable layout — it's just not the winner.

## Candidate generation

Four strategies, each a pure function `(MeasuredElement[], Rect, gap,
NormalizedSurfaceProfile) → LayoutCandidate | null`. **All four run for every
surface, every time** — there is no `if (aspectRatio > X) useStrategy(Y)`
anywhere. Each strategy is role-aware (looks up `"primary"`/`"hero"`/
`"secondary"`/`"action"`/`"branding"`, never a specific element id) and
produces exactly one raw, structurally-correct candidate; `repair.ts` is
responsible for growing it toward its target proportions, not this file.

- **`stack`** — top region: headline + a reserved brand slot. Bottom region:
  price + CTA. Hero: the entire legal middle remainder, spanning the full
  rect width (not padding-inset — it's the one element with no legibility
  margin to protect). Wins on tall/narrow rectangles.
- **`split`** — left column: headline, then price+CTA commerce centered in
  the remaining height. Right column: a reserved brand slot, then hero
  filling the rest (bleeding to the rect's own right/bottom edges). Hero
  targets 56% of rect width (48–60% after repair); CTA targets 86% of the
  copy column's width. Wins on landscape phone aspect ratios.
- **`band`** — fixed left-to-right order `headline | hero | price | CTA |
  brand`, never any other order. Fixed gaps; the hero absorbs whatever
  horizontal slack remains (bounded by its own min/max share), and any
  slack left after the hero's own cap becomes a balanced outer margin, not
  stretched gaps. Wins on very wide/short rectangles.
- **`poster`** — top: headline + brand. Center: a large hero targeting 82%
  of the rect width (also bleeding past the text padding). Bottom: price +
  CTA. Wins on square/large rectangles.

A strategy returns `null` when it genuinely can't place a required element
(e.g. the hero has no legal room at all) — never a candidate silently
missing that element. Dropping a box instead of the whole candidate would
let a priority-1 element vanish from an otherwise "successful" layout, which
is exactly the bug class this null-return discipline exists to prevent.

## `repair.ts` — deterministic candidate repair

New stage between generation and hard validation: `raw candidate → repair →
hard validation`. `repairCandidate()` can only *improve* soft geometry — it
never relaxes a hard constraint and never invents a new content state — and
it never returns `null`; worst case, the raw candidate passes through
unchanged.

Global steps, always applied:
1. **clamp to rect** — translate (never shrink) any box a hair outside the
   rect, defensive against floating point.
2. **reserve hard minimums** — grow (from its own center) any box that fell
   below its measured floor, as far as the rect allows.
3. **rebalance margins** — recenter the whole composition's bounding box on
   whichever axis has slack, so an earlier growth/shrink doesn't leave the
   group drifted to one side. Skipped for `band`, which already balances
   its own outer margin deliberately — running the generic rebalance on top
   would shift content back into the padding it just respected.

Per-strategy step, in between:
- **Split** — recomputes the copy column's true available width from the
  hero's actual placed position (not the strategy's pre-hero estimate) and
  grows the CTA back toward its 86% target if slack remains.
- **Band** — a defensive guard: if two adjacent non-hero members ended up
  farther apart than the configured gap, pulls them back together and hands
  the freed width to the hero instead of leaving it as dead space between
  fixed elements.
- **Poster** — grows the hero toward its 82% target width if the top/bottom
  rows left more vertical room than the raw pass used, and keeps it
  centered.
- **Stack** — re-centers the hero if an earlier floor correction changed the
  remainder's true bounds.

`validate.ts` keeps its "reject, never repair" identity — it validates the
*repaired* candidate, not the raw one, and remains the single authoritative
backstop: if a repair step would require crossing a hard floor, it's simply
skipped and left for validation to reject with a clear reason.

## Measurement and text sizing

`measure.ts` has two jobs: (1) a generic per-element min/preferred size pass
that candidate generation and hard validation work against, and (2) the
shared, strategy-callable formulas — `paddingFor`, `gapFor`, `compactGapFor`,
`headlineFontFor`, `posterHeadlineFontFor`, `priceFontFor` (one curve per
strategy — a Poster's price sits near a large hero and stays modest, a
Band's price is the tallest text on the strip), `brandFontFor`,
`heroMinWidthFor`, `buttonFontSize`, `ctaHeightFor` — every one a pure
function of the surface's short axis (`min(rect.width, rect.height)`) and,
where relevant, the surface's own floors. Strategies call these directly
when placing headline/price/brand/CTA; this file never picks a strategy.

- **Real text measurement, not a character-count guess wherever avoidable.**
  `measureTextWidth()` uses `CanvasRenderingContext2D.measureText()` with a
  font string built from the same family/weight the CSS actually renders,
  wherever a canvas is available (any real browser). In Node (the test/fuzz
  suite), it falls back to a character-count estimate — a deliberate
  overestimate, so a box that "just barely" fits by the estimate still has
  slack once real glyphs render.
- **Text boxes shrink their own font to genuinely fit, rather than being
  clamped narrower than their content needs.** `strategies.ts`'s `sizeText`
  takes an optional `maxWidth`; if the content's natural width at the
  requested font size exceeds it, the font shrinks (down to
  `surface.minTextSize`) until it fits, and the box is re-measured at that
  size. Clamping a box's *width* without adjusting its font was a real bug
  caught during development: it produced a box the active text genuinely
  couldn't fit in, later rejected by validate.ts's active-text-fit check
  (itself added to catch exactly this class of problem) — or, worse, passed
  through onto a real page as silently clipped text.
- **Button font and label measurement are shared functions**, called by
  both `measure.ts`/`strategies.ts` (to size the button's box) and
  `render-dom.tsx` (to render the label) — `activeContentFor` and
  `measureActiveContentWidth` are the single source of truth for "what text
  is active and how wide is it at this exact font size," so measurement and
  rendering can never silently disagree.

## Candidate validation

Validation happens after repair, on purpose: strategies and repair are both
allowed to be geometrically imperfect because a single independent
validator enforces every hard rule consistently, regardless of which
strategy produced the candidate or what repair did to it. This means adding
a 5th strategy later requires zero changes to what counts as "valid" — the
rules live in exactly one place (`validateCandidate` in `validate.ts`).

Rejected candidates carry specific reason strings (`"cta" falls outside the
safe-area bounds`, `"logo" overlaps "price"`, `"headline" active "full"
content does not fit its resolved box`), which is what powers the resolver
trace panel in the demo — every rejection is visible, not silent.

## Scoring

```ts
SCORE_WEIGHTS = {
  priorityRetention: 0.25,
  frameUsage: 0.18,
  heroQualityAndProminence: 0.20,
  visualBalance: 0.15,
  preferredSize: 0.10,
  hierarchyAndSpacing: 0.08,
  alignmentConsistency: 0.04,
};

SCORE_PENALTIES = {
  deadRegion: 0.12,
  degradation: 0.08,
  crop: 0.04,
  excessiveEnlargement: 0.05,
};
```

- **`priorityRetention`** (0.25) is the largest positive term because it
  directly encodes the assignment's core rule: `Σ(1/priority)` of visible
  elements over the same sum for all of them, so dropping a priority-1
  element costs far more than dropping a priority-3 one.
- **`frameUsage`** (0.18) and **`heroQualityAndProminence`**'s prominence
  half (part of 0.20) both use the *same peak-then-taper curve shape*
  (`1 - |actual - target| / target`) rather than rewarding growth
  monotonically. `frameUsage` peaks around 85% coverage; hero prominence
  peaks around 45% of the rect's area. This was a real, checkpoint-driven
  fix: with a monotonic-then-capped prominence curve, a `stack` composition
  whose hero fills nearly the entire square kiosk canvas out-scored the
  intended hero-dominant-but-framed `poster` composition, because both hit
  the cap and prominence stopped differentiating them. Peaking mid-range
  instead of at the ceiling lets "large" and "overwhelming" score
  differently.
- **`visualBalance`** (0.15) compares left/right and top/bottom outer
  margins.
- **`preferredSize`** (0.10) rewards candidates that get closer to every
  element's natural preferred size, with a shallow penalty for extreme
  growth.
- **`hierarchyAndSpacing`** (0.08) combines gap consistency with semantic
  scale (hero area vs. largest other element, primary/action height vs.
  secondary height).
- **`alignmentConsistency`** (0.04) rewards fewer distinct box-origin
  x/y values relative to element count — a composition that shares edges
  reads as more deliberately aligned than one with every box on its own line.
- **`deadRegionPenalty`** (−0.12) is region-aware: it checks the
  worst-covered horizontal half, the worst-covered vertical half, *and* the
  center third directly. The center-third check exists because a
  composition that pushes all its content to the far left/right edges can
  still score well on the half-based checks (each half has *some* content
  near its own edge) while leaving a hollow, empty middle — exactly the
  failure mode an early `poster` candidate produced on the ultra-wide
  broadcast strip before this check was added.
- **`degradationPenalty`** (−0.08) is the fraction of visible elements
  currently compact or shrunk. **`cropPenalty`** (−0.04) is the fraction of
  boxes currently cropped. **`excessiveEnlargementPenalty`** (−0.05) starts
  only above 2× an element's preferred size.

No term is keyed by strategy name or checkpoint dimension — the old
per-strategy coverage-target lookup table is gone; `frameUsage` is now a
single geometry-derived curve every strategy is scored against identically.

`evaluateComposition()` also publishes normalized `coverageX`, `coverageY`,
`balanceX`, `balanceY`, and `spacingConsistency` on every `ResolvedLayout`.

## Degradation

`resolver.ts` runs a **fixed sequence**, not per-priority-tier grouping —
every rung is tried in this exact order, and every rung reruns all four
strategies against the mutated pool (this *is* "reposition"; there's no
separate rung for it):

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

- **A/B** try `gapFor(rect)` then `compactGapFor(rect)` — both pure
  functions of the surface's short axis, never a fixed pixel constant —
  before touching any element's content or geometry.
- **C** removes branding from the pool entirely. "Compress in its reserved
  slot" is already inherent to how strategies size brand dynamically from
  `brandFontFor`/the surface — there's no separate pool state for it.
- **D/E** switch price/CTA to their `compactContent`/`compactLabel`
  variant, if the spec declares one.
- **F** drops price outright (never priority-1 by spec convention, checked
  explicitly rather than assumed).
- **G** tries `croppedAspectRatio` first, then collapses the hero's
  preferred size to its measured minimum (which preserves aspect — the
  minimum height is derived as `minWidth / aspect`, not stretched).
- **H** switches headline to `compactContent`, only as the last content
  change before failure.
- **CTA is never dropped.** If CTA and a priority-1 element can't coexist,
  the whole resolution fails rather than dropping it — there is no CTA-drop
  rung anywhere in the sequence.
- **I** returns a typed `{ ok: false, reason: "no-valid-layout", ... }`
  instead of ever emitting geometry that overlaps, clips, or violates a
  floor.

`ContentVariant` collapsed from the old three-way `full | short | icon` (plus
a separate declarative merge mechanism) down to a plain `full | compact` —
matching the locked final spec. `DegradationAction` is `"compact-spacing" |
"compact" | "hide" | "shrink" | "crop" | "drop"`.

### Continuity — optional, additive resize hysteresis

`resolveLayout(spec, surface, continuity?)` takes an optional third
parameter:

```ts
interface ContinuityHint {
  previousStrategy: string;
  previousContentVariantByRole?: Partial<Record<ElementRole, ContentVariant>>;
}
```

Omitting it reproduces the exact one-shot behavior every test/checkpoint
above relies on — `(spec, surface, continuity)` is still a pure function of
its inputs, always. When a hint is supplied (App.tsx threads the previous
winner while the user drags the width/height sliders, and resets it on a
preset/spec change), two margins prevent flicker during a live resize:

- `STRATEGY_SWITCH_MARGIN = 0.06` — the incumbent strategy is kept unless a
  challenger beats it by at least this much. Computed for free inside the
  existing all-strategies loop (`attemptResolution` also tracks the best
  score for whichever candidate matches `continuity.previousStrategy`, if
  any), so applying the margin never re-runs a strategy.
- `CONTENT_RESTORE_MARGIN = 0.08` — if a role was compact on the previous
  step and the current step's full-content rung (A/B) would restore it,
  the restoration only happens if full scores at least this much better
  than staying compact; otherwise the resolver holds the role compact.

`render-dom.tsx` never sees a `ContinuityHint` — the resize-smoothing
decision lives entirely in the resolver, not the renderer.

## Failure semantics

If the ladder exhausts every rung and still nothing validates,
`resolveLayout` returns:

```ts
{ ok: false, reason: "no-valid-layout", message: "...", details: string[], attempts: ResolutionAttempt[] }
```

instead of ever emitting geometry that overlaps, clips, or violates a
floor. The same typed-failure path (`ResolveResult`) also covers
`invalid-spec` and `invalid-surface` for malformed input, caught before any
layout attempt runs. A caller can exhaustively `switch` on `reason` and the
compiler will hold them to it.

## Typed diagnostics

Every rung records a `ResolutionAttempt { label, candidates:
CandidateDiagnostic[], winnerStrategy? }` — one diagnostic per strategy
tried, valid-with-score or invalid-with-reasons. `ResolvedLayout.attempts`
(and `ResolutionFailure.attempts`) expose the full structured ladder
trajectory, so the demo's trace panel reads typed data directly instead of
parsing the human-readable `trace: string[]` (still present, for debugging
and the "view full trace" disclosure).

## Extensibility

- **New surface**: pass any `SurfaceProfile` to `resolveLayout`. Nothing in
  the resolver, strategies, repair, or validator references surface
  identity — proven by the "unknown 5th surface" test and by the demo's
  "Custom / unseen 5th surface" control, which is just user input flowing
  into the exact same function.
- **New renderer (e.g. Canvas)**: consumes `ResolvedLayout` — an array of
  `{ id, x, y, width, height, presentation }` boxes plus metadata. A Canvas
  renderer would read the same structure `render-dom.tsx` does and draw
  instead of positioning DOM nodes. Zero resolver changes.
- **Broadcast safe area**: already modeled — `SurfaceProfile.safeArea`
  becomes the available-rectangle transformation every strategy operates
  within. A wider broadcast safe area is just a different `SafeArea` value.
- **Print bleed**: would model as the same kind of constraint — a
  bleed/trim/safe-content transformation feeding the same "available
  rectangle" concept the resolver already consumes. No new layout path
  needed, only a new way to compute `Rect` from a print-oriented profile.

## Verification model

Five layers, each catching a different class of problem:

1. **Node/vitest unit and integration tests** (`tests/*.test.ts`) — the fast
   inner loop; run on every change.
2. **Checkpoint tests** (`tests/checkpoints.test.ts`) — the five canonical
   surfaces, locked against `src/checkpoints.ts`'s definitions, asserting
   strategy choice and the specific structural targets from the spec
   (hero share ranges, CTA fill ranges, x-ordering, etc.) with tolerances,
   not exact-pixel snapshots.
3. **Fuzz** (`tests/fuzz.test.ts`) — 1000 seeded-random surfaces biased
   toward tight/ultra-wide/ultra-tall/large-safe-area/high-floor corners,
   asserting zero invariant violations on every success and a typed,
   non-empty-message failure (never a thrown exception) on every rejection.
4. **Continuity** (`tests/continuity.test.ts`) — no local strategy
   oscillation across a resize path or in a ±24px neighborhood around each
   checkpoint.
5. **Playwright** (`e2e/`, `tests/browser/`) — real Canvas
   `measureText()`, zero DOM text overflow, and the QR Landing Panel's
   branding-drop degradation verified in the actual rendered DOM —
   supporting evidence, never the only correctness source.

## Deliberate non-rule-violations worth flagging

`src/App.css` has two `@media` queries, neither of which is an ad-layout
media query:

- `@media (max-width: 1000px)` recomposes the demo's own panels (surface
  picker / preview / trace) for narrow browser windows
  — UI chrome for *this repository's demo harness*, not the ad layout
  engine. Every ad element's position still comes from inline styles
  computed directly from `ResolvedBox` coordinates in `render-dom.tsx`,
  completely independent of viewport size or any media query.
- `@media (prefers-reduced-motion: reduce)` disables CSS transitions for
  users who've asked the OS for less motion. It only ever touches
  `transition`, never `position`/`width`/`height`/`font-size` — it carries
  no layout decision at all.

The assignment's "no media-query layout engine" rule is about how the *ad*
is composed; neither query touches that.
