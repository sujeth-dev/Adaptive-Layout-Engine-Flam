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

## Measurement and text sizing

`measure.ts` estimates every element's min/preferred box size before any
strategy runs. Two things about it matter enough to call out explicitly:

- **Real text measurement, not a character-count guess.** `measureTextWidth()`
  uses `CanvasRenderingContext2D.measureText()` with a font string built from
  the same family/weight the CSS actually renders (`--font-serif`/`--font-sans`
  in `App.css` — kept in sync by comment, not by import, since `measure.ts`
  stays framework/DOM-independent by design). This runs in any real browser.
  In Node (the test/fuzz suite), no canvas exists, so it falls back to a
  character-count estimate — deliberately tuned as a slight *overestimate*
  (`AVG_CHAR_WIDTH_FACTOR = 0.62`), so a box that "just barely" fits by the
  estimate still has a little real slack once actual glyphs render, instead of
  silently overflowing into `text-overflow: ellipsis` while the resolver
  reports zero degradation. That gap — a box computed to *exactly* its
  preferred width via a too-tight estimate, then visibly clipped by the real
  browser font — was a genuine bug caught by screenshotting the running demo,
  not a hypothetical.
- **`buttonFontSize()` is a single shared function**, called by both
  `measure.ts` (to size the button's box) and `render-dom.tsx` (to render the
  label). Earlier, `render-dom.tsx` derived the button's font size independently
  from `box.height` (`box.height * 0.4`) instead of reusing the value
  `measure.ts` had actually assumed when it computed the box's *width* — the
  two numbers didn't agree, so a button could be sized for a 15px label and
  then rendered at 17.6px, wrapping "Shop Now" onto two lines inside a fixed-
  height pill. Sharing one function removes the possibility of that drift by
  construction, rather than by convention. `measureButton()`'s `minWidth` is
  also now a hard floor of "the label fits on one line at this exact font
  size" (`prefWidth`, not an arbitrary shrink fraction of it) — a button can
  still shrink toward its tap-target floor in height, but never becomes
  narrower than its own text needs.

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

`resolver.ts` groups elements into **priority tiers** (elements sharing a
priority value), processed lowest-priority-tier-first — "lowest priority
degrades first." One rung runs once, globally, before any tier is touched;
the rest run per tier, in this order:

0. **compact spacing** (once, globally) — retry with progressively tighter
   gaps (`14px → 10px → 6px`) before touching any element's content or
   geometry at all. `gap` is threaded as a parameter through every strategy
   in `strategies.ts` (not a fixed constant), so this is still a pure
   function of the attempt, never surface-branched.
1. **merge** (declared button targets only) — if the spec declares an
   `ElementMerge` (e.g. fold `price` into `cta` as "Buy $30"), and the
   source elements are still present and none is priority-1, try removing
   the sources and swapping the target's content. Fully generic:
   `resolver.ts` only ever reads `spec.merges`, never a specific element id
   — a spec with no merges behaves exactly as if this rung didn't exist.
2. **shorten** — switch to a `shortContent`/`shortLabel` variant, if the
   spec declares one for this element and a merge hasn't already replaced
   its content.
3. **iconify** (buttons only) — collapse to an `icon` glyph, if declared.
4. **shrink** — set preferred size to measured minimum, retry.
5. **truncate** (text only) — mark truncated (affects rendering + score), retry.
6. **crop** (hero images only) — switch to `croppedAspectRatio`, if
   declared, retry.
7. **drop** (skipped entirely for priority-1 elements) — remove the
   element, record why, retry.

State is cumulative throughout: an element shortened/shrunk in one rung
stays that way while later rungs run. This is why "reposition" isn't a
separate rung — every retry already regenerates all 4 candidates from
scratch against the (now-changed) pool, which *is* repositioning.

Priority-1 elements go through every content/geometry rung and can
shorten/shrink/truncate/crop, but the drop branch — and merges that would
remove a priority-1 source — are unconditionally skipped for them,
enforcing "priority 1 never drops from a successful layout" structurally,
not by convention.

All of the new fields driving this (`shortContent`, `shortLabel`, `icon`,
`croppedAspectRatio`, `AdSpec.merges`) are **optional and additive** — a
spec that declares none of them degrades exactly as it did before this
existed (pure shrink → truncate → drop).

### Recording what actually happened, honestly

Recording "the one rung whose own attempt succeeded" turned out to be an
incomplete story: state is cumulative, so an *earlier* element can be left
silently shortened/shrunk by an attempt that ultimately failed, while a
*different*, later element's rung is what actually succeeds — a per-rung
record would miss that earlier element's change entirely. This was caught
by the fuzz suite (`assertInvariants` failing with a false "below floor"
report once shortened content was involved) after this feature landed, not
guessed in advance.

The fix: `buildSuccess()` diffs the pool's state at the moment of success
against its state at the very start of resolution
(`diffContentDegradations()`), and reports every element whose
shrunk/truncated/contentVariant/cropped state actually changed — regardless
of which specific rung's attempt happened to be the one that succeeded.
`drop` and `merge` still have to be recorded explicitly at the point they
happen (they remove elements from the pool entirely, so they can't be
recovered by diffing pool membership by id afterward), but the merge case
is *also* covered by the diff as a fallback (a button's `label` differing
from its original spec value implies a merge happened), for the same
"cumulative but not the rung that succeeded" reason.

One more consequence worth naming: **a single element can carry multiple
simultaneous degradation records** — e.g. a button both `merge`d and then
`iconify`d in the same resolve. Every consumer of `layout.degradations`
(the invariant checker, `render-dom.tsx`) looks up records by *action
category*, never by id alone (a naive `Map` keyed by id silently collapses
multiple records for the same element down to one, which is exactly the bug
this section describes catching). `render-dom.tsx` in particular resolves
rendering precedence by degradation *depth* — icon-only wins over merge,
which wins over shorten, which wins over the original content — because
that's the same precedence `measure.ts` used when it sized the box; getting
this wrong reproduces the exact "box too small for its own label" class of
bug described in [Measurement and text sizing](#measurement-and-text-sizing).

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

## Deliberate non-rule-violations worth flagging

`src/App.css` has two `@media` queries, neither of which is an ad-layout
media query:

- `@media (max-width: 1000px)` recomposes the demo's own three panels
  (surface picker / preview / trace) for narrow browser windows — UI chrome
  for *this repository's demo harness*, not the ad layout engine. Every ad
  element's position still comes from inline styles computed directly from
  `ResolvedBox` coordinates in `render-dom.tsx`, completely independent of
  viewport size or any media query.
- `@media (prefers-reduced-motion: reduce)` disables CSS transitions
  (hover states, the copy-trace success flash, the trace disclosure chevron)
  for users who've asked the OS for less motion. It only ever touches
  `transition`, never `position`/`width`/`height`/`font-size` — it cannot
  change where or how big anything renders, so it carries no layout
  decision at all.

The assignment's "no media-query layout engine" rule is about how the *ad*
is composed; neither query touches that.
