// Deterministic candidate scoring. Hard validation always runs first; these
// soft metrics choose the most useful, balanced composition among valid
// candidates. Every term is a pure function of resolved geometry — nothing
// here keys off a strategy name or a checkpoint dimension.

import type { AdElement, CompositionMetrics, LayoutCandidate, MeasuredElement, Rect, ResolvedBox } from "./types";

export const SCORE_WEIGHTS = {
  priorityRetention: 0.25,
  frameUsage: 0.18,
  heroQualityAndProminence: 0.2,
  visualBalance: 0.15,
  preferredSize: 0.1,
  hierarchyAndSpacing: 0.08,
  alignmentConsistency: 0.04,
};

export const SCORE_PENALTIES = {
  deadRegion: 0.12,
  degradation: 0.08,
  crop: 0.04,
  excessiveEnlargement: 0.05,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function priorityRetention(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>, allElements: AdElement[]): number {
  const totalValue = allElements.reduce((sum, element) => sum + 1 / element.priority, 0);
  if (totalValue <= 0) return 1;
  const visibleValue = candidate.boxes.reduce((sum, box) => {
    const item = poolById.get(box.id);
    return item ? sum + 1 / item.element.priority : sum;
  }, 0);
  return visibleValue / totalValue;
}

/** Peaks at ~85% coverage, tapers off on both sides — a sparse composition
 * is penalized for wasting the frame, but 100% occupancy isn't automatically
 * "better" than a well-composed 85%. */
function usageCurve(coverage: number): number {
  return clamp01(1 - Math.abs(coverage - 0.85) / 0.85);
}

function frameUsage(metrics: CompositionMetrics): number {
  return (usageCurve(metrics.coverageX) + usageCurve(metrics.coverageY)) / 2;
}

function heroQualityAndProminence(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>, rect: Rect): number {
  const heroes = candidate.boxes.filter((box) => poolById.get(box.id)?.element.role === "hero");
  if (heroes.length === 0) return 1;
  const rectArea = rect.width * rect.height;
  const scores = heroes.map((box) => {
    const item = poolById.get(box.id)!;
    const preferredAspect = item.measurement.prefWidth / item.measurement.prefHeight;
    const actualAspect = box.width / box.height;
    const aspectFidelity = clamp01(1 - Math.abs(actualAspect - preferredAspect) / preferredAspect);
    // Peaks around ~45% of the frame — a hero doesn't need to eat the whole
    // surface to read as prominent, and one that DOES eat the whole surface
    // (edge-to-edge, no room for anything else to breathe) reads as crowding,
    // not confidence. Same shape as frameUsage's curve, different center.
    const areaRatio = rectArea > 0 ? (box.width * box.height) / rectArea : 0;
    const prominence = clamp01(1 - Math.abs(areaRatio - 0.45) / 0.45);
    return aspectFidelity * 0.5 + prominence * 0.5;
  });
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function dimensionFidelity(actual: number, preferred: number): number {
  if (preferred <= 0) return 1;
  const ratio = actual / preferred;
  if (ratio <= 1) return clamp01(ratio);
  // Growth is allowed to earn better frame use, but extreme enlargement is a
  // visible compromise — the shallow slope keeps a useful fill candidate viable.
  return 1 / (1 + (ratio - 1) * 0.15);
}

function preferredSize(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>): number {
  if (candidate.boxes.length === 0) return 0;
  const scores = candidate.boxes.map((box) => {
    const item = poolById.get(box.id);
    if (!item) return 0;
    return (
      dimensionFidelity(box.width, item.measurement.prefWidth) +
      dimensionFidelity(box.height, item.measurement.prefHeight)
    ) / 2;
  });
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function spacingConsistency(candidate: LayoutCandidate): number {
  const gaps: number[] = [];
  for (let i = 0; i < candidate.boxes.length; i++) {
    for (let j = i + 1; j < candidate.boxes.length; j++) {
      const a = candidate.boxes[i]!;
      const b = candidate.boxes[j]!;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX > 0) {
        const upper = a.y <= b.y ? a : b;
        const lower = upper === a ? b : a;
        const gap = lower.y - (upper.y + upper.height);
        if (gap >= 0) gaps.push(gap);
      } else if (overlapY > 0) {
        const left = a.x <= b.x ? a : b;
        const right = left === a ? b : a;
        const gap = right.x - (left.x + left.width);
        if (gap >= 0) gaps.push(gap);
      }
    }
  }
  if (gaps.length <= 1) return 1;
  const mean = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  if (mean <= 0) return 1;
  const meanDeviation = gaps.reduce((sum, value) => sum + Math.abs(value - mean), 0) / gaps.length;
  return clamp01(1 - meanDeviation / mean);
}

function hierarchyQuality(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>): number {
  const hero = candidate.boxes.find((box) => poolById.get(box.id)?.element.role === "hero");
  const primary = candidate.boxes.find((box) => poolById.get(box.id)?.element.role === "primary");
  const secondary = candidate.boxes.find((box) => poolById.get(box.id)?.element.role === "secondary");
  const action = candidate.boxes.find((box) => poolById.get(box.id)?.element.role === "action");
  const scores: number[] = [];
  if (hero) {
    const largestOther = Math.max(1, ...candidate.boxes.filter((box) => box !== hero).map((box) => box.width * box.height));
    scores.push(clamp01((hero.width * hero.height) / largestOther));
  }
  if (primary && secondary) scores.push(clamp01(primary.height / secondary.height));
  if (action && secondary) scores.push(clamp01(action.height / secondary.height));
  return scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 1;
}

function hierarchyAndSpacing(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>): number {
  return (spacingConsistency(candidate) + hierarchyQuality(candidate, poolById)) / 2;
}

/** Distinct starting edges relative to element count — fewer unique x/y
 * origins reads as a more deliberately aligned composition. */
function alignmentConsistency(candidate: LayoutCandidate): number {
  const boxes = candidate.boxes;
  if (boxes.length <= 1) return 1;
  const uniqueX = new Set(boxes.map((b) => Math.round(b.x))).size;
  const uniqueY = new Set(boxes.map((b) => Math.round(b.y))).size;
  const xScore = clamp01(1 - (uniqueX - 1) / boxes.length);
  const yScore = clamp01(1 - (uniqueY - 1) / boxes.length);
  return (xScore + yScore) / 2;
}

function intersectionArea(boxes: ResolvedBox[], region: Rect): number {
  let sum = 0;
  for (const box of boxes) {
    const overlapX = Math.min(box.x + box.width, region.x + region.width) - Math.max(box.x, region.x);
    const overlapY = Math.min(box.y + box.height, region.y + region.height) - Math.max(box.y, region.y);
    if (overlapX > 0 && overlapY > 0) sum += overlapX * overlapY;
  }
  return sum;
}

/** Region-aware: splits the rect into left/right and top/bottom halves and
 * checks the WORST-covered half on each axis — catches a lopsided dead
 * pocket (e.g. an empty left column) that a single global coverage number
 * hides behind an otherwise-full bounding box. Also checks the CENTER third
 * directly — a composition that pushes everything to the far edges can still
 * score well on the half-based checks (each half has some content near its
 * own edge) while leaving a hollow, empty middle. */
function deadRegionPenalty(candidate: LayoutCandidate, rect: Rect): number {
  if (rect.width <= 0 || rect.height <= 0) return 0;
  const halfArea = (rect.width / 2) * rect.height;
  const left = intersectionArea(candidate.boxes, { x: rect.x, y: rect.y, width: rect.width / 2, height: rect.height });
  const right = intersectionArea(candidate.boxes, { x: rect.x + rect.width / 2, y: rect.y, width: rect.width / 2, height: rect.height });
  const worstHorizontal = halfArea > 0 ? clamp01(Math.min(left, right) / halfArea) : 1;

  const halfAreaV = rect.width * (rect.height / 2);
  const top = intersectionArea(candidate.boxes, { x: rect.x, y: rect.y, width: rect.width, height: rect.height / 2 });
  const bottom = intersectionArea(candidate.boxes, { x: rect.x, y: rect.y + rect.height / 2, width: rect.width, height: rect.height / 2 });
  const worstVertical = halfAreaV > 0 ? clamp01(Math.min(top, bottom) / halfAreaV) : 1;

  const thirdWidth = rect.width / 3;
  const centerThirdArea = thirdWidth * rect.height;
  const centerCoverage = intersectionArea(candidate.boxes, { x: rect.x + thirdWidth, y: rect.y, width: thirdWidth, height: rect.height });
  const centerThird = centerThirdArea > 0 ? clamp01(centerCoverage / centerThirdArea) : 1;

  return clamp01(1 - (worstHorizontal + worstVertical + centerThird) / 3);
}

function degradationPenalty(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>, allElements: AdElement[]): number {
  if (allElements.length === 0) return 0;
  const degraded = candidate.boxes.filter((box) => {
    const item = poolById.get(box.id);
    return item && (item.contentVariant === "compact" || item.shrunk);
  }).length;
  return degraded / allElements.length;
}

function cropPenalty(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>): number {
  if (candidate.boxes.length === 0) return 0;
  const cropped = candidate.boxes.filter((box) => poolById.get(box.id)?.cropped).length;
  return cropped / candidate.boxes.length;
}

function excessiveEnlargementPenalty(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>): number {
  if (candidate.boxes.length === 0) return 0;
  const scores = candidate.boxes.map((box) => {
    const item = poolById.get(box.id);
    if (!item) return 0;
    const largestRatio = Math.max(
      box.width / item.measurement.prefWidth,
      box.height / item.measurement.prefHeight,
    );
    // Growth up to 2x supports frame filling; beyond that, progressively
    // charge a separate negative term even when the semantic cap still allows it.
    return clamp01((largestRatio - 2) / 3);
  });
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

export function evaluateComposition(candidate: LayoutCandidate, rect: Rect): CompositionMetrics {
  if (candidate.boxes.length === 0 || rect.width <= 0 || rect.height <= 0) {
    return { coverageX: 0, coverageY: 0, balanceX: 0, balanceY: 0, spacingConsistency: 0 };
  }
  const left = Math.min(...candidate.boxes.map((box) => box.x));
  const right = Math.max(...candidate.boxes.map((box) => box.x + box.width));
  const top = Math.min(...candidate.boxes.map((box) => box.y));
  const bottom = Math.max(...candidate.boxes.map((box) => box.y + box.height));
  const leftSlack = Math.max(0, left - rect.x);
  const rightSlack = Math.max(0, rect.x + rect.width - right);
  const topSlack = Math.max(0, top - rect.y);
  const bottomSlack = Math.max(0, rect.y + rect.height - bottom);

  return {
    coverageX: clamp01((right - left) / rect.width),
    coverageY: clamp01((bottom - top) / rect.height),
    balanceX: clamp01(1 - Math.abs(leftSlack - rightSlack) / rect.width),
    balanceY: clamp01(1 - Math.abs(topSlack - bottomSlack) / rect.height),
    spacingConsistency: spacingConsistency(candidate),
  };
}

export function scoreCandidate(
  candidate: LayoutCandidate,
  pool: MeasuredElement[],
  allElements: AdElement[],
  rect: Rect,
  composition: CompositionMetrics = evaluateComposition(candidate, rect),
): number {
  const poolById = new Map(pool.map((item) => [item.element.id, item]));
  const visualBalance = (composition.balanceX + composition.balanceY) / 2;

  const raw =
    SCORE_WEIGHTS.priorityRetention * priorityRetention(candidate, poolById, allElements) +
    SCORE_WEIGHTS.frameUsage * frameUsage(composition) +
    SCORE_WEIGHTS.heroQualityAndProminence * heroQualityAndProminence(candidate, poolById, rect) +
    SCORE_WEIGHTS.visualBalance * visualBalance +
    SCORE_WEIGHTS.preferredSize * preferredSize(candidate, poolById) +
    SCORE_WEIGHTS.hierarchyAndSpacing * hierarchyAndSpacing(candidate, poolById) +
    SCORE_WEIGHTS.alignmentConsistency * alignmentConsistency(candidate) -
    SCORE_PENALTIES.deadRegion * deadRegionPenalty(candidate, rect) -
    SCORE_PENALTIES.degradation * degradationPenalty(candidate, poolById, allElements) -
    SCORE_PENALTIES.crop * cropPenalty(candidate, poolById) -
    SCORE_PENALTIES.excessiveEnlargement * excessiveEnlargementPenalty(candidate, poolById);

  return clamp01(raw);
}
