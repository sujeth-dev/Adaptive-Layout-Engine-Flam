// Deterministic candidate scoring. Hard validation always runs first; these
// soft metrics choose the most useful, balanced composition among valid boxes.

import type { AdElement, CompositionMetrics, LayoutCandidate, MeasuredElement, Rect } from "./types";

export const SCORE_WEIGHTS = {
  priorityRetained: 0.3,
  frameCoverage: 0.2,
  heroShape: 0.2,
  preferredSize: 0.1,
  edgeBalance: 0.1,
  rhythmAndHierarchy: 0.1,
  truncationPenalty: 0.1,
  excessiveGrowthPenalty: 0.01,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function priorityRetained(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>, allElements: AdElement[]): number {
  const totalValue = allElements.reduce((sum, element) => sum + 1 / element.priority, 0);
  if (totalValue <= 0) return 1;
  const visibleValue = candidate.boxes.reduce((sum, box) => {
    const item = poolById.get(box.id);
    return item ? sum + 1 / item.element.priority : sum;
  }, 0);
  return visibleValue / totalValue;
}

function heroShapeQuality(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>): number {
  const heroes = candidate.boxes.filter((box) => poolById.get(box.id)?.element.role === "hero");
  if (heroes.length === 0) return 1;
  const scores = heroes.map((box) => {
    const item = poolById.get(box.id)!;
    const preferredAspect = item.measurement.prefWidth / item.measurement.prefHeight;
    const actualAspect = box.width / box.height;
    return clamp01(1 - Math.abs(actualAspect - preferredAspect) / preferredAspect);
  });
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function dimensionFidelity(actual: number, preferred: number): number {
  if (preferred <= 0) return 1;
  const ratio = actual / preferred;
  if (ratio <= 1) return clamp01(ratio);
  // Growth is allowed to earn better frame use, but extreme enlargement is a
  // visible compromise. The shallow slope keeps a useful fill candidate viable.
  return 1 / (1 + (ratio - 1) * 0.15);
}

function preferredSizeFidelity(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>): number {
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
  if (candidate.strategy === "vertical-stack") {
    const ordered = [...candidate.boxes].sort((a, b) => a.y - b.y);
    const adjacent = ordered.slice(1).map((box, index) => {
      const previous = ordered[index]!;
      return box.y - (previous.y + previous.height);
    });
    if (adjacent.some((gap) => gap < 0)) return 0;
    if (adjacent.length <= 1) return 1;
    const mean = adjacent.reduce((sum, value) => sum + value, 0) / adjacent.length;
    if (mean <= 0) return 1;
    const deviation = adjacent.reduce((sum, value) => sum + Math.abs(value - mean), 0) / adjacent.length;
    return clamp01(1 - deviation / mean);
  }

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

function coverageQuality(candidate: LayoutCandidate, metrics: CompositionMetrics): number {
  const targets: Record<string, { x: number; y: number; xWeight: number }> = {
    "vertical-stack": { x: 0.95, y: 0.85, xWeight: 0.55 },
    "horizontal-band": { x: 0.8, y: 0.72, xWeight: 0.65 },
    "side-by-side-split": { x: 0.9, y: 0.65, xWeight: 0.55 },
    "adaptive-grid": { x: 0.62, y: 0.62, xWeight: 0.5 },
  };
  const target = targets[candidate.strategy] ?? { x: 0.75, y: 0.75, xWeight: 0.5 };
  const x = clamp01(metrics.coverageX / target.x);
  const y = clamp01(metrics.coverageY / target.y);
  return x * target.xWeight + y * (1 - target.xWeight);
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

function truncationPenalty(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>): number {
  if (candidate.boxes.length === 0) return 0;
  const truncated = candidate.boxes.filter((box) => poolById.get(box.id)?.truncated).length;
  return truncated / candidate.boxes.length;
}

function excessiveGrowthPenalty(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>): number {
  if (candidate.boxes.length === 0) return 0;
  const scores = candidate.boxes.map((box) => {
    const item = poolById.get(box.id);
    if (!item) return 0;
    const largestRatio = Math.max(
      box.width / item.measurement.prefWidth,
      box.height / item.measurement.prefHeight,
    );
    // Growth up to 2× supports frame filling. Beyond that, progressively
    // charge a separate negative term even when the semantic cap still allows it.
    return clamp01((largestRatio - 2) / 3);
  });
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

export function scoreCandidate(
  candidate: LayoutCandidate,
  pool: MeasuredElement[],
  allElements: AdElement[],
  rect: Rect,
  composition: CompositionMetrics = evaluateComposition(candidate, rect),
): number {
  const poolById = new Map(pool.map((item) => [item.element.id, item]));
  const balance = (composition.balanceX + composition.balanceY) / 2;
  const rhythmAndHierarchy = (composition.spacingConsistency + hierarchyQuality(candidate, poolById)) / 2;

  return (
    SCORE_WEIGHTS.priorityRetained * priorityRetained(candidate, poolById, allElements) +
    SCORE_WEIGHTS.frameCoverage * coverageQuality(candidate, composition) +
    SCORE_WEIGHTS.heroShape * heroShapeQuality(candidate, poolById) +
    SCORE_WEIGHTS.preferredSize * preferredSizeFidelity(candidate, poolById) +
    SCORE_WEIGHTS.edgeBalance * balance +
    SCORE_WEIGHTS.rhythmAndHierarchy * rhythmAndHierarchy -
    SCORE_WEIGHTS.truncationPenalty * truncationPenalty(candidate, poolById) -
    SCORE_WEIGHTS.excessiveGrowthPenalty * excessiveGrowthPenalty(candidate, poolById)
  );
}
