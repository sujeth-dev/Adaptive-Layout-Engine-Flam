// Generic candidate layout strategies.
//
// Every strategy is tried for every surface, unconditionally — there is no
// "if wide use horizontal-band" branch anywhere. Each strategy is a pure
// geometric composition driven only by the available rectangle and the
// measured elements (content role + measured size, never surface identity).
// A strategy may produce geometry that overflows the rect or shrinks below a
// floor — that's expected, hard validation (validate.ts) is what rejects it.
// Scoring then picks the best surviving candidate. This is what makes portrait
// vs. broadcast diverge structurally: different rects make different
// strategies valid/highly scored, not a lookup table.

import type { LayoutCandidate, MeasuredElement, ResolvedBox, Rect } from "./types";
import { inContentOrder } from "./measure";

function clamp(pref: number, min: number, max: number): number {
  return Math.min(Math.max(pref, min), Math.max(min, max));
}

/**
 * Lays out a list of items as a single vertical column inside `columnRect`.
 * Images keep their aspect ratio (derived from prefWidth/prefHeight); text
 * and buttons use their measured height directly (single-line model).
 * `align: "center"` centers the whole stack vertically within the rect —
 * used for band/grid cells; `"start"` fills from the top — used for the
 * primary vertical stack and the split's content column.
 */
function layoutColumn(items: MeasuredElement[], columnRect: Rect, align: "start" | "center", gap: number): ResolvedBox[] {
  const sized = items.map((item) => {
    const { measurement } = item;
    let width = clamp(measurement.prefWidth, measurement.minWidth, columnRect.width);
    let height: number;
    if (item.element.type === "image") {
      const aspect = measurement.prefWidth / measurement.prefHeight;
      height = width / aspect;
      if (height < measurement.minHeight) {
        height = measurement.minHeight;
        width = Math.min(height * aspect, columnRect.width);
      }
    } else {
      height = measurement.prefHeight;
    }
    return { item, width, height };
  });

  const totalHeight = sized.reduce((sum, b) => sum + b.height, 0) + gap * Math.max(0, sized.length - 1);
  let y = align === "center" ? columnRect.y + Math.max(0, (columnRect.height - totalHeight) / 2) : columnRect.y;

  return sized.map(({ item, width, height }) => {
    const x = columnRect.x + Math.max(0, (columnRect.width - width) / 2);
    const box: ResolvedBox = { id: item.element.id, x, y, width, height };
    y += height + gap;
    return box;
  });
}

/** Height-dominant composition: everything stacked top to bottom, content order.
 * Centered vertically: on a surface much taller than the content needs, this reads as a
 * deliberately composed layout with generous margins, not content glued to the top edge
 * with empty canvas below it. */
function verticalStack(items: MeasuredElement[], rect: Rect, gap: number): LayoutCandidate | null {
  const ordered = inContentOrder(items);
  if (ordered.length === 0) return null;
  const boxes = layoutColumn(ordered, rect, "center", gap);
  return { strategy: "vertical-stack", boxes };
}

function groupByRole(items: MeasuredElement[]) {
  const map = new Map<string, MeasuredElement[]>();
  for (const item of items) {
    const list = map.get(item.element.role) ?? [];
    list.push(item);
    map.set(item.element.role, list);
  }
  return map;
}

/** Width-dominant composition: logo | hero | text cluster | action, side by side. */
function horizontalBand(items: MeasuredElement[], rect: Rect, gap: number): LayoutCandidate | null {
  const byRole = groupByRole(items);
  const groups = [
    byRole.get("branding") ?? [],
    byRole.get("hero") ?? [],
    [...(byRole.get("primary") ?? []), ...(byRole.get("secondary") ?? [])],
    byRole.get("action") ?? [],
  ].filter((g) => g.length > 0);

  if (groups.length === 0) return null;

  const prefWidths = groups.map((g) => Math.max(...g.map((i) => i.measurement.prefWidth)));
  const minWidths = groups.map((g) => Math.max(...g.map((i) => i.measurement.minWidth)));
  const totalGap = gap * (groups.length - 1);
  const totalPref = prefWidths.reduce((a, b) => a + b, 0);
  const availableForCols = rect.width - totalGap;
  const scale = totalPref > 0 ? availableForCols / totalPref : 1;

  const boxes: ResolvedBox[] = [];
  // When there's slack (scale >= 1), columns stay at their preferred width rather than
  // stretching arbitrarily — but the whole row centers within the rect instead of hugging
  // the left edge, so leftover space reads as balanced margins, not a one-sided void.
  const contentWidth = totalPref + totalGap;
  let x = scale >= 1 ? rect.x + Math.max(0, (rect.width - contentWidth) / 2) : rect.x;
  for (let i = 0; i < groups.length; i++) {
    const prefW = prefWidths[i]!;
    const minW = minWidths[i]!;
    const w = scale >= 1 ? prefW : Math.max(minW, prefW * scale);
    if (w <= 0) return null;
    const colRect: Rect = { x, y: rect.y, width: w, height: rect.height };
    boxes.push(...layoutColumn(groups[i]!, colRect, "center", gap));
    x += w + gap;
  }
  return { strategy: "horizontal-band", boxes };
}

/** Hero on one side, everything else stacked on the other. */
function sideBySideSplit(items: MeasuredElement[], rect: Rect, gap: number): LayoutCandidate | null {
  const heroItems = items.filter((i) => i.element.role === "hero");
  const restItems = inContentOrder(items.filter((i) => i.element.role !== "hero"));
  if (heroItems.length === 0 && restItems.length === 0) return null;

  const heroPrefWidth = heroItems.length ? Math.max(...heroItems.map((i) => i.measurement.prefWidth)) : 0;
  const restPrefWidth = restItems.length ? Math.max(...restItems.map((i) => i.measurement.prefWidth)) : 0;
  const totalPref = heroPrefWidth + restPrefWidth;

  const heroMinWidth = heroItems.length ? Math.max(...heroItems.map((i) => i.measurement.minWidth)) : 0;
  let heroWidth = totalPref > 0 ? rect.width * (heroPrefWidth / totalPref) : rect.width / 2;
  heroWidth = clamp(heroWidth, heroMinWidth, rect.width);

  const restWidth = rect.width - heroWidth - (restItems.length ? gap : 0);
  if (restItems.length > 0 && restWidth <= 0) return null;

  const boxes: ResolvedBox[] = [];
  if (heroItems.length) {
    boxes.push(...layoutColumn(heroItems, { x: rect.x, y: rect.y, width: heroWidth, height: rect.height }, "center", gap));
  }
  if (restItems.length) {
    boxes.push(
      ...layoutColumn(restItems, { x: rect.x + heroWidth + gap, y: rect.y, width: restWidth, height: rect.height }, "center", gap),
    );
  }
  return boxes.length > 0 ? { strategy: "side-by-side-split", boxes } : null;
}

/** 2-column grid, content order, row-major — suits near-square surfaces. */
function adaptiveGrid(items: MeasuredElement[], rect: Rect, gap: number): LayoutCandidate | null {
  const ordered = inContentOrder(items);
  if (ordered.length === 0) return null;

  const cols = 2;
  const rows = Math.ceil(ordered.length / cols);
  const colWidth = (rect.width - gap * (cols - 1)) / cols;
  const rowHeight = (rect.height - gap * (rows - 1)) / rows;
  if (colWidth <= 0 || rowHeight <= 0) return null;

  const boxes: ResolvedBox[] = ordered.map((item, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const cellRect: Rect = {
      x: rect.x + col * (colWidth + gap),
      y: rect.y + row * (rowHeight + gap),
      width: colWidth,
      height: rowHeight,
    };
    return layoutColumn([item], cellRect, "center", gap)[0]!;
  });

  return { strategy: "adaptive-grid", boxes };
}

export const STRATEGIES: Array<(items: MeasuredElement[], rect: Rect, gap: number) => LayoutCandidate | null> = [
  verticalStack,
  horizontalBand,
  sideBySideSplit,
  adaptiveGrid,
];
