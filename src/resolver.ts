// The orchestrator: measure → candidates → validate → score → degrade/retry → ResolvedLayout.
//
// Plain TypeScript, no React import. Every "attempt" below tries ALL strategies
// from strategies.ts and keeps the highest-scoring valid one — there is no
// branch anywhere that picks a strategy by surface identity or aspect-ratio
// threshold; adaptation emerges from validation + scoring against the actual
// available rectangle.
//
// Degradation ladder, lowest priority first, grouped into tiers by priority value:
//   0. (once, globally) compact spacing — try progressively tighter gaps before
//      touching any element's content or geometry.
//   Per tier: merge (declared button targets only) -> shorten -> iconify (buttons),
//   then the existing shrink -> truncate/crop -> drop. Priority-1 elements go
//   through every rung except drop, which is unconditionally skipped for them.

import type {
  AdElement,
  AdSpec,
  DegradationRecord,
  LayoutCandidate,
  MeasuredElement,
  NormalizedSurfaceProfile,
  OmittedElement,
  ResolveResult,
  ResolvedLayout,
  Rect,
  SurfaceProfile,
} from "./types";
import { normalizeSurfaceProfile, validateAdSpec, validateCandidate, validateSurfaceProfile } from "./validate";
import { GAP, ROLE_ORDER, measureAll, measureElement } from "./measure";
import { STRATEGIES } from "./strategies";
import { scoreCandidate } from "./score";

// Progressively tighter gaps tried by the global spacing-compaction rung, after the
// default (comfortable) GAP fails and before any element's content/geometry degrades.
const COMPACT_GAPS = [10, 6];

interface Attempt {
  best: { candidate: LayoutCandidate; score: number } | null;
  trace: string[];
}

/** Tries every strategy once against the current pool. This IS the "reposition" step —
 * every attempt regenerates candidates from scratch across all strategies, so degradation
 * never needs a separate reposition rung; it's inherent to calling this again. */
function attemptResolution(
  pool: MeasuredElement[],
  allElements: AdElement[],
  rect: Rect,
  surface: NormalizedSurfaceProfile,
  gap: number,
): Attempt {
  const trace: string[] = [];
  const measuredById = new Map(pool.map((p) => [p.element.id, p.measurement]));
  const elementsById = new Map(pool.map((p) => [p.element.id, p.element]));
  let best: { candidate: LayoutCandidate; score: number } | null = null;

  for (const strategy of STRATEGIES) {
    const candidate = pool.length > 0 ? strategy(pool, rect, gap) : null;
    if (!candidate) {
      continue;
    }
    const validation = validateCandidate(candidate, measuredById, elementsById, surface, rect);
    if (!validation.valid) {
      const extra = validation.reasons.length > 1 ? ` (+${validation.reasons.length - 1} more)` : "";
      trace.push(`${candidate.strategy} → rejected: ${validation.reasons[0]}${extra}`);
      continue;
    }
    const score = scoreCandidate(candidate, pool, allElements, rect);
    trace.push(`${candidate.strategy} → score ${score.toFixed(3)}`);
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  return { best, trace };
}

/** Diffs the pool's current state against its state at the start of resolution and
 * reports every element still present whose content/geometry actually changed —
 * shrink, truncate, shorten, iconify, crop. This runs once, at the moment an attempt
 * finally succeeds, rather than recording only the single rung whose own attempt
 * happened to succeed: state is cumulative across rungs (an earlier element can be
 * silently left shortened/shrunk by a failed attempt, then a later, different
 * element's rung is what actually succeeds) — a per-rung record would miss that
 * earlier element entirely. Drop and merge remove elements from the pool outright, so
 * they can't be diffed this way; both are still recorded explicitly at the point they
 * happen (see the DROP branch and the merge attempt above), same for the global
 * spacing-compaction rung. */
function diffContentDegradations(initialPool: MeasuredElement[], finalPool: MeasuredElement[]): DegradationRecord[] {
  const initialById = new Map(initialPool.map((p) => [p.element.id, p]));
  const records: DegradationRecord[] = [];
  for (const item of finalPool) {
    const original = initialById.get(item.element.id);
    if (!original) continue; // not present at the start — shouldn't happen, pool only ever loses ids
    if (item.element.type === "button" && original.element.type === "button" && item.element.label !== original.element.label) {
      // A merge replaced this button's own content — the richer "combined with X, Y"
      // story lives in `omitted`'s reason text for the sources; this just needs to
      // tell the renderer what content is now active.
      records.push({ id: item.element.id, action: "merge", detail: `content changed to "${item.element.label}"`, mergedContent: item.element.label });
    }
    if (item.contentVariant === "icon" && original.contentVariant !== "icon") {
      records.push({ id: item.element.id, action: "iconify", detail: "collapsed to icon-only" });
    } else if (item.contentVariant === "short" && original.contentVariant !== "short") {
      records.push({ id: item.element.id, action: "shorten", detail: "switched to shorter content" });
    }
    if (item.cropped && !original.cropped) {
      records.push({ id: item.element.id, action: "crop", detail: "switched to a tighter focal-point aspect ratio" });
    }
    if (item.truncated && !original.truncated) {
      records.push({ id: item.element.id, action: "truncate", detail: "text truncated to minimum width" });
    }
    if (item.shrunk && !original.shrunk) {
      records.push({ id: item.element.id, action: "shrink", detail: "shrunk to minimum dimensions" });
    }
  }
  return records;
}

function buildSuccess(
  surfaceId: string,
  best: { candidate: LayoutCandidate; score: number },
  initialPool: MeasuredElement[],
  finalPool: MeasuredElement[],
  omitted: OmittedElement[],
  explicitDegradations: DegradationRecord[],
  trace: string[],
): ResolveResult {
  trace.push(`winner: ${best.candidate.strategy} (score ${best.score.toFixed(3)})`);
  const layout: ResolvedLayout = {
    surfaceId,
    strategy: best.candidate.strategy,
    score: best.score,
    boxes: best.candidate.boxes,
    omitted,
    degradations: [...explicitDegradations, ...diffContentDegradations(initialPool, finalPool)],
    trace,
  };
  return { ok: true, layout };
}

function getItem(pool: MeasuredElement[], id: string): MeasuredElement | undefined {
  return pool.find((p) => p.element.id === id);
}

function hasShortVariant(el: AdElement): boolean {
  if (el.type === "text") return !!el.shortContent;
  if (el.type === "button") return !!el.shortLabel;
  return false;
}

/** True once a merge has already replaced this element's own content (e.g. a button's
 * label became a mergedLabel) — its own shortLabel no longer describes that content, so
 * the shorten rung should not fire on top of it. */
function contentUnchanged(original: AdElement, current: AdElement): boolean {
  if (original.type === "button" && current.type === "button") return original.label === current.label;
  return true;
}

/** Elements grouped by priority value, highest priority *number* (= lowest importance)
 * first — "lowest priority degrades first" — with each tier internally ordered by
 * semantic role (same ROLE_ORDER every strategy already uses for content order), tie-
 * broken by id for determinism. Computed once from the initial pool; membership is
 * fixed even as elements are later shortened/shrunk/dropped from the live `pool`. */
function groupByPriorityDescending(pool: MeasuredElement[]): MeasuredElement[][] {
  const byPriority = new Map<number, MeasuredElement[]>();
  for (const item of pool) {
    const list = byPriority.get(item.element.priority) ?? [];
    list.push(item);
    byPriority.set(item.element.priority, list);
  }
  return [...byPriority.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, items]) =>
      [...items].sort(
        (a, b) => (ROLE_ORDER[a.element.role] ?? 99) - (ROLE_ORDER[b.element.role] ?? 99) || a.element.id.localeCompare(b.element.id),
      ),
    );
}

export function resolveLayout(spec: AdSpec, surfaceInput: SurfaceProfile): ResolveResult {
  const specValidation = validateAdSpec(spec);
  if (!specValidation.ok) {
    return { ok: false, reason: "invalid-spec", message: "Ad spec failed validation.", details: specValidation.errors };
  }
  const surfaceValidation = validateSurfaceProfile(surfaceInput);
  if (!surfaceValidation.ok) {
    return { ok: false, reason: "invalid-surface", message: "Surface profile failed validation.", details: surfaceValidation.errors };
  }

  const surface = normalizeSurfaceProfile(surfaceInput);
  const rect: Rect = {
    x: surface.safeArea.left,
    y: surface.safeArea.top,
    width: surface.width - surface.safeArea.left - surface.safeArea.right,
    height: surface.height - surface.safeArea.top - surface.safeArea.bottom,
  };

  const allElements = spec.elements;
  const originalById = new Map(allElements.map((el) => [el.id, el]));
  const initialPool = measureAll(allElements, surface, rect);
  let pool = initialPool;
  const omitted: OmittedElement[] = [];
  // Only drop/merge/compact-spacing are pushed here explicitly — they remove elements
  // from the pool (or apply globally) so they can't be recovered by diffing pool state
  // at success time. Everything else (shrink/truncate/shorten/iconify/crop) is derived
  // by buildSuccess() diffing initialPool against the pool at the moment of success —
  // see diffContentDegradations() for why that's necessary instead of recording only
  // the rung whose own attempt happened to succeed.
  const explicitDegradations: DegradationRecord[] = [];
  const trace: string[] = [
    `surface "${surface.id}" ${surface.width}x${surface.height}`,
    `available rect ${rect.width.toFixed(0)}x${rect.height.toFixed(0)} at (${rect.x.toFixed(0)},${rect.y.toFixed(0)})`,
  ];

  let attemptNumber = 1;
  let gap = GAP;
  let attempt = attemptResolution(pool, allElements, rect, surface, gap);
  trace.push(`attempt ${attemptNumber} (full size):`, ...attempt.trace.map((l) => `  ${l}`));
  if (attempt.best) {
    return buildSuccess(surface.id, attempt.best, initialPool, pool, omitted, explicitDegradations, trace);
  }

  // Global rung: compact spacing before touching any element's content or geometry.
  // "*" as the degradation id marks a surface-wide change, not a specific element.
  for (const compactGap of COMPACT_GAPS) {
    gap = compactGap;
    attemptNumber++;
    attempt = attemptResolution(pool, allElements, rect, surface, gap);
    trace.push(`attempt ${attemptNumber} (compact spacing, ${gap}px gap):`, ...attempt.trace.map((l) => `  ${l}`));
    if (attempt.best) {
      explicitDegradations.push({ id: "*", action: "compact-spacing", detail: `gap reduced to ${gap}px` });
      return buildSuccess(surface.id, attempt.best, initialPool, pool, omitted, explicitDegradations, trace);
    }
  }

  const tiers = groupByPriorityDescending(pool);

  for (const tier of tiers) {
    // Content-variant rungs, per element in role order: merge -> shorten -> iconify.
    for (const target of tier) {
      const id = target.element.id;

      // MERGE: only for a button that's the declared target of a spec-level merge,
      // once its declared source elements are all still present in the pool. Fully
      // generic — reads only what `spec.merges` declares, never a specific element id.
      for (const merge of spec.merges ?? []) {
        if (merge.targetId !== id) continue;
        const current = getItem(pool, id);
        if (!current || current.element.type !== "button") continue;
        // A merge removes its sources from the pool — same category as a drop, so it
        // must never apply to a priority-1 source ("priority 1 never drops").
        const sourcesEligible = merge.sourceIds.every((sid) => {
          const item = getItem(pool, sid);
          return item && item.element.priority > 1;
        });
        if (!sourcesEligible) continue;
        const mergedElement: AdElement = { ...current.element, label: merge.mergedLabel };
        pool = pool
          .filter((p) => !merge.sourceIds.includes(p.element.id))
          .map((p) =>
            p.element.id === id
              ? {
                  ...p,
                  element: mergedElement,
                  contentVariant: "full",
                  measurement: measureElement(mergedElement, surface, rect, "full", p.cropped),
                }
              : p,
          );
        // Recorded unconditionally, before checking success — same "mutate first"
        // cumulative pattern the DROP branch below already uses. If this specific
        // attempt doesn't succeed but the merge state persists into a later rung's
        // successful attempt, `omitted` must still be accurate for the sources; the
        // "merge" degradation record itself is reconstructed from the final pool by
        // diffContentDegradations() below if this attempt isn't the one that succeeds.
        for (const sid of merge.sourceIds) {
          omitted.push({ id: sid, reason: `merged into "${id}" ("${merge.mergedLabel}")` });
        }
        attemptNumber++;
        attempt = attemptResolution(pool, allElements, rect, surface, gap);
        trace.push(`attempt ${attemptNumber} (merge ${merge.sourceIds.join("+")} into "${id}"):`, ...attempt.trace.map((l) => `  ${l}`));
        if (attempt.best) {
          return buildSuccess(surface.id, attempt.best, initialPool, pool, omitted, explicitDegradations, trace);
        }
      }

      // SHORTEN: switch to a shorter content/label variant, if the spec declares one
      // for this element and a merge hasn't already replaced its content.
      const beforeShorten = getItem(pool, id);
      const original = originalById.get(id);
      if (
        beforeShorten &&
        original &&
        contentUnchanged(original, beforeShorten.element) &&
        beforeShorten.contentVariant === "full" &&
        hasShortVariant(beforeShorten.element)
      ) {
        pool = pool.map((p) =>
          p.element.id === id
            ? { ...p, contentVariant: "short", measurement: measureElement(p.element, surface, rect, "short", p.cropped) }
            : p,
        );
        attemptNumber++;
        attempt = attemptResolution(pool, allElements, rect, surface, gap);
        trace.push(`attempt ${attemptNumber} (shorten "${id}"):`, ...attempt.trace.map((l) => `  ${l}`));
        if (attempt.best) {
          return buildSuccess(surface.id, attempt.best, initialPool, pool, omitted, explicitDegradations, trace);
        }
      }

      // ICONIFY: buttons only, collapse to an icon glyph (accessible name stays the
      // full original label — enforced in render-dom.tsx, not here).
      const beforeIcon = getItem(pool, id);
      if (beforeIcon && beforeIcon.element.type === "button" && beforeIcon.element.icon && beforeIcon.contentVariant !== "icon") {
        pool = pool.map((p) =>
          p.element.id === id
            ? { ...p, contentVariant: "icon", measurement: measureElement(p.element, surface, rect, "icon", p.cropped) }
            : p,
        );
        attemptNumber++;
        attempt = attemptResolution(pool, allElements, rect, surface, gap);
        trace.push(`attempt ${attemptNumber} (iconify "${id}"):`, ...attempt.trace.map((l) => `  ${l}`));
        if (attempt.best) {
          return buildSuccess(surface.id, attempt.best, initialPool, pool, omitted, explicitDegradations, trace);
        }
      }
    }

    // Existing geometric rungs, per element in this tier: shrink -> truncate/crop -> drop.
    for (const target of tier) {
      const id = target.element.id;
      const isPriorityOne = target.element.priority === 1;

      // SHRINK: collapse this element's preferred size down to its hard minimum.
      const beforeShrink = getItem(pool, id);
      if (
        beforeShrink &&
        (beforeShrink.measurement.prefWidth > beforeShrink.measurement.minWidth ||
          beforeShrink.measurement.prefHeight > beforeShrink.measurement.minHeight)
      ) {
        pool = pool.map((p) =>
          p.element.id === id
            ? { ...p, shrunk: true, measurement: { ...p.measurement, prefWidth: p.measurement.minWidth, prefHeight: p.measurement.minHeight } }
            : p,
        );
        attemptNumber++;
        attempt = attemptResolution(pool, allElements, rect, surface, gap);
        trace.push(`attempt ${attemptNumber} (shrink "${id}"):`, ...attempt.trace.map((l) => `  ${l}`));
        if (attempt.best) {
          return buildSuccess(surface.id, attempt.best, initialPool, pool, omitted, explicitDegradations, trace);
        }
      }

      // TRUNCATE: text-only. Geometry is already at its floor after shrink; this marks the
      // element as truncated so the renderer shows an ellipsis and scoring penalizes it —
      // it's a legibility/quality compromise, not an additional size reduction.
      const beforeTrunc = getItem(pool, id);
      if (beforeTrunc && target.element.type === "text" && !beforeTrunc.truncated) {
        pool = pool.map((p) => (p.element.id === id ? { ...p, truncated: true } : p));
        attemptNumber++;
        attempt = attemptResolution(pool, allElements, rect, surface, gap);
        trace.push(`attempt ${attemptNumber} (truncate "${id}"):`, ...attempt.trace.map((l) => `  ${l}`));
        if (attempt.best) {
          return buildSuccess(surface.id, attempt.best, initialPool, pool, omitted, explicitDegradations, trace);
        }
      }

      // CROP: hero images only, switch to a tighter focal-point aspect ratio, if declared.
      const beforeCrop = getItem(pool, id);
      if (
        beforeCrop &&
        beforeCrop.element.type === "image" &&
        beforeCrop.element.role === "hero" &&
        beforeCrop.element.croppedAspectRatio &&
        !beforeCrop.cropped
      ) {
        pool = pool.map((p) =>
          p.element.id === id
            ? { ...p, cropped: true, measurement: measureElement(p.element, surface, rect, p.contentVariant, true) }
            : p,
        );
        attemptNumber++;
        attempt = attemptResolution(pool, allElements, rect, surface, gap);
        trace.push(`attempt ${attemptNumber} (crop "${id}"):`, ...attempt.trace.map((l) => `  ${l}`));
        if (attempt.best) {
          return buildSuccess(surface.id, attempt.best, initialPool, pool, omitted, explicitDegradations, trace);
        }
      }

      // DROP: never for priority-1 elements.
      if (!isPriorityOne && getItem(pool, id)) {
        pool = pool.filter((p) => p.element.id !== id);
        omitted.push({ id, reason: "omitted after priority-based degradation" });
        attemptNumber++;
        attempt = attemptResolution(pool, allElements, rect, surface, gap);
        trace.push(`attempt ${attemptNumber} (drop "${id}"):`, ...attempt.trace.map((l) => `  ${l}`));
        if (attempt.best) {
          explicitDegradations.push({ id, action: "drop", detail: "dropped after priority-based degradation" });
          return buildSuccess(surface.id, attempt.best, initialPool, pool, omitted, explicitDegradations, trace);
        }
      }
    }
  }

  trace.push("no valid layout found after exhausting the degradation ladder");
  return {
    ok: false,
    reason: "no-valid-layout",
    message: `No valid layout exists for surface "${surface.id}" even after full priority-based degradation.`,
    details: trace,
  };
}
