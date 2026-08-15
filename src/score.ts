// Deterministic candidate scoring. Only candidates that already passed hard
// validation reach this file — scoring picks the best among valid options,
// it never rescues an invalid one.

import type { AdElement, LayoutCandidate, MeasuredElement, Rect } from "./types";

export const SCORE_WEIGHTS = {
  priorityRetained: 0.3,
  heroShape: 0.25,
  preferredSize: 0.2,
  spaceUtilization: 0.15,
  truncationPenalty: 0.1,
};

function priorityRetained(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>, allElements: AdElement[]): number {
  const totalValue = allElements.reduce((sum, el) => sum + 1 / el.priority, 0);
  if (totalValue <= 0) return 1;
  const visibleValue = candidate.boxes.reduce((sum, box) => {
    const item = poolById.get(box.id);
    return item ? sum + 1 / item.element.priority : sum;
  }, 0);
  return visibleValue / totalValue;
}

function heroShapeQuality(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>): number {
  const heroBoxes = candidate.boxes.filter((box) => poolById.get(box.id)?.element.role === "hero");
  if (heroBoxes.length === 0) return 1;

  const scores = heroBoxes.map((box) => {
    const el = poolById.get(box.id)!.element;
    const prefAspect = el.type === "image" && el.aspectRatio ? el.aspectRatio : 1;
    const actualAspect = box.width / box.height;
    const deviation = Math.abs(actualAspect - prefAspect) / prefAspect;
    return Math.max(0, 1 - deviation);
  });
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function preferredSizeSatisfaction(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>): number {
  if (candidate.boxes.length === 0) return 0;
  const scores = candidate.boxes.map((box) => {
    const item = poolById.get(box.id);
    if (!item) return 0;
    const widthRatio = Math.min(box.width / item.measurement.prefWidth, 1);
    const heightRatio = Math.min(box.height / item.measurement.prefHeight, 1);
    return (widthRatio + heightRatio) / 2;
  });
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function spaceUtilization(candidate: LayoutCandidate, rect: Rect): number {
  const rectArea = rect.width * rect.height;
  if (rectArea <= 0) return 0;
  const usedArea = candidate.boxes.reduce((sum, box) => sum + box.width * box.height, 0);
  // capped at 0.8: rewards sensible use of space without forcing 100% occupancy
  return Math.min(usedArea / rectArea, 0.8) / 0.8;
}

function truncationPenalty(candidate: LayoutCandidate, poolById: Map<string, MeasuredElement>): number {
  if (candidate.boxes.length === 0) return 0;
  const truncatedCount = candidate.boxes.filter((box) => poolById.get(box.id)?.truncated).length;
  return truncatedCount / candidate.boxes.length;
}

export function scoreCandidate(candidate: LayoutCandidate, pool: MeasuredElement[], allElements: AdElement[], rect: Rect): number {
  const poolById = new Map(pool.map((item) => [item.element.id, item]));

  return (
    SCORE_WEIGHTS.priorityRetained * priorityRetained(candidate, poolById, allElements) +
    SCORE_WEIGHTS.heroShape * heroShapeQuality(candidate, poolById) +
    SCORE_WEIGHTS.preferredSize * preferredSizeSatisfaction(candidate, poolById) +
    SCORE_WEIGHTS.spaceUtilization * spaceUtilization(candidate, rect) -
    SCORE_WEIGHTS.truncationPenalty * truncationPenalty(candidate, poolById)
  );
}
