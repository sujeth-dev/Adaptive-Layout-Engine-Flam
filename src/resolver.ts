// The orchestrator: measure → candidates → validate → score → degrade/retry → ResolvedLayout.
//
// Plain TypeScript, no React import. Every "attempt" below tries ALL strategies
// from strategies.ts and keeps the highest-scoring valid one — there is no
// branch anywhere that picks a strategy by surface identity or aspect-ratio
// threshold; adaptation emerges from validation + scoring against the actual
// available rectangle.

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
import { measureAll } from "./measure";
import { STRATEGIES } from "./strategies";
import { scoreCandidate } from "./score";

interface Attempt {
  best: { candidate: LayoutCandidate; score: number } | null;
  trace: string[];
}

/** Tries every strategy once against the current pool. This IS the "reposition" step —
 * every attempt regenerates candidates from scratch across all strategies, so degradation
 * never needs a separate reposition rung; it's inherent to calling this again. */
function attemptResolution(pool: MeasuredElement[], allElements: AdElement[], rect: Rect, surface: NormalizedSurfaceProfile): Attempt {
  const trace: string[] = [];
  const measuredById = new Map(pool.map((p) => [p.element.id, p.measurement]));
  const elementsById = new Map(pool.map((p) => [p.element.id, p.element]));
  let best: { candidate: LayoutCandidate; score: number } | null = null;

  for (const strategy of STRATEGIES) {
    const candidate = pool.length > 0 ? strategy(pool, rect) : null;
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

function buildSuccess(
  surfaceId: string,
  best: { candidate: LayoutCandidate; score: number },
  omitted: OmittedElement[],
  degradations: DegradationRecord[],
  trace: string[],
): ResolveResult {
  trace.push(`winner: ${best.candidate.strategy} (score ${best.score.toFixed(3)})`);
  const layout: ResolvedLayout = {
    surfaceId,
    strategy: best.candidate.strategy,
    score: best.score,
    boxes: best.candidate.boxes,
    omitted,
    degradations,
    trace,
  };
  return { ok: true, layout };
}

function getItem(pool: MeasuredElement[], id: string): MeasuredElement | undefined {
  return pool.find((p) => p.element.id === id);
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
  let pool = measureAll(allElements, surface, rect);
  const omitted: OmittedElement[] = [];
  const degradations: DegradationRecord[] = [];
  const trace: string[] = [
    `surface "${surface.id}" ${surface.width}x${surface.height}`,
    `available rect ${rect.width.toFixed(0)}x${rect.height.toFixed(0)} at (${rect.x.toFixed(0)},${rect.y.toFixed(0)})`,
  ];

  let attemptNumber = 1;
  let attempt = attemptResolution(pool, allElements, rect, surface);
  trace.push(`attempt ${attemptNumber} (full size):`, ...attempt.trace.map((l) => `  ${l}`));
  if (attempt.best) {
    return buildSuccess(surface.id, attempt.best, omitted, degradations, trace);
  }

  // Degradation ladder: lowest priority first (highest priority number first).
  // shrink -> truncate -> drop, per element, cumulative across the whole pool.
  // Priority-1 elements go through shrink like everything else but are never dropped.
  const degradeOrder = [...pool].sort(
    (a, b) => b.element.priority - a.element.priority || a.element.id.localeCompare(b.element.id),
  );

  for (const target of degradeOrder) {
    const id = target.element.id;
    const isPriorityOne = target.element.priority === 1;

    // SHRINK: collapse this element's preferred size down to its hard minimum.
    const beforeShrink = getItem(pool, id);
    if (beforeShrink && (beforeShrink.measurement.prefWidth > beforeShrink.measurement.minWidth ||
        beforeShrink.measurement.prefHeight > beforeShrink.measurement.minHeight)) {
      pool = pool.map((p) =>
        p.element.id === id
          ? { ...p, measurement: { ...p.measurement, prefWidth: p.measurement.minWidth, prefHeight: p.measurement.minHeight } }
          : p,
      );
      attemptNumber++;
      attempt = attemptResolution(pool, allElements, rect, surface);
      trace.push(`attempt ${attemptNumber} (shrink "${id}"):`, ...attempt.trace.map((l) => `  ${l}`));
      if (attempt.best) {
        degradations.push({ id, action: "shrink", detail: "shrunk to minimum dimensions" });
        return buildSuccess(surface.id, attempt.best, omitted, degradations, trace);
      }
    }

    // TRUNCATE: text-only. Geometry is already at its floor after shrink; this marks the
    // element as truncated so the renderer shows an ellipsis and scoring penalizes it —
    // it's a legibility/quality compromise, not an additional size reduction.
    const beforeTrunc = getItem(pool, id);
    if (beforeTrunc && target.element.type === "text" && !beforeTrunc.truncated) {
      pool = pool.map((p) => (p.element.id === id ? { ...p, truncated: true } : p));
      attemptNumber++;
      attempt = attemptResolution(pool, allElements, rect, surface);
      trace.push(`attempt ${attemptNumber} (truncate "${id}"):`, ...attempt.trace.map((l) => `  ${l}`));
      if (attempt.best) {
        degradations.push({ id, action: "truncate", detail: "text truncated to minimum width" });
        return buildSuccess(surface.id, attempt.best, omitted, degradations, trace);
      }
    }

    // DROP: never for priority-1 elements.
    if (!isPriorityOne && getItem(pool, id)) {
      pool = pool.filter((p) => p.element.id !== id);
      omitted.push({ id, reason: "omitted after priority-based degradation" });
      attemptNumber++;
      attempt = attemptResolution(pool, allElements, rect, surface);
      trace.push(`attempt ${attemptNumber} (drop "${id}"):`, ...attempt.trace.map((l) => `  ${l}`));
      if (attempt.best) {
        degradations.push({ id, action: "drop", detail: "dropped after priority-based degradation" });
        return buildSuccess(surface.id, attempt.best, omitted, degradations, trace);
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
