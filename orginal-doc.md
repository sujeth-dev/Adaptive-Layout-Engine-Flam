# Adaptive Layout Engine for Multi-Surface Ads

#### Overview

Flam ads run across wildly different surfaces — a tall mobile interstitial, a wide broadcast lower-third, a square retail kiosk screen, a print-to-digital QR landing panel — often from a *single* content spec. Build a layout engine that takes one declarative ad spec and correctly adapts it across fundamentally different aspect ratios and constraints, without per-surface hardcoded layouts.

- Implement this as a single well-architected application/library (no package publishing or monorepo split required — this is about the layout algorithm, not distribution).
- Prioritize a genuine constraint-based layout model over conditional CSS breakpoints per surface.

---

#### Core requirements

#### 1) Layout engine features

Spec definition

Define an ad's content and layout intent once, independent of surface:

tsx

```tsx
const adSpec = defineAd({
  elements: [
    { id: "headline", type: "text", role: "primary", priority: 1 },
    { id: "product-image", type: "image", role: "hero", priority: 1 },
    { id: "cta", type: "button", role: "action", priority: 2 },
    { id: "logo", type: "image", role: "branding", priority: 3 },
    { id: "price", type: "text", role: "secondary", priority: 2 },
  ],
});
```

Surface constraints

Define surface profiles with real constraints, not just width/height:

tsx

```tsx
const surfaces = {
  mobileInterstitial: { width: 320, height: 480, safeArea: {...}, minTapTarget: 44 },
  broadcastLowerThird: { width: 1920, height: 250, viewingDistance: "far", minTextSize: 32 },
  retailKiosk: { width: 1080, height: 1080, minTapTarget: 60, touchOnly: true },
};
```

Constraint-based resolution

Given one `adSpec` and one surface profile, the engine must produce a valid layout that:

- Respects each element's priority — if space is insufficient, lower-priority elements (e.g. branding) shrink, get repositioned, or drop out entirely before higher-priority ones (e.g. the CTA) are compromised.
- Respects hard constraints per surface (e.g. `minTapTarget` for touch surfaces, `minTextSize` for far-viewing-distance surfaces like broadcast).
- Never overlaps elements or clips content outside the visible surface bounds.
- Produces meaningfully different (not just uniformly scaled) arrangements for a tall mobile surface vs. a wide broadcast surface vs. a square kiosk — this is the core of the assignment.

Rendering

Render the resolved layout to actual DOM/CSS (or Canvas) for at least 3 distinct surface profiles from the same spec, visibly demonstrating the adaptation.

Type safety

Element definitions, surface profiles, and the resolved layout output should be fully typed — a spec referencing an undefined role or an invalid constraint combination should be a compile-time or clearly-reported runtime error.

---

#### 2) Example demo application

Build a small demo where:

- A single ad spec (of your own design — a realistic product ad with headline, image, price, CTA, and branding at minimum) is defined once.
- A surface picker lets you switch between at least 4 surface profiles (mobile portrait, mobile landscape, broadcast lower-third, square kiosk) and see the same spec re-resolve live into an appropriately different layout for each.
- One surface profile intentionally has too little space for all elements at full priority, demonstrating your priority-based degradation (e.g. branding shrinks/drops, secondary text truncates) rather than overlapping or overflowing.

---

#### Technical challenges (what we're really testing)

#### 1) Constraint-solving approach

You don't need a full linear-programming solver — but you do need a real algorithm (e.g. a priority-ordered greedy placement pass, a simple flex-like box model you build yourself, or a rule-based cascade), not a lookup table of `if (surface === "mobile") return layoutA`.

What we evaluate:

- Whether the same code path actually produces different, correct layouts for different inputs, or whether surfaces are secretly hardcoded
- How gracefully the engine degrades when constraints can't all be satisfied
- Clarity of your algorithm, explained in the README

---

#### 2) Priority & degradation logic

Example expectation: shrink the kiosk surface's available height until branding must be dropped — branding should disappear cleanly (not clip or overlap) while headline/CTA remain intact and correctly positioned.

What we evaluate:

- Correctness and predictability of the degradation order
- No silent overlaps/clipping under any tested constraint combination

---

#### 3) Type system

What we evaluate:

- Good use of TypeScript to make invalid specs/surfaces hard to construct
- Clear typing of the resolved layout output (position/size per element) that a renderer can consume without guessing

---

#### 4) Architecture

What we evaluate:

- Clean separation between: spec definition → constraint resolution → layout output → rendering
- Could a new surface profile be added without touching the resolution algorithm? Could a new renderer (Canvas instead of DOM) be added without touching the resolution algorithm?

---

#### Submission structure

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

---

#### Documentation requirements

#### README.md must include

- Setup instructions
- How to run the demo and switch surfaces
- Known limitations
- Time spent on the assignment

#### Layout algorithm

- How constraint resolution works, step by step
- How priority/degradation is decided when space is insufficient

#### TypeScript design

- How specs and surfaces are typed to prevent invalid combinations

#### Resolution flow

Example:

```
Ad Spec + Surface Profile → Constraint Resolver → Resolved Layout → Renderer
```

#### Limitations

Examples: no animation/transition between surfaces, fixed element type set, no text-measurement-aware wrapping.

---

#### Evaluation criteria (weighted)

- Constraint resolution algorithm (35%): genuine per-surface adaptation, sound priority/degradation logic
- Layout correctness across surfaces (25%): no overlaps/clipping, visibly distinct and sensible per-surface arrangements
- TypeScript & architecture (20%): strong typing, clean separation of concerns
- Example application (10%): convincing multi-surface demo
- Code quality (10%): readability, documentation, logical structure

---

#### What we don't want to see

- Hardcoded per-surface layout branches (`if surface === "mobile"`) disguised as a "resolver"
- Pure CSS media-query breakpoints presented as the "engine" — the resolution logic must be in your TypeScript, not delegated entirely to CSS
- Overlapping or clipped elements under any of the required test surfaces
- No TypeScript types on specs/surfaces/output
- Uniform scaling passed off as "adaptation" (shrinking everything proportionally is not the same as re-composing layout for a different aspect ratio)

---

#### Timeline and submission

- Time limit: 3–5 days
- Submission: GitHub repository
- Optional: deployed demo
- Email with repo link

---

#### Bonus points (optional)

- A 5th "unknown at design time" surface profile provided live in the interview, correctly resolved without any code changes
- Smooth animated transition when switching surfaces live in the demo
- Text-measurement-aware layout (actually measuring rendered text width/height to inform wrapping/truncation decisions, not fixed estimates)
- A Canvas rendering backend in addition to DOM, sharing the same resolver
- Basic accessibility consideration (tap target sizing, contrast-aware branding placement) as a first-class constraint type

---

#### Live interview expectations

If the submission passes review, be prepared to:

1. Demo the same spec resolving across all required surfaces
2. Introduce a new, previously-unseen surface profile live and resolve it
3. Explain the priority/degradation algorithm step by step
4. Walk through why a specific element ended up at a specific position/size for a given surface
5. Discuss how this could extend to broadcast-safe-area or print-bleed constraints

---

#### FAQ

**Q: Do I need a full constraint solver (like a real LP/CSS-flexbox-from-scratch implementation)?**

A: No. A well-reasoned priority-ordered algorithm is sufficient and preferred over an over-engineered general solver. We care more about correct, explainable behavior than mathematical generality.

---

**Q: Can I use CSS Grid/Flexbox at all?**

A: Yes, for final rendering of a *resolved* layout. The decision of *what* goes where and at what size/priority must be made by your TypeScript resolver, not by CSS media queries choosing between hardcoded layouts.

---

**Q: How many surfaces do I need to support?**

A: At least 4 in the demo (mobile portrait, mobile landscape, broadcast lower-third, square kiosk), and the algorithm should generalize to an arbitrary 5th surface given in the interview.

---

**Q: Does the demo need to be deployed?**

A: Optional, but appreciated for faster review.

---

**Q: Can I use React?**

A: Yes, for rendering the resolved layout. The resolution algorithm itself should be framework-agnostic, plain TypeScript.

---

**Q: Can I use AI tools while working on the assignment?**

A: You may use AI tools. Disclose which tools you used and for what in the README. This will not penalize you, but you must be able to explain the final code.

---

**Q: What if I don't finish everything?**

A: That's okay. Clearly document what works, what is incomplete, and what you would improve next.

---

**Q: How much time should I spend on the assignment?**

A: 3–5 days. Focus on a genuinely working, explainable resolution algorithm across the required surfaces rather than a large element-type library.

---

#### Final note

This assignment is about systems thinking applied to layout — a real constraint-resolution model that adapts content intelligently, not a set of responsive breakpoints in disguise. A small spec that adapts *correctly and explainably* across 4 real surfaces beats a large one that's secretly hardcoded per surface.