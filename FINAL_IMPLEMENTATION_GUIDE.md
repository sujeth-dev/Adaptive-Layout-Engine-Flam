# FINAL IMPLEMENTATION GUIDE — Existing Adaptive Layout Engine Repository

Repository: `sujeth-dev/Adaptive-Layout-Engine-Flam`

This is the final repository-specific execution guide. The current project already has the right architectural skeleton; evolve it in place rather than rewriting it.

## 1. Final target flow

```text
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
if none fits:
apply next priority degradation
      ↓
rerun all four
      ↓
ResolvedLayout
      ↓
DOM renderer
```

The five known surfaces are golden verification points only.

## 2. Baseline before changing code

Run:

```bash
git status
npm install
npm run typecheck
npm test
npm run build
```

Record:
- current test count;
- current fuzz result;
- current strategy winner per preset;
- screenshots of current required/constrained outputs.

Do not begin from a red baseline.

## 3. Lock checkpoint tests first

Create:

```text
src/checkpoints.ts
tests/checkpoints.test.ts
```

Canonical targets:

```text
320×480   Stack / full
480×320   Split / full
1920×250  Band / full
1080×1080 Poster / full
510×90    Band / compact / no brand
```

`checkpoints.ts` must never be imported by engine files.

Checkpoint tests should assert:
- expected strategy only for these five;
- active variants;
- invariant correctness;
- structural geometry using tolerances.

Do not snapshot exact engine pixels as the only test.

## 4. Refactor `src/types.ts`

Keep:
- discriminated element types;
- `ElementRole`;
- positive integer priority;
- surface types;
- `Rect`;
- typed success/failure.

Replace `full | short | icon` and merge-specific rendering state with:

```ts
type ContentVariant = "full" | "compact";
```

Text:

```ts
interface TextElement {
  type: "text";
  content: string;
  compactContent?: string;
}
```

Button:

```ts
interface ButtonElement {
  type: "button";
  label: string;
  compactLabel?: string;
}
```

Image:

```ts
interface ImageElement {
  type: "image";
  aspectRatio?: number;
  croppedAspectRatio?: number;
}
```

Add resolved presentation truth, either on `ResolvedBox` or a separate map:

```ts
interface ElementPresentation {
  variant: "full" | "compact";
  visible: boolean;
  cropped: boolean;
  fontSize?: number;
}
```

Add typed candidate diagnostics so the UI no longer parses trace strings.

Gate:

```bash
npm run typecheck
npm test
```

## 5. Refactor `src/spec.ts`

Final demo content:

```text
headline: Summer Sale — 40% Off / compact: 40% Off
hero: Product Shot / optional cropped ratio
CTA: Shop Now / compact: Shop 🛒
price: $29.99 / compact: $30
brand: Solstice / hidden when degraded
```

Remove:
- `"Buy $30"` merge;
- third icon-only CTA state.

Update spec validation tests.

## 6. Update `src/surfaces.ts`

Keep the four required assignment profiles.

Add:

```ts
export const constrainedStrip: SurfaceProfile = {
  id: "constrainedStrip",
  width: 510,
  height: 90,
  minTapTarget: 44,
  minTextSize: 12,
};
```

Expose:

```ts
requiredSurfaces = [four assignment profiles]
canonicalDemoSurfaces = [required four + constrainedStrip]
```

Do not lower hard constraints simply to force a screenshot.

## 7. Strengthen `src/measure.ts`

### Real text fit
Keep browser Canvas measurement and conservative Node fallback.

A full active string must truly fit its resolved box. No silent renderer ellipsis.

### Shared CTA sizing

Use:

```ts
buttonFontSize(surface) =
  Math.max(surface.minTextSize, 15);
```

CTA height:

```ts
max(
  surface.minTapTarget,
  ceil(buttonFontSize * 1.35 + 18)
)
```

Button width is measured text width + horizontal padding, never below tap target.

### Hero scaling
Remove the global fixed phone-size cap.

Use the usable frame to derive dynamic hero preference, e.g.:

```ts
prefWidth = max(
  minWidth,
  min(rect.width * 0.78, rect.height * 0.72 * aspect)
);
```

### Strategy presentation preferences
Provide shared formula helpers for:
- normal headline;
- poster headline;
- Stack/Split/Band/Poster price sizes;
- brand;
- CTA.

Add tests for:
- full vs compact width;
- broadcast text floor;
- CTA tap floor;
- large kiosk hero preference.

Gate typecheck/test/build.

## 8. Rewrite `src/strategies.ts`

Use role lookup helpers instead of one universal content order.

All strategies still run for every surface.

### Stack

Compute:
- top region = headline + brand slot;
- bottom region = price + CTA;
- hero = all legal middle remainder.

Brand is a real rectangle, not an overlay.

### Split

Target:

```text
LEFT: headline + centered commerce
RIGHT: brand slot + hero
```

Constants:

```text
hero target share 56%
allowed 48–60%
CTA target 86% copy width
allowed 65–92%
```

Commerce is centered in the remaining left region below headline.

This directly fixes the earlier wasted-space problem.

### Band

Exact order:

```text
headline | hero | price | CTA | brand
```

Never:

```text
brand | hero | text cluster | CTA
```

Fixed internal gaps.
Hero absorbs horizontal slack.
Remaining slack after hero cap becomes balanced outer margins.

### Poster

Retire `adaptive-grid`.

Use:
- top headline + brand;
- centered hero target 82% width;
- bottom price + CTA.

Add direct strategy structure tests.

## 9. Add `src/repair.ts`

New stage:

```text
raw candidate → repair → hard validation
```

Global order:

1. clamp padding/gap;
2. reserve hard minimums;
3. reclaim hero slack;
4. strategy-specific repair;
5. rebalance margins;
6. remeasure if required;
7. reject hard-floor violation.

### Split repair

Calculate remaining left region below headline.

```ts
commerceH = priceH + gap + ctaH;
commerceY =
  remainingCopy.y +
  (remainingCopy.height - commerceH) / 2;
```

Grow CTA toward 86% copy width.
Grow price toward Split price preference.
Penalize dead regions.

### Band repair
Never grow gaps to use width.
Give width to hero.

### Poster repair
Grow hero and balance margins.

Add `tests/repair.test.ts`.

## 10. Strengthen `src/validate.ts`

Keep existing:
- positive geometry;
- bounds;
- overlap;
- minimum dimensions;
- tap target.

Add:
- resolved font >= `minTextSize`;
- active full text width fits;
- brand cannot overlap hero/headline;
- hero original/cropped aspect rules;
- render state and measured state stay consistent.

Add explicit validation fixtures.

## 11. Replace `src/score.ts` model

Use:

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

Dead-region must be region-aware, especially for Split.

Hero quality must include prominence so a tiny hero cannot beat Poster on the kiosk.

Add `tests/score.test.ts` comparing good vs deliberately weak candidates.

## 12. Refactor `src/resolver.ts`

Preserve:
- every attempt tries all strategies;
- typed failure semantics.

Change attempt:

```ts
raw = strategy(...)
repaired = repairCandidate(raw,...)
validation = validateCandidate(repaired,...)

if valid:
  score
```

Simplify degradation to the final ladder:

```text
full/default gap
full/compact gap
brand compress/hide
price compact
CTA compact
price drop
hero shrink/crop
headline compact
fail
```

Every state change reruns all four strategies.

Expose typed candidate diagnostics.

Optional live-resize continuity context:

```ts
previousStrategy?: StrategyId
```

One-shot tests pass no previous context.

## 13. Align `src/render-dom.tsx`

Renderer stays absolute-position based and decision-free.

Render content from resolved presentation state.

Do not search degradation logs to decide what text is active.

Use the same CTA font helper as measurement.

Brand renders only in its resolved non-overlapping box.

## 14. Update `src/App.css`

Change:

```css
--r-cta: 5px;
```

Ensure:
- no ad geometry chosen by CSS;
- no silent ellipsis for full state;
- app-shell media queries remain chrome-only;
- brand has no independent overlay shortcut.

## 15. Update `src/App.tsx`

Preset order:

```text
01 Mobile Portrait       320×480
02 Mobile Landscape      480×320
03 Broadcast Lower-Third 1920×250
04 Square Kiosk          1080×1080
05 Constrained Strip     510×90
C  Custom / unseen
```

Use structured diagnostics:
- winner;
- candidate scores;
- rejection reasons;
- active variants;
- omissions;
- degradation state.

Store previous winner while dragging width/height and pass as continuity hint only.

## 16. Add native verification gallery

Create:

```text
src/CheckpointGallery.tsx
```

Use the real:
- `resolveLayout`;
- `RenderedSurface`.

Render:
- five canonical checkpoints;
- selected extra stress surfaces.

Do not handcraft a separate fake HTML renderer.

Use native 1:1 rendering for browser screenshot verification.

## 17. Testing migration

Keep:
- `validate.test.ts`;
- `resolver.test.ts`;
- invariant helpers;
- fuzz.

Rewrite old merge/iconify-specific degradation tests.

New degradation tests:
- brand first;
- price compact before P1;
- CTA compact but remains;
- price can drop before CTA;
- hero crop before P1 loss;
- headline compact only late;
- priority 1 never omitted;
- full state stays when it fits.

Add:
- `checkpoints.test.ts`;
- `repair.test.ts`;
- `score.test.ts`;
- `continuity.test.ts`.

## 18. Canonical checkpoint assertions

### 320×480
- Stack;
- all five visible;
- headline above hero;
- hero above commerce;
- price left of CTA;
- brand top-right non-overlapping;
- hero area >=42%.

### 480×320
- Split;
- hero right;
- hero share 48–60%;
- CTA fill 65–92%;
- commerce centered in remaining left region;
- left occupancy >=72%.

### 1920×250
- Band;
- x-order headline → hero → price → CTA → brand;
- min text >=32;
- internal gaps bounded;
- full content.

### 1080×1080
- Poster;
- hero centered;
- hero width 68–88%;
- hero area 38–66%;
- CTA >=60.

### 510×90
- Band;
- no logo;
- compact headline/price/CTA;
- hero retained.

## 19. Extend invariant helper

Add:
- active full text fits;
- resolved font floor;
- brand/hero no overlap;
- image aspect/crop validity;
- presentation/measurement consistency;
- CTA measured label matches active state.

Keep priority-1-present invariant.

## 20. Fuzz

Keep seeded fuzzing.

Increase to 1000 if runtime is reasonable.

Ranges:

```text
width 80–2200
height 80–1400
```

Bias toward:
- tight;
- ultra-wide;
- ultra-tall;
- large safe area;
- high text/tap floors.

Success:
- zero invariant violations.

Failure:
- typed;
- non-empty message;
- no throw.

Do not assert random strategies.

## 21. Continuity

Test:

```text
320×480
360×440
400×390
440×350
480×320
```

Expect:
- Stack early;
- Split late;
- no A→B→A local oscillation.

Test checkpoint neighborhoods:
- ±5;
- ±10;
- ±20;
- ±24 px.

## 22. Browser/static verification

After core Vitest suite is green, add Playwright.

Verify:
- real Canvas `measureText`;
- no DOM overflow for active full text;
- DOM rects match resolver rects;
- five checkpoint screenshots;
- selected extra screenshots;
- reduced-motion behavior if transitions are added.

Screenshots are supporting evidence, not the only correctness source.

## 23. Documentation

Update `ARCHITECTURE.md`:
- add `repair.ts`;
- final strategies;
- final score;
- final degradation;
- continuity;
- verification model.

Update `guide.md`:
- replace adaptive-grid;
- replace merge/icon ladder;
- replace old scoring;
- document repair-before-validation.

Update `README.md` only after final test run:
- setup;
- five presets/custom;
- exact algorithm;
- exact test counts;
- actual fuzz result;
- limitations;
- time spent;
- AI disclosure.

Update `CLAUDE.md` to the frozen final contract.

Never edit `orginal-doc.md`.

## 24. Phase gates

After every phase:

```bash
npm run typecheck
npm test
npm run build
```

After Playwright exists:

```bash
npm run test:browser
```

Before each commit:

```bash
git diff
```

## 25. Suggested commit sequence

```text
test: lock canonical layout checkpoints
refactor: simplify full and compact presentation states
refactor: strengthen text and hero measurement
feat: implement stack split band and poster contracts
feat: add deterministic candidate repair
feat: score whitespace hierarchy balance and hero prominence
refactor: simplify priority degradation and expose diagnostics
feat: align renderer and demo with resolved presentation state
test: add continuity browser and expanded fuzz coverage
docs: freeze final architecture and implementation guide
```

## 26. Final manual review

Review in this order:

1. 320×480 — vertical story; brand non-overlap.
2. 480×320 — no dead left area; wide CTA; emphasized price.
3. 1920×250 — consistent gaps; hero absorbs width.
4. 1080×1080 — hero-dominant Poster.
5. 510×90 — no brand; compact row.
6. 735×410 — unseen, same resolver.
7. 90×80 — typed failure.
8. live portrait→landscape resize — no flicker.

## 27. Hardcoding audit

```bash
grep -rn 'surface.id ===' src/
grep -rn '=== "mobile' src/
grep -rn '=== "broadcast' src/
grep -rn '=== "kiosk' src/

grep -rn '320.*480\|480.*320\|1920.*250\|1080.*1080\|510.*90'   src/resolver.ts   src/strategies.ts   src/repair.ts   src/score.ts   src/measure.ts
```

Expected: zero checkpoint decision logic in engine files.

## 28. Fresh-clone final gate

```bash
npm install
npm run typecheck
npm test
npm run build
npm run test:browser
npm run dev
```

Verify:
- clean console;
- five canonical outputs;
- custom surface;
- degradation;
- failure;
- no overlap/clipping;
- docs accurate.

## 29. Final interview explanation

> The ad spec declares content, semantic role, priority, and optional compact representations. The surface declares geometry and hard constraints. The resolver measures active content, generates four generic compositions for every surface, deterministically repairs soft geometry, rejects anything that violates hard constraints, and scores the valid candidates for priority retention and layout quality. If full content cannot fit, it degrades lower-priority presentation state and reruns the same four strategies. The renderer only paints the resolved boxes. The five known surfaces are golden quality tests, not branches in the resolver, so an unseen surface enters the exact same pipeline.

That is the final implementation story.
