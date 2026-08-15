# Flam Adaptive Layout Engine — Project Instructions

Source of truth: [orginal-doc.md](orginal-doc.md) (assignment spec — **never edit this file**).
Derived reference: [guide.md](guide.md) (verified faithful to orginal-doc.md; Part A = spec-traceable facts, Part B = build guide/design choices, Part C = README template, Part D = corrections).

Build Flam Adaptive Layout Engine A→Z. Be concise. Use simple language. Do work, test it, then explain only what matters.

## Rules

- One ad spec. Many surfaces.
- No `surface.id` layout branches.
- No media-query layout engine.
- Resolver = plain TypeScript.
- React only renders resolved output.
- Never overlap or clip.
- Respect safe area, min text size, tap target.
- Lower priority degrades first.
- Priority 1 never drops in successful layout.
- Impossible layout = typed failure, not broken UI.
- New unknown surface must work without resolver changes.
- No unnecessary abstractions.
- No fake/mock success.
- Run tests/build after important changes.
- Fix errors before moving on.
- Keep code clean and interview-explainable.

## Phase 1 — Foundation

Build: types, ad spec, surfaces, validation, normalization, typed resolver output/errors.

Test invalid inputs.

Gate: `npm run build`, `npm test`.

Then explain changed files briefly.

## Phase 2 — Resolver

Build: `measure → candidate layouts → validate → score → degrade/retry → resolved layout`

Generic candidates: vertical, horizontal, split, grid.

Hard checks: bounds, no overlap, min text, min tap target, positive geometry.

Degradation: `shrink → truncate → reposition → drop`. Lowest priority first.

Test:
- 4 required surfaces
- constrained surface
- unknown fifth surface
- deterministic result
- portrait vs broadcast use meaningfully different composition
- impossible input fails cleanly

Do not continue until resolver is solid.

## Phase 3 — Demo

Build DOM renderer and simple professional UI.

Need: mobile portrait, mobile landscape, broadcast, square kiosk, custom surface controls, live width/height changes, visible degradation, resolver trace (strategy, score, omissions, failures).

Renderer makes ZERO layout decisions.

Run build + tests + manual check.

## Phase 4 — Finish

Add: unit tests, invariant tests, fuzz tests, README, ARCHITECTURE.md, deployment.

Audit:
```bash
grep -rn 'surface.id ===' src/
grep -rn '=== "mobile' src/
grep -rn '=== "broadcast' src/
grep -rn '=== "kiosk' src/
grep -rn '@media' src/
```

Fresh test:
```bash
npm install
npm test
npm run build
npm run dev
```

Verify all surfaces. Zero overlap/clipping. Custom surface works.

## Git Rule

Git work must happen from the local machine using normal official Git tooling:
```bash
git status
git diff
git add .
git commit -m "..."
git push
```

Use GitHub CLI only when useful:
```bash
gh auth status
gh repo view
```

Do not use any external code-publishing shortcut in place of the local repository.

Before every push:
1. inspect `git diff`
2. run tests
3. run build
4. commit only correct files

Suggested 3 pushes:

**Push 1** — Foundation + types + surfaces.

**Push 2** — Resolver + validation + degradation + tests.

**Push 3** — Final verified project from the local PC: demo + docs + final tests + cleanup + deployment links. Must be the actual locally tested final repository state.

## DONE means

- [ ] 4 required surfaces
- [ ] unknown fifth surface
- [ ] genuine recomposition
- [ ] no surface-specific resolver branches
- [ ] no overlap
- [ ] no clipping
- [ ] hard constraints respected
- [ ] priority degradation correct
- [ ] typed failures
- [ ] tests pass
- [ ] fuzz/invariants pass
- [ ] build passes
- [ ] clean console
- [ ] README complete
- [ ] ARCHITECTURE complete
- [ ] repo works from fresh clone
- [ ] deployed demo works
- [ ] final local Git push complete
- [ ] code can be explained line-by-line

Work in order: **correct → tested → explainable → polished**

Do not trade correctness for speed or visual polish.

## Status

Instructions saved. Waiting for the kick-start guide before beginning Phase 1.
