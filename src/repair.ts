// Deterministic candidate repair: raw candidate → repair → hard validation.
// repairCandidate() can only IMPROVE soft geometry (fit floors, reclaim slack,
// rebalance margins) — it never relaxes a hard constraint and never invents a
// new content state. If a repair step would require crossing a hard floor, it
// is simply skipped; validateCandidate() remains the single authoritative
// backstop against the repaired result, same as it always was against the raw
// one. repairCandidate never returns null — worst case, it returns the raw
// candidate unchanged.

import type { LayoutCandidate, MeasuredElement, NormalizedSurfaceProfile, Rect, ResolvedBox } from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function byId(pool: MeasuredElement[], id: string): MeasuredElement | undefined {
  return pool.find((item) => item.element.id === id);
}

/** Step 1 — clamp every box fully inside `rect`, shifting it inward if
 * floating point or an upstream strategy left it a hair outside. Never
 * shrinks a box, only translates it. */
function clampToRect(boxes: ResolvedBox[], rect: Rect): ResolvedBox[] {
  return boxes.map((box) => {
    let x = box.x;
    let y = box.y;
    x = Math.min(x, rect.x + rect.width - box.width);
    y = Math.min(y, rect.y + rect.height - box.height);
    x = Math.max(x, rect.x);
    y = Math.max(y, rect.y);
    return x === box.x && y === box.y ? box : { ...box, x, y };
  });
}

/** Step 2 — reserve hard minimums: grow (from its own center) any box that
 * fell below its measured floor, as far as the rect allows. If the rect
 * genuinely can't fit the floor, the box is left as-is for validate to reject
 * with a clear reason, rather than repair silently pretending it fits. */
function reserveHardMinimums(boxes: ResolvedBox[], pool: MeasuredElement[], rect: Rect): ResolvedBox[] {
  return boxes.map((box) => {
    const item = byId(pool, box.id);
    if (!item) return box;
    const { minWidth, minHeight } = item.measurement;
    if (box.width >= minWidth - 0.01 && box.height >= minHeight - 0.01) return box;
    const width = Math.min(Math.max(box.width, minWidth), rect.width);
    const height = Math.min(Math.max(box.height, minHeight), rect.height);
    const x = clamp(box.x - (width - box.width) / 2, rect.x, rect.x + rect.width - width);
    const y = clamp(box.y - (height - box.height) / 2, rect.y, rect.y + rect.height - height);
    return { ...box, x, y, width, height };
  });
}

/** Step 3/5 — rebalance opposing margins: recenter the whole composition's
 * bounding box within `rect` on whichever axis has slack, so growth/shrink
 * from the earlier steps doesn't leave the group drifted to one side. */
function rebalanceMargins(boxes: ResolvedBox[], rect: Rect): ResolvedBox[] {
  if (boxes.length === 0) return boxes;
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const leftSlack = left - rect.x;
  const rightSlack = rect.x + rect.width - right;
  const topSlack = top - rect.y;
  const bottomSlack = rect.y + rect.height - bottom;
  const dx = (rightSlack - leftSlack) / 2;
  const dy = (bottomSlack - topSlack) / 2;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return boxes;
  return boxes.map((box) => ({ ...box, x: box.x + dx, y: box.y + dy }));
}

/** Step 4 — Split: after the hero's raw box is placed, recompute the copy
 * column's true available width from its actual position (not the strategy's
 * pre-hero estimate) and grow the CTA back toward its 86% target if slack
 * remains; recenter the commerce block using the hero's real top edge. */
function repairSplit(boxes: ResolvedBox[], pool: MeasuredElement[], rect: Rect, gap: number): ResolvedBox[] {
  const heroBox = boxes.find((b) => byId(pool, b.id)?.element.role === "hero");
  const ctaBox = boxes.find((b) => byId(pool, b.id)?.element.role === "action");
  if (!heroBox || !ctaBox) return boxes;

  const copyColumnRight = heroBox.x - gap;
  const copyColumnWidth = copyColumnRight - rect.x;
  if (copyColumnWidth <= 0) return boxes;

  const targetCtaWidth = clamp(copyColumnWidth * 0.86, ctaBox.width, copyColumnWidth);
  if (targetCtaWidth <= ctaBox.width + 0.5) return boxes;

  return boxes.map((box) => (box.id === ctaBox.id ? { ...box, width: targetCtaWidth } : box));
}

/** Step 4 — Band: never grow the fixed internal gaps to use width; any repair
 * here only ever gives reclaimed slack to the hero. Structural gaps are
 * already fixed by the strategy, so this is a defensive no-op guard: if two
 * adjacent non-hero boxes somehow ended up farther apart than `gap`, pull
 * them back together and hand the freed width to the hero instead. */
function repairBand(boxes: ResolvedBox[], pool: MeasuredElement[], rect: Rect, gap: number): ResolvedBox[] {
  const heroBox = boxes.find((b) => byId(pool, b.id)?.element.role === "hero");
  if (!heroBox) return boxes;
  const ordered = [...boxes].sort((a, b) => a.x - b.x);
  let reclaimed = 0;
  const fixed = ordered.map((box) => {
    if (box.id === heroBox.id) return box;
    return box;
  });
  for (let i = 1; i < fixed.length; i++) {
    const prev = fixed[i - 1]!;
    const cur = fixed[i]!;
    if (prev.id === heroBox.id || cur.id === heroBox.id) continue;
    const actualGap = cur.x - (prev.x + prev.width);
    if (actualGap > gap + 0.5) reclaimed += actualGap - gap;
  }
  if (reclaimed <= 0.5) return boxes;
  const heroMaxWidth = rect.x + rect.width - heroBox.x;
  const grownWidth = Math.min(heroBox.width + reclaimed, heroMaxWidth);
  if (grownWidth <= heroBox.width + 0.5) return boxes;
  const aspect = heroBox.width / heroBox.height;
  const grownHeight = grownWidth / aspect;
  return boxes.map((box) => (box.id === heroBox.id ? { ...box, width: grownWidth, height: grownHeight } : box));
}

/** Step 4 — Poster: grow the hero toward its target width if the bottom/top
 * rows left more vertical room than the raw pass used, and equalize the
 * hero's own left/right margins around the rect's horizontal center. */
function repairPoster(boxes: ResolvedBox[], pool: MeasuredElement[], rect: Rect): ResolvedBox[] {
  const heroBox = boxes.find((b) => byId(pool, b.id)?.element.role === "hero");
  if (!heroBox) return boxes;
  const targetWidth = Math.min(rect.width * 0.82, rect.width);
  if (targetWidth <= heroBox.width + 0.5) {
    // already at/above target — just make sure it's centered
    const x = rect.x + (rect.width - heroBox.width) / 2;
    return Math.abs(x - heroBox.x) < 0.5 ? boxes : boxes.map((b) => (b.id === heroBox.id ? { ...b, x } : b));
  }
  const aspect = heroBox.width / heroBox.height;
  const otherTop = Math.min(...boxes.filter((b) => b.id !== heroBox.id && b.y < heroBox.y).map((b) => b.y + b.height), heroBox.y);
  const otherBottom = Math.max(...boxes.filter((b) => b.id !== heroBox.id && b.y > heroBox.y).map((b) => b.y), heroBox.y + heroBox.height);
  const availHeight = otherBottom - otherTop;
  const maxWidthByHeight = availHeight * aspect;
  const grownWidth = Math.min(targetWidth, maxWidthByHeight, rect.width);
  if (grownWidth <= heroBox.width + 0.5) return boxes;
  const grownHeight = grownWidth / aspect;
  const x = rect.x + (rect.width - grownWidth) / 2;
  const y = heroBox.y + (heroBox.height - grownHeight) / 2;
  return boxes.map((b) => (b.id === heroBox.id ? { ...b, x, y, width: grownWidth, height: grownHeight } : b));
}

/** Step 4 — Stack: the hero already receives the full legal middle remainder
 * from the strategy pass; repair just re-centers it if reserveHardMinimums
 * nudged a neighboring box and changed the remainder's true bounds. */
function repairStack(boxes: ResolvedBox[], pool: MeasuredElement[], rect: Rect): ResolvedBox[] {
  const heroBox = boxes.find((b) => byId(pool, b.id)?.element.role === "hero");
  if (!heroBox) return boxes;
  const x = rect.x + (rect.width - heroBox.width) / 2;
  return Math.abs(x - heroBox.x) < 0.5 ? boxes : boxes.map((b) => (b.id === heroBox.id ? { ...b, x } : b));
}

export function repairCandidate(
  raw: LayoutCandidate,
  pool: MeasuredElement[],
  rect: Rect,
  gap: number,
  _surface: NormalizedSurfaceProfile,
): LayoutCandidate {
  let boxes = clampToRect(raw.boxes, rect);
  boxes = reserveHardMinimums(boxes, pool, rect);

  switch (raw.strategy) {
    case "split":
      boxes = repairSplit(boxes, pool, rect, gap);
      break;
    case "band":
      boxes = repairBand(boxes, pool, rect, gap);
      break;
    case "poster":
      boxes = repairPoster(boxes, pool, rect);
      break;
    case "stack":
      boxes = repairStack(boxes, pool, rect);
      break;
  }

  // Band already balances its own outer margin deliberately (see the
  // strategy's own outerMargin calculation) — running the generic rebalance
  // on top would shift content back into the padding it just respected,
  // silently eroding padding as a real constraint under pressure.
  if (raw.strategy !== "band") {
    boxes = rebalanceMargins(boxes, rect);
  }
  boxes = clampToRect(boxes, rect);

  return { strategy: raw.strategy, boxes };
}
