// The orchestrator: measure → strategies → repair → validate → score →
// degrade/retry → ResolvedLayout.
//
// Plain TypeScript, no React import. Every attempt below tries ALL FOUR
// strategies from strategies.ts and keeps the highest-scoring valid one —
// there is no branch anywhere that picks a strategy by surface identity;
// adaptation emerges from repair + validation + scoring against the actual
// available rectangle.
//
// Degradation ladder — a fixed sequence, lowest-priority content first:
//   A. full content, default gap
//   B. full content, compact gap
//   C. brand hidden (its own reserved slot is simply not needed once it's not
//      in the pool — "compress" is already inherent to how strategies size it)
//   D. price -> compact
//   E. CTA -> compact
//   F. price may drop
//   G. hero -> crop, then shrink
//   H. headline -> compact
//   I. no-valid-layout
// Every rung reruns all four strategies. CTA is never dropped — if CTA and a
// priority-1 element can't coexist, resolution fails rather than dropping it.

import type {
  AdElement,
  AdSpec,
  CandidateDiagnostic,
  CompositionMetrics,
  ContinuityHint,
  DegradationRecord,
  ElementRole,
  LayoutCandidate,
  MeasuredElement,
  NormalizedSurfaceProfile,
  OmittedElement,
  ResolutionAttempt,
  ResolveResult,
  ResolvedLayout,
  Rect,
  SurfaceProfile,
} from "./types";
import { normalizeSurfaceProfile, validateAdSpec, validateCandidate, validateSurfaceProfile } from "./validate";
import { compactGapFor, gapFor, measureAll, measureElement } from "./measure";
import { STRATEGIES } from "./strategies";
import { repairCandidate } from "./repair";
import { evaluateComposition, scoreCandidate } from "./score";

export const STRATEGY_SWITCH_MARGIN = 0.06;
export const CONTENT_RESTORE_MARGIN = 0.08;

interface ScoredCandidate {
  candidate: LayoutCandidate;
  score: number;
  composition: CompositionMetrics;
}

interface Attempt {
  best: ScoredCandidate | null;
  previousStrategyResult?: ScoredCandidate;
  diagnostics: CandidateDiagnostic[];
}

/** Tries every strategy once against the current pool. This IS the "reposition"
 * step — every attempt regenerates candidates from scratch across all four
 * strategies, so degradation never needs a separate reposition rung. */
function attemptResolution(
  pool: MeasuredElement[],
  allElements: AdElement[],
  rect: Rect,
  surface: NormalizedSurfaceProfile,
  gap: number,
  continuity: ContinuityHint | undefined,
): Attempt {
  const measuredById = new Map(pool.map((item) => [item.element.id, item.measurement]));
  const elementsById = new Map(pool.map((p) => [p.element.id, p.element]));
  const diagnostics: CandidateDiagnostic[] = [];
  let best: ScoredCandidate | null = null;
  let previousStrategyResult: ScoredCandidate | undefined;

  for (const strategy of STRATEGIES) {
    const raw = pool.length > 0 ? strategy(pool, rect, gap, surface) : null;
    if (!raw) continue;
    const repaired = repairCandidate(raw, pool, rect, gap, surface);
    const validation = validateCandidate(repaired, measuredById, elementsById, surface, rect);
    if (!validation.valid) {
      diagnostics.push({ strategy: repaired.strategy, valid: false, rejectionReasons: validation.reasons });
      continue;
    }
    const composition = evaluateComposition(repaired, rect);
    const score = scoreCandidate(repaired, pool, allElements, rect, composition);
    diagnostics.push({ strategy: repaired.strategy, valid: true, score });
    const scored: ScoredCandidate = { candidate: repaired, score, composition };
    if (continuity && repaired.strategy === continuity.previousStrategy) {
      if (!previousStrategyResult || score > previousStrategyResult.score) previousStrategyResult = scored;
    }
    if (!best || score > best.score) best = scored;
  }

  return { best, previousStrategyResult, diagnostics };
}

/** Strategy hysteresis: keep the previous winner unless a challenger beats it
 * by at least STRATEGY_SWITCH_MARGIN. Purely additive — with no continuity
 * hint this always returns the outright best candidate, unchanged from
 * one-shot behavior. */
function pickWinner(attempt: Attempt, continuity: ContinuityHint | undefined): ScoredCandidate | null {
  if (!attempt.best) return null;
  if (!continuity || attempt.best.candidate.strategy === continuity.previousStrategy) return attempt.best;
  if (!attempt.previousStrategyResult) return attempt.best;
  const gain = attempt.best.score - attempt.previousStrategyResult.score;
  return gain >= STRATEGY_SWITCH_MARGIN ? attempt.best : attempt.previousStrategyResult;
}

function getItem(pool: MeasuredElement[], id: string): MeasuredElement | undefined {
  return pool.find((p) => p.element.id === id);
}

function byRole(pool: MeasuredElement[], role: ElementRole): MeasuredElement | undefined {
  return pool.find((p) => p.element.role === role);
}

function diffContentDegradations(initialPool: MeasuredElement[], finalPool: MeasuredElement[]): DegradationRecord[] {
  const initialById = new Map(initialPool.map((p) => [p.element.id, p]));
  const records: DegradationRecord[] = [];
  for (const item of finalPool) {
    const original = initialById.get(item.element.id);
    if (!original) continue;
    if (item.contentVariant === "compact" && original.contentVariant !== "compact") {
      records.push({ id: item.element.id, action: "compact", detail: "switched to compact content" });
    }
    if (item.cropped && !original.cropped) {
      records.push({ id: item.element.id, action: "crop", detail: "switched to a tighter focal-point aspect ratio" });
    }
    if (item.shrunk && !original.shrunk) {
      records.push({ id: item.element.id, action: "shrink", detail: "shrunk to minimum dimensions" });
    }
  }
  return records;
}

function buildSuccess(
  surfaceId: string,
  winner: ScoredCandidate,
  initialPool: MeasuredElement[],
  finalPool: MeasuredElement[],
  omitted: OmittedElement[],
  explicitDegradations: DegradationRecord[],
  attempts: ResolutionAttempt[],
  trace: string[],
): ResolveResult {
  trace.push(`winner: ${winner.candidate.strategy} (score ${winner.score.toFixed(3)})`);
  const layout: ResolvedLayout = {
    surfaceId,
    strategy: winner.candidate.strategy,
    composition: winner.composition,
    score: winner.score,
    boxes: winner.candidate.boxes,
    omitted,
    degradations: [...explicitDegradations, ...diffContentDegradations(initialPool, finalPool)],
    attempts,
    trace,
  };
  return { ok: true, layout };
}

function withCompact(pool: MeasuredElement[], id: string, surface: NormalizedSurfaceProfile, rect: Rect): MeasuredElement[] {
  return pool.map((p) =>
    p.element.id === id
      ? { ...p, contentVariant: "compact", measurement: measureElement(p.element, surface, rect, "compact", p.cropped) }
      : p,
  );
}

export function resolveLayout(spec: AdSpec, surfaceInput: SurfaceProfile, continuity?: ContinuityHint): ResolveResult {
  const specValidation = validateAdSpec(spec);
  if (!specValidation.ok) {
    return { ok: false, reason: "invalid-spec", message: "Ad spec failed validation.", details: specValidation.errors, attempts: [] };
  }
  const surfaceValidation = validateSurfaceProfile(surfaceInput);
  if (!surfaceValidation.ok) {
    return { ok: false, reason: "invalid-surface", message: "Surface profile failed validation.", details: surfaceValidation.errors, attempts: [] };
  }

  const surface = normalizeSurfaceProfile(surfaceInput);
  const rect: Rect = {
    x: surface.safeArea.left,
    y: surface.safeArea.top,
    width: surface.width - surface.safeArea.left - surface.safeArea.right,
    height: surface.height - surface.safeArea.top - surface.safeArea.bottom,
  };

  const allElements = spec.elements;
  const initialPool = measureAll(allElements, surface, rect);
  let pool = initialPool;
  const omitted: OmittedElement[] = [];
  const explicitDegradations: DegradationRecord[] = [];
  const attempts: ResolutionAttempt[] = [];
  const trace: string[] = [
    `surface "${surface.id}" ${surface.width}x${surface.height}`,
    `available rect ${rect.width.toFixed(0)}x${rect.height.toFixed(0)} at (${rect.x.toFixed(0)},${rect.y.toFixed(0)})`,
  ];

  function tryRung(label: string, gap: number, currentPool: MeasuredElement[]): ScoredCandidate | null {
    const attempt = attemptResolution(currentPool, allElements, rect, surface, gap, continuity);
    attempts.push({ label, candidates: attempt.diagnostics, winnerStrategy: attempt.best?.candidate.strategy });
    trace.push(
      `${label}: ${attempt.diagnostics.map((d) => (d.valid ? `${d.strategy}=${d.score!.toFixed(3)}` : `${d.strategy}=rejected`)).join(", ")}`,
    );
    return pickWinner(attempt, continuity);
  }

  const defaultGap = gapFor(rect);
  const compactGap = compactGapFor(rect);

  // A. full content, default gap
  let winner = tryRung("full content / default gap", defaultGap, pool);
  if (winner) return finishAndMaybeRestore(winner, defaultGap);

  // B. full content, compact gap
  winner = tryRung("full content / compact gap", compactGap, pool);
  if (winner) {
    explicitDegradations.push({ id: "*", action: "compact-spacing", detail: `gap reduced to ${compactGap.toFixed(1)}px` });
    return finishAndMaybeRestore(winner, compactGap);
  }

  // C. brand hidden
  const brand = byRole(pool, "branding");
  if (brand) {
    pool = pool.filter((p) => p.element.id !== brand.element.id);
    omitted.push({ id: brand.element.id, reason: "hidden to reserve space for higher-priority content" });
    winner = tryRung(`brand "${brand.element.id}" hidden`, compactGap, pool);
    if (winner) {
      explicitDegradations.push({ id: brand.element.id, action: "hide", detail: "hidden to reserve space" });
      return buildSuccess(surface.id, winner, initialPool, pool, omitted, explicitDegradations, attempts, trace);
    }
  }

  // D. price -> compact
  const price = byRole(pool, "secondary");
  if (price && price.element.type === "text" && price.element.compactContent && price.contentVariant === "full") {
    pool = withCompact(pool, price.element.id, surface, rect);
    winner = tryRung(`price "${price.element.id}" compact`, compactGap, pool);
    if (winner) return buildSuccess(surface.id, winner, initialPool, pool, omitted, explicitDegradations, attempts, trace);
  }

  // E. CTA -> compact
  const cta = byRole(pool, "action");
  if (cta && cta.element.type === "button" && cta.element.compactLabel && cta.contentVariant === "full") {
    pool = withCompact(pool, cta.element.id, surface, rect);
    winner = tryRung(`cta "${cta.element.id}" compact`, compactGap, pool);
    if (winner) return buildSuccess(surface.id, winner, initialPool, pool, omitted, explicitDegradations, attempts, trace);
  }

  // F. price may drop (never priority-1 — price is always priority > 1 by spec convention,
  // but the check is explicit here rather than assumed)
  const priceStillPresent = byRole(pool, "secondary");
  if (priceStillPresent && priceStillPresent.element.priority > 1) {
    pool = pool.filter((p) => p.element.id !== priceStillPresent.element.id);
    omitted.push({ id: priceStillPresent.element.id, reason: "dropped after priority-based degradation" });
    winner = tryRung(`price "${priceStillPresent.element.id}" dropped`, compactGap, pool);
    if (winner) {
      explicitDegradations.push({ id: priceStillPresent.element.id, action: "drop", detail: "dropped after priority-based degradation" });
      return buildSuccess(surface.id, winner, initialPool, pool, omitted, explicitDegradations, attempts, trace);
    }
  }

  // G. hero -> crop, then shrink
  const hero = byRole(pool, "hero");
  if (hero && hero.element.type === "image") {
    if (hero.element.croppedAspectRatio && !hero.cropped) {
      pool = pool.map((p) =>
        p.element.id === hero.element.id ? { ...p, cropped: true, measurement: measureElement(p.element, surface, rect, p.contentVariant, true) } : p,
      );
      winner = tryRung(`hero "${hero.element.id}" cropped`, compactGap, pool);
      if (winner) return buildSuccess(surface.id, winner, initialPool, pool, omitted, explicitDegradations, attempts, trace);
    }
    const beforeShrink = getItem(pool, hero.element.id)!;
    if (beforeShrink.measurement.prefWidth > beforeShrink.measurement.minWidth || beforeShrink.measurement.prefHeight > beforeShrink.measurement.minHeight) {
      pool = pool.map((p) =>
        p.element.id === hero.element.id
          ? { ...p, shrunk: true, measurement: { ...p.measurement, prefWidth: p.measurement.minWidth, prefHeight: p.measurement.minHeight } }
          : p,
      );
      winner = tryRung(`hero "${hero.element.id}" shrunk`, compactGap, pool);
      if (winner) return buildSuccess(surface.id, winner, initialPool, pool, omitted, explicitDegradations, attempts, trace);
    }
  }

  // H. headline -> compact
  const headline = byRole(pool, "primary");
  if (headline && headline.element.type === "text" && headline.element.compactContent && headline.contentVariant === "full") {
    pool = withCompact(pool, headline.element.id, surface, rect);
    winner = tryRung(`headline "${headline.element.id}" compact`, compactGap, pool);
    if (winner) return buildSuccess(surface.id, winner, initialPool, pool, omitted, explicitDegradations, attempts, trace);
  }

  // I. no-valid-layout
  trace.push("no valid layout found after exhausting the degradation ladder");
  return {
    ok: false,
    reason: "no-valid-layout",
    message: `No valid layout exists for surface "${surface.id}" even after full priority-based degradation.`,
    details: trace,
    attempts,
  };

  // Content-restore hysteresis: if rung A/B just succeeded WITHOUT needing to
  // compact anything, but continuity remembers a role as "compact" from the
  // previous resize step, don't eagerly restore it to full unless full scores
  // at least CONTENT_RESTORE_MARGIN better than staying compact — avoids a
  // role flickering full/compact/full across a couple of pixels of drag.
  function finishAndMaybeRestore(current: ScoredCandidate, gap: number): ResolveResult {
    const restoreRoles = continuity?.previousContentVariantByRole;
    if (!restoreRoles) return buildSuccess(surface.id, current, initialPool, pool, omitted, explicitDegradations, attempts, trace);

    let finalWinner = current;
    let workingPool = pool;
    for (const role of ["primary", "secondary", "action"] as ElementRole[]) {
      if (restoreRoles[role] !== "compact") continue;
      const item = byRole(workingPool, role);
      if (!item || item.contentVariant !== "full") continue;
      const hasCompact =
        (item.element.type === "text" && !!item.element.compactContent) || (item.element.type === "button" && !!item.element.compactLabel);
      if (!hasCompact) continue;
      const compactPool = withCompact(workingPool, item.element.id, surface, rect);
      const compactAttempt = attemptResolution(compactPool, allElements, rect, surface, gap, continuity);
      if (compactAttempt.best && finalWinner.score - compactAttempt.best.score < CONTENT_RESTORE_MARGIN) {
        workingPool = compactPool;
        finalWinner = compactAttempt.best;
        explicitDegradations.push({ id: item.element.id, action: "compact", detail: "held compact to avoid restore flicker" });
      }
    }
    return buildSuccess(surface.id, finalWinner, initialPool, workingPool, omitted, explicitDegradations, attempts, trace);
  }
}
