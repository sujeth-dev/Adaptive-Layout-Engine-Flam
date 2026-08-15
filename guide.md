# Flam — Adaptive Layout Engine for Multi-Surface Ads
## Master Source of Truth + A→Z Build Guide

Every claim in Part A is traceable to the official assignment text. Part B is the build guide. Part C is a drop-in README template for the repo. Part D records where earlier drafts were wrong.

Legend used throughout:
- **[SPEC]** — stated in the assignment. Non-negotiable.
- **[TPO]** — from your campus process, overrides the spec where they conflict.
- **[CHOICE]** — our design decision. Defensible, but not mandated.
- **[BONUS]** — listed by Flam as optional credit.

---

# PART A — SOURCE OF TRUTH

## A1. The task

**[SPEC]** Build a layout engine that takes one declarative ad spec and correctly adapts it across fundamentally different aspect ratios and constraints, **without per-surface hardcoded layouts**.

**[SPEC]** A single well-architected application/library. **No monorepo, no npm publishing** — this is about the algorithm, not distribution.

**[SPEC]** Prioritise a genuine constraint-based layout model over conditional CSS breakpoints per surface.

## A2. Required inputs

**[SPEC]** The ad spec is defined once, independent of surface, via `defineAd()`. The example given:

```ts
const adSpec = defineAd({
  elements: [
    { id: "headline",      type: "text",   role: "primary",   priority: 1 },
    { id: "product-image", type: "image",  role: "hero",      priority: 1 },
    { id: "cta",           type: "button", role: "action",    priority: 2 },
    { id: "logo",          type: "image",  role: "branding",  priority: 3 },
    { id: "price",         type: "text",   role: "secondary", priority: 2 },
  ],
});
```

**[SPEC]** Surface profiles carry **real constraints, not just width/height**. The example given:

```ts
const surfaces = {
  mobileInterstitial:  { width: 320,  height: 480, safeArea: {...}, minTapTarget: 44 },
  broadcastLowerThird: { width: 1920, height: 250, viewingDistance: "far", minTextSize: 32 },
  retailKiosk:         { width: 1080, height: 1080, minTapTarget: 60, touchOnly: true },
};
```

**[CHOICE]** Mobile landscape dimensions are **not specified** by Flam. 480×320 is our pick.
**[CHOICE]** Concrete `safeArea` values are not specified. We choose per surface.

## A3. Required resolver behaviour

**[SPEC]** Given one spec + one surface profile, produce a valid layout that:

1. **Respects priority** — when space is insufficient, lower-priority elements **shrink, get repositioned, or drop out entirely** before higher-priority ones are compromised.
2. **Respects hard constraints** — `minTapTarget` on touch surfaces, `minTextSize` on far-viewing surfaces.
3. **Never overlaps elements or clips content** outside visible surface bounds.
4. **Produces meaningfully different (not uniformly scaled) arrangements** for tall vs wide vs square. *The spec calls this "the core of the assignment."*

Note the exact degradation vocabulary in (1): **shrink → reposition → drop**. Our ladder inserts truncate; that's an addition, not a contradiction.

## A4. Required rendering and typing

**[SPEC]** Render the resolved layout to actual DOM/CSS **or Canvas** for **at least 3 distinct surface profiles**.

**[SPEC]** Element definitions, surface profiles, and resolved layout output must be **fully typed**. An undefined role or invalid constraint combination must be a **compile-time or clearly-reported runtime error**.

> Both are permitted. Compile-time where the type system reaches; typed runtime errors where it doesn't.

## A5. Required demo

**[SPEC]**
- A single realistic ad spec — headline, image, price, CTA, branding **at minimum**.
- A surface picker with **at least 4 profiles**: mobile portrait, mobile landscape, broadcast lower-third, square kiosk. Same spec re-resolves live.
- **One profile intentionally has too little space** for all elements at full priority, demonstrating degradation (branding shrinks/drops, secondary text truncates) rather than overlapping or overflowing.

> Rendering minimum is 3 surfaces; the demo picker minimum is 4. Build 4.

## A6. What is explicitly being tested

**[SPEC] Constraint-solving approach** — no LP solver needed. A priority-ordered greedy pass, a self-built flex-like box model, or a rule-based cascade all qualify. What is evaluated: whether the *same code path* produces different correct layouts, how gracefully it degrades, and clarity of the algorithm in the README.

**[SPEC] Priority & degradation** — worked example: *shrink the kiosk's available height until branding must be dropped; branding disappears cleanly while headline/CTA remain intact and correctly positioned.* Evaluated on **correctness and predictability of the degradation order** and **no silent overlaps/clipping under any tested combination**.

**[SPEC] Type system** — TypeScript used to make invalid specs/surfaces hard to construct; resolved output typed clearly enough that a renderer consumes it **without guessing**.

**[SPEC] Architecture** — clean separation: spec → resolution → layout output → rendering. Two litmus questions they will ask:
- Could a new surface profile be added **without touching the resolution algorithm**?
- Could a Canvas renderer be added **without touching the resolution algorithm**?

## A7. Required repo structure

**[SPEC]**

```
adaptive-layout-assignment/
├── src/
│   ├── spec.ts
│   ├── surfaces.ts
│   ├── resolver.ts
│   ├── render-dom.ts
│   └── App.tsx
├── package.json
├── tsconfig.json
├── README.md
└── ARCHITECTURE.md
```

`ARCHITECTURE.md` appears in the required structure. Ship it.
**[CHOICE]** Extra files (`types.ts`, `measure.ts`, `score.ts`, `validate.ts`, `templates/`, `tests/`) are additions for clarity, and are fine.

## A8. Required documentation

**[SPEC]** README must include: setup instructions · how to run the demo and switch surfaces · known limitations · **time spent**.

**[SPEC]** Documentation must also cover:
- **Layout algorithm** — how constraint resolution works, step by step; how priority/degradation is decided when space is insufficient
- **TypeScript design** — how specs and surfaces are typed to prevent invalid combinations
- **Resolution flow** — e.g. `Ad Spec + Surface Profile → Constraint Resolver → Resolved Layout → Renderer`
- **Limitations** — their own examples: no animation between surfaces, fixed element type set, no text-measurement-aware wrapping

**[SPEC]** AI tools are allowed. **Disclose which tools and for what, in the README.** No penalty, but you must be able to explain the final code.

## A9. Evaluation weights

| Criterion | Weight | What it actually measures |
|---|---:|---|
| Constraint resolution algorithm | **35%** | genuine per-surface adaptation, sound priority/degradation logic |
| Layout correctness across surfaces | **25%** | no overlaps/clipping, visibly distinct and sensible arrangements |
| TypeScript & architecture | **20%** | strong typing, clean separation of concerns |
| Example application | **10%** | convincing multi-surface demo |
| Code quality | **10%** | readability, documentation, logical structure |

60% is resolver + correctness. Budget accordingly.

## A10. Disqualifiers

**[SPEC] "What we don't want to see":**
- Hardcoded per-surface layout branches (`if surface === "mobile"`) disguised as a resolver
- Pure CSS media-query breakpoints presented as the engine
- Overlapping or clipped elements under **any** of the required test surfaces
- No TypeScript types on specs/surfaces/output
- **Uniform scaling passed off as adaptation** — shrinking everything proportionally is not re-composing for a different aspect ratio

## A11. Permitted (from the FAQ)

- **CSS Grid/Flexbox** — yes, for rendering a *resolved* layout. The decision of what goes where, at what size and priority, must be in your TypeScript.
- **React** — yes, for rendering. The resolution algorithm must be **framework-agnostic plain TypeScript**.
- **Incomplete work** — acceptable if you clearly document what works, what isn't finished, and what you'd improve next.

## A12. Bonus items

**[BONUS]**
1. A 5th unknown-at-design-time surface profile resolved live in the interview **without code changes**
2. Smooth animated transition when switching surfaces
3. **Text-measurement-aware layout** — actually measuring rendered text, not fixed estimates
4. A Canvas backend alongside DOM, **sharing the same resolver**
5. Accessibility as a **first-class constraint type** — tap target sizing, contrast-aware branding placement

## A13. Timeline and submission

**[SPEC]** 3–5 days · GitHub repository · deployed demo **optional but appreciated for faster review** · email with repo link.

**[TPO]** Submit via the Google Form (*FlamAssignmentSubmission — Frontend R&D Intern*), **deployed on the web plus the GitHub link**, within the TPO's deadline. Shortlisting is based on the assignment.

> Where these differ, follow the TPO. Deployment is optional to Flam but effectively required for you.

## A14. Live interview — the five

**[SPEC]**
1. Demo the same spec resolving across all required surfaces
2. Introduce a **new, previously-unseen surface profile live** and resolve it
3. Explain the priority/degradation algorithm **step by step**
4. Walk through **why a specific element ended up at a specific position/size** for a given surface
5. Discuss extending to **broadcast-safe-area or print-bleed** constraints

## A15. Their closing framing

**[SPEC]** *"Systems thinking applied to layout — a real constraint-resolution model, not responsive breakpoints in disguise. A small spec that adapts correctly and explainably across 4 real surfaces beats a large one that's secretly hardcoded per surface."*

---

# PART B — THE BUILD GUIDE

## B1. Governing rule

The resolver may read a surface's **geometry and constraint values**. It may never branch on a surface's **identity**.

```ts
// Legitimate — geometry-derived
if (rect.width / rect.height > 2.5) { ... }

// Legitimate — constraint-derived
if (surface.viewingDistance === "far") { minText = Math.max(minText, 32); }

// Disqualifying — identity-derived
if (surface.id === "broadcastLowerThird") return broadcastLayout;
```

`id` exists for pickers, labels, and tests. It must never reach the resolver's decision path.

## B2. Architecture

```
Ad Spec (intent, no geometry)  +  Surface Profile (constraints)
                    ↓
        Normalise constraints        ← fills defaults; makes unknown surfaces safe
                    ↓
        Measure elements             ← { min, preferred } per element
                    ↓
        Generate candidate layouts   ← pure functions of the available rectangle
                    ↓
        Validate hard constraints    ← reject, don't repair
                    ↓
        Score feasible candidates    ← geometry + priority preservation
                    ↓
        Degrade & retry if none fit  ← lowest priority first
                    ↓
        ResolvedLayout (pure data)
                    ↓
        Renderer (DOM / Canvas)      ← makes zero layout decisions
```

Dependencies run **strictly downward**. The resolver imports nothing from React.

## B3. Types

```ts
type ElementType = "text" | "image" | "button";
type ElementRole = "primary" | "secondary" | "hero" | "action" | "branding";
type Priority = number;  // positive integer; lower = more important

interface BaseElement {
  id: string;
  type: ElementType;
  role: ElementRole;
  priority: Priority;
  droppable?: boolean;      // default derived from priority
  truncatable?: boolean;
}

interface TextElement   extends BaseElement { type: "text";   text: string }
interface ImageElement  extends BaseElement { type: "image";  src: string; aspectRatio?: number }
interface ButtonElement extends BaseElement { type: "button"; label: string }

type AdElement = TextElement | ImageElement | ButtonElement;

interface SafeArea { top: number; right: number; bottom: number; left: number }
type ViewingDistance = "near" | "medium" | "far";

interface SurfaceProfile {
  id: string;                        // labels/tests only — never read by the resolver
  width: number;
  height: number;
  safeArea?: Partial<SafeArea>;
  minTapTarget?: number;
  minTextSize?: number;
  viewingDistance?: ViewingDistance;
  touchOnly?: boolean;
}

interface PlacedBox {
  id: string; x: number; y: number; width: number; height: number;
  fontSize?: number; truncated?: boolean;
}

interface ResolvedLayout {
  surface: { width: number; height: number };
  strategy: string;
  boxes: PlacedBox[];
  omitted: { id: string; reason: string }[];
}

type ResolveResult =
  | { ok: true;  layout: ResolvedLayout }
  | { ok: false; reason: ResolutionFailure };
```

Discriminated unions give you the compile-time half. `ResolveResult` gives you the "clearly-reported runtime error" half that A4 asks for.

## B4. Runtime validation — reject, never silently repair

Return a typed failure for: non-positive width/height · negative safe area · safe area exceeding the surface · duplicate element ids · non-integer or non-positive priority · hard minimums that cannot coexist in the available rectangle.

This matters most for the unseen interview surface. Some inputs are genuinely infeasible; failing cleanly is a correct answer and a better one than a broken layout.

## B5. Measurement

Every element reports `{ min, preferred }` **derived from the surface's constraints**, before any placement happens.

- Text: `minHeight` from the effective `minTextSize`; width from real measurement.
- Buttons: `minHeight ≥ surface.minTapTarget`. **`surface.minTapTarget` is the only source of truth** — do not cite platform numbers as if they were universal minimums.
- Hero: a minimum box plus a preferred aspect ratio.
- `viewingDistance: "far"` raises the effective text floor.

**[BONUS]** Real text measurement via `canvas.measureText()` on an offscreen context. Cache by `(text, fontSize, family)` — never measure inside a placement loop.

## B6. Candidate compositions **[CHOICE]**

Four parameterised strategies, each a pure function of the available rectangle. None knows any surface name.

- **Vertical stack** — hero above a text column, CTA anchored below
- **Horizontal band** — logo · hero · text column · CTA in a row
- **Side-by-side split** — hero one side, text column the other
- **Adaptive grid** — two-column arrangement for near-square rectangles

**Do not use hero-with-overlay.** It is visually attractive but places boxes on top of the hero, which muddies the "never overlaps" invariant the spec states flatly. Keep every element in its own non-overlapping rectangle.

Each strategy returns a candidate **or `null`** when the rectangle can't accommodate it. Never a broken layout.

## B7. Validation before scoring

Reject any candidate where:
- a box falls outside the safe-area rectangle
- two visible boxes overlap (AABB: `a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h`)
- any `fontSize < effectiveMinTextSize`
- any interactive box `height < minTapTarget`
- any width or height is negative

Return a **reason string**, not a boolean. Those reasons become your trace panel and your interview answers.

## B8. Scoring **[CHOICE]** — commit to a formula

The 35% criterion lives here, so decide rather than listing options:

```ts
score =
    0.30 * priorityValueRetained    // Σ(1/priority) of visible ÷ Σ(1/priority) of all
  + 0.25 * heroShapeQuality         // 1 − normalised deviation from preferred aspect
  + 0.20 * preferredSizeSatisfaction// mean(actual ÷ preferred), capped at 1
  + 0.15 * spaceUtilisation         // 1 − |coverage − 0.72| ÷ 0.72
  − 0.10 * truncationPenalty        // fraction of text elements truncated
```

Five terms, five weights summing to 1, each explainable in one sentence. Put this exact block in ARCHITECTURE.md with a line per term saying what it optimises for. Avoid scattered magic constants — that's what reads as machine-written.

## B9. Degradation ladder

The spec's own order is **shrink → reposition → drop**. Our full ladder, applied lowest-priority-first, escalating only when a rung is exhausted at every lower priority:

1. **Shrink** toward each element's minimum
2. **Truncate** eligible text (`truncatable: true`)
3. **Reposition** — re-run candidate generation with the reduced set
4. **Drop** the lowest-priority droppable element

Deterministic. Same input, same output, every time — "predictability of the degradation order" is written into the criteria.

Invariant to enforce and test: **in any successful layout, no priority-1 element is dropped.** If the rectangle is genuinely impossible, return `{ ok: false }` rather than violating a hard constraint.

## B10. Renderer

Consumes `ResolvedLayout` and absolutely positions boxes. Flexbox/Grid for internal alignment is fine. Zero conditionals about surfaces, aspect ratios, or sizes. If the renderer needs to know something, the resolver failed to output it.

**[BONUS]** A Canvas renderer over the same `ResolvedLayout` is the cheapest possible proof that the seam is real.

## B11. Testing **[CHOICE]**

Not required by the spec, but it's how you evidence the 25% correctness criterion.

**Unit** — measurement honours `minTextSize`; CTA never below `minTapTarget`; each strategy returns `null` rather than a broken layout; degradation order is deterministic.

**Invariants** (assert on every produced layout) — inside safe bounds · no overlaps · no negative dimensions · font floors respected · tap floors respected · no priority-1 element omitted.

**Structural difference** — assert that 320×480 and 1920×250 select **different strategies**. This is a direct machine-check of the "meaningfully different, not uniformly scaled" requirement, and it's the single most on-target test you can write.

**Fuzz** — sweep 500+ random surfaces (200×120 → 1920×1200, randomised `minTapTarget` and `minTextSize`), assert all invariants, print the pass rate, and put that number in the README.

## B12. Demo app

- Surface picker with the 4 required profiles
- Live width/height sliders — this *is* the "too little space" demonstration, and it doubles as your unseen-surface tool
- **[CHOICE]** Custom surface input: width, height, `minTapTarget`, `minTextSize`, `viewingDistance`
- **[CHOICE]** Resolver trace panel showing strategies tried, rejection reasons, scores, and degradation steps

The trace panel converts interview question 4 from a memory test into a demo. Highest-leverage optional thing you can build.

## B13. Five-day plan

| Day | Deliverable | Commit |
|---|---|---|
| 1 | `types.ts`, `spec.ts`, `surfaces.ts`, normalisation, `measure.ts` | `feat: typed spec, surfaces and measurement` |
| 2 | four strategies + `validate.ts` | `feat: candidate composition and hard validation` |
| 3 | `score.ts`, degradation ladder, `resolver.ts` | `feat: scoring and priority degradation` |
| 4 | `render-dom.tsx`, `App.tsx`, sliders, trace panel, tests | `feat: multi-surface demo` / `test: invariants and fuzz` |
| 5 | README, ARCHITECTURE, deploy, rehearse | `docs: architecture and tradeoffs` |

Behind schedule? Cut in this order: animation → Canvas renderer → contrast rules → extra presets → visual polish. **Never** cut: hard-constraint validation, priority degradation, the 4 surfaces, meaningful recomposition, type safety, README/ARCHITECTURE, resolver/renderer separation.

## B14. Pre-submission gate

```bash
git clone <repo> fresh && cd fresh
npm install && npm run build && npm test && npm run dev
grep -rn "surface.id ===\|=== \"mobile\|=== \"broadcast\|=== \"kiosk" src/
grep -rn "@media" src/
```

- [ ] Clean clone runs with no hidden local files
- [ ] No console errors on load
- [ ] All 4 surfaces render, none overlapping or clipped
- [ ] Squeezing height drops branding cleanly, CTA survives
- [ ] Custom/unseen surface resolves
- [ ] README has live URL, time spent, AI disclosure, limitations
- [ ] ARCHITECTURE.md present and complete
- [ ] Deployed **[TPO]**
- [ ] Repo link + live URL submitted via the Google Form before the TPO deadline

Surface names in fixtures, picker labels, and tests are fine. They must not appear in resolver logic.

## B15. Interview rehearsal

**One-minute architecture summary** — memorise the ideas, not the wording:

> The spec carries content and intent but no geometry. The surface carries geometry plus hard constraints — safe area, minimum text size, tap targets. The resolver normalises those constraints, measures each element's minimum and preferred size, then generates several generic layout candidates that know nothing about surface names. Candidates violating overlap, clipping, or minimum-size rules are rejected outright. Survivors are scored on priority retention and geometric quality. If nothing fits, the least important eligible content is degraded and the search re-runs. The output is pure layout data that a renderer paints without making decisions.

**One-liners to have ready:**
- *vs responsive CSS* — "Responsive CSS selects styling for known viewport conditions; this solves a layout from arbitrary priorities, geometry, and hard constraint floors."
- *degradation* — "It exhausts legal compromises on lower-priority elements before compromising more important ones."
- *generalisation* — "A new surface works because layouts are generated from geometry and constraints, not from a list of known device names."
- *broadcast safe area / print bleed* — "Both are new constraint types, not new surfaces. They enter through constraint normalisation and shrink the available rectangle; the resolver is untouched."

**Demo order:** four presets → squeeze until degradation fires → open custom surface input → change width/height live → show the resolver trace. That sequence walks adaptation → correctness → degradation → generalisation → explainability without you narrating the structure.

**The night before:** reread `resolver.ts`, `score.ts`, `validate.ts` line by line. Anything you can't explain, rewrite until you can.

---

# PART C — README TEMPLATE

```markdown
# Adaptive Layout Engine for Multi-Surface Ads

**Live demo:** <url>   **Repo:** <url>

One declarative ad spec, resolved across arbitrary surfaces by a constraint-based
TypeScript engine. No per-surface layouts, no media queries.

## Setup
npm install
npm run dev      # demo at localhost:5173
npm test         # unit, invariant and fuzz suites

## Running the demo
Pick a surface from the picker, or drag the width/height sliders to construct one.
"Custom surface" accepts arbitrary width, height, minTapTarget and minTextSize.
Shrink the kiosk height to watch priority-based degradation.

## Resolution flow
Ad Spec + Surface Profile → Normalise → Measure → Generate candidates
→ Validate → Score → Degrade if needed → Resolved Layout → Renderer

## Layout algorithm
[step by step — see ARCHITECTURE.md for the scoring formula]

## Priority and degradation
Ladder: shrink → truncate → reposition → drop, applied lowest priority first.
Deterministic; no priority-1 element is dropped in a successful layout.

## TypeScript design
[discriminated unions, constrained roles, ResolveResult for runtime failures]

## Testing
N invariant assertions across M fuzzed surfaces — pass rate X%.

## Known limitations
[e.g. no animated transitions; fixed element type set; single-line text only]

## Time spent
[hours]

## AI tool disclosure
[tools used, and for exactly what]
```

---

# PART D — CORRECTIONS TO EARLIER DRAFTS

Recorded so nothing wrong gets carried into the interview.

1. **"The resolver may never read a surface's name" was too blunt.** Constraint-aware branching (`viewingDistance === "far"`, aspect-ratio thresholds) is legitimate. Only *identity* branching is disqualifying.
2. **Hero-with-overlay was a mistake.** It required an overlap exception in the validator. The spec states "never overlaps" without qualification — drop the strategy rather than defend the exception.
3. **44px/48dp are platform guidance, not WCAG minimums.** `surface.minTapTarget` is the only source of truth here.
4. **Deployment is optional to Flam** ("appreciated for faster review"), not mandatory. It's mandatory for you only because of the TPO instruction.
5. **"Public repo" is an inference, not a stated rule.** Reasonable — a reviewer who can't open your repo can't grade it — but don't present it as a requirement.
6. **Rendering minimum is 3 surfaces; the demo picker minimum is 4.** Earlier drafts collapsed these. Build 4 and the point is moot.
7. **Priority is not restricted to `1 | 2 | 3`.** Use a general positive integer with runtime validation; the example spec just happens to use three levels.
8. **Mobile landscape at 480×320 is our choice**, not a Flam-specified size. Same for all concrete `safeArea` values.
9. **Tests are not a stated requirement.** They're the strongest available evidence for the 25% correctness criterion — worth doing, but don't claim Flam asked for them.

---

## North star

**Spec expresses intent. Surface expresses constraints. Resolver chooses geometry. Renderer only paints.**

Keep those four responsibilities separate and the submission is structurally correct before a single pixel is drawn.