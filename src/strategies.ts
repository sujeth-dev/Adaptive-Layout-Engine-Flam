// Generic candidate layout strategies. Every strategy is evaluated in both a
// natural and a frame-filling presentation. Neither path knows a surface id:
// geometry, authored order, roles, and measurements are the only inputs.

import type { LayoutCandidate, MeasuredElement, PresentationVariant, ResolvedBox, Rect } from "./types";
import { inContentOrder } from "./measure";

const MAX_FILL_HERO_WIDTH = 960;
const MAX_FILL_CONTENT_WIDTH = 960;
const MAX_FILL_ACTION_WIDTH = 720;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function fillWidth(item: MeasuredElement, natural: number, rect: Rect): number {
  if (item.shrunk) return natural;
  const role = item.element.role;
  if (role === "hero") return Math.min(rect.width, MAX_FILL_HERO_WIDTH);
  if (role === "primary") return Math.min(rect.width, MAX_FILL_CONTENT_WIDTH);
  if (role === "action") return Math.min(rect.width, MAX_FILL_ACTION_WIDTH);
  if (role === "secondary") return Math.max(natural, Math.min(rect.width * 0.18, 240));
  if (role === "branding") return Math.max(natural, Math.min(rect.width * 0.14, 160));
  return natural;
}

function layoutColumn(
  items: MeasuredElement[],
  columnRect: Rect,
  align: "start" | "center",
  baseGap: number,
  presentation: PresentationVariant,
  distributeFlow = false,
): ResolvedBox[] {
  const sized = items.map((item) => {
    const { measurement } = item;
    const naturalWidth = clamp(measurement.prefWidth, measurement.minWidth, columnRect.width);
    let width = presentation === "frame-fill" ? fillWidth(item, naturalWidth, columnRect) : naturalWidth;
    width = clamp(width, measurement.minWidth, columnRect.width);
    let height: number;

    if (item.element.type === "image") {
      const aspect = measurement.prefWidth / measurement.prefHeight;
      width = Math.min(width, columnRect.height * aspect);
      height = width / aspect;
      if (height < measurement.minHeight) {
        height = measurement.minHeight;
        width = Math.min(height * aspect, columnRect.width);
      }
    } else if (presentation === "frame-fill" && item.element.role === "action" && !item.shrunk) {
      height = Math.max(measurement.prefHeight, Math.min(columnRect.height * 0.12, 72));
    } else if (presentation === "frame-fill" && item.element.role === "primary" && !item.shrunk) {
      height = Math.max(measurement.prefHeight, Math.min(columnRect.height * 0.07, 86.4));
    } else if (presentation === "frame-fill" && item.element.role === "secondary" && !item.shrunk) {
      height = Math.max(measurement.prefHeight, Math.min(columnRect.height * 0.035, 48));
    } else {
      height = measurement.prefHeight;
    }
    return { item, width, height };
  });

  const itemHeight = sized.reduce((sum, box) => sum + box.height, 0);
  let gap = baseGap;
  if (presentation === "frame-fill" && distributeFlow && sized.length > 1) {
    const targetCoverage = sized.length >= 5 ? 0.9 : sized.length === 4 ? 0.8 : sized.length === 3 ? 0.66 : 0.46;
    const desiredGap = (columnRect.height * targetCoverage - itemHeight) / (sized.length - 1);
    // Sparse survivors on a very tall surface need more separation to use the
    // flow axis; denser compositions keep a tighter editorial rhythm.
    const maxGapRatio = sized.length <= 2 ? 0.3 : sized.length === 3 ? 0.22 : 0.12;
    const maxGap = Math.max(baseGap, columnRect.height * maxGapRatio);
    gap = clamp(desiredGap, baseGap, maxGap);
  }

  const totalHeight = itemHeight + gap * Math.max(0, sized.length - 1);
  let y = align === "center" ? columnRect.y + Math.max(0, (columnRect.height - totalHeight) / 2) : columnRect.y;

  return sized.map(({ item, width, height }) => {
    const x = columnRect.x + Math.max(0, (columnRect.width - width) / 2);
    const box: ResolvedBox = { id: item.element.id, x, y, width, height };
    y += height + gap;
    return box;
  });
}

/** Authored reading order in a single column. */
function verticalStack(items: MeasuredElement[], rect: Rect, gap: number, presentation: PresentationVariant): LayoutCandidate | null {
  const ordered = inContentOrder(items);
  if (ordered.length === 0) return null;
  return {
    strategy: "vertical-stack",
    presentation,
    boxes: layoutColumn(ordered, rect, "center", gap, presentation, true),
  };
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

function naturalGroupWidth(group: MeasuredElement[]): number {
  return Math.max(...group.map((item) => item.measurement.prefWidth));
}

function fillBandGroupWidth(group: MeasuredElement[], rect: Rect): number {
  const natural = naturalGroupWidth(group);
  if (group.some((item) => item.element.role === "hero")) {
    const hero = group.find((item) => item.element.role === "hero")!;
    const aspect = hero.measurement.prefWidth / hero.measurement.prefHeight;
    return Math.max(natural, Math.min(rect.height * aspect * 0.9, MAX_FILL_HERO_WIDTH));
  }
  if (group.some((item) => item.element.role === "action")) {
    return Math.max(natural, Math.min(rect.width * 0.12, 320));
  }
  if (group.some((item) => item.element.role === "branding")) {
    return Math.max(natural, Math.min(rect.height * 0.4, 160));
  }
  return natural;
}

/** Branding | hero | text cluster | action, distributed across wide surfaces. */
function horizontalBand(items: MeasuredElement[], rect: Rect, gap: number, presentation: PresentationVariant): LayoutCandidate | null {
  const byRole = groupByRole(items);
  const groups = [
    byRole.get("branding") ?? [],
    byRole.get("hero") ?? [],
    [...(byRole.get("primary") ?? []), ...(byRole.get("secondary") ?? [])],
    byRole.get("action") ?? [],
  ].filter((group) => group.length > 0);
  if (groups.length === 0) return null;

  const prefWidths = groups.map((group) =>
    presentation === "frame-fill" ? fillBandGroupWidth(group, rect) : naturalGroupWidth(group),
  );
  const minWidths = groups.map((group) => Math.max(...group.map((item) => item.measurement.minWidth)));
  const totalPref = prefWidths.reduce((sum, width) => sum + width, 0);
  let actualGap = gap;
  let x = rect.x;

  if (presentation === "frame-fill" && groups.length > 1 && totalPref + gap * (groups.length - 1) <= rect.width * 0.9) {
    const targetSpan = rect.width * 0.9;
    actualGap = (targetSpan - totalPref) / (groups.length - 1);
    x = rect.x + rect.width * 0.05;
  } else {
    const availableForCols = rect.width - gap * (groups.length - 1);
    const scale = totalPref > 0 ? availableForCols / totalPref : 1;
    const contentWidth = totalPref + gap * (groups.length - 1);
    x = scale >= 1 ? rect.x + Math.max(0, (rect.width - contentWidth) / 2) : rect.x;
    if (scale < 1) {
      for (let i = 0; i < prefWidths.length; i++) prefWidths[i] = Math.max(minWidths[i]!, prefWidths[i]! * scale);
    }
  }

  const boxes: ResolvedBox[] = [];
  for (let i = 0; i < groups.length; i++) {
    const width = prefWidths[i]!;
    if (width <= 0) return null;
    const columnRect: Rect = { x, y: rect.y, width, height: rect.height };
    boxes.push(...layoutColumn(groups[i]!, columnRect, "center", gap, presentation, true));
    x += width + actualGap;
  }
  return { strategy: "horizontal-band", presentation, boxes };
}

/** Hero on one side, authored non-hero content on the other. */
function sideBySideSplit(items: MeasuredElement[], rect: Rect, gap: number, presentation: PresentationVariant): LayoutCandidate | null {
  const heroItems = items.filter((item) => item.element.role === "hero");
  const restItems = inContentOrder(items.filter((item) => item.element.role !== "hero"));
  if (heroItems.length === 0 && restItems.length === 0) return null;

  const heroPrefWidth = heroItems.length ? Math.max(...heroItems.map((item) => item.measurement.prefWidth)) : 0;
  const restPrefWidth = restItems.length ? Math.max(...restItems.map((item) => item.measurement.prefWidth)) : 0;
  const heroMinWidth = heroItems.length ? Math.max(...heroItems.map((item) => item.measurement.minWidth)) : 0;
  const totalPref = heroPrefWidth + restPrefWidth;
  let heroWidth = totalPref > 0 ? rect.width * (heroPrefWidth / totalPref) : rect.width / 2;
  if (presentation === "frame-fill" && heroItems.length && restItems.length) {
    // Start with a hero-forward split, then yield only the width needed for the
    // authored text/button column to render its current variants honestly. This
    // avoids a surface-specific ratio and, critically, prevents CSS from silently
    // ellipsizing content that the resolver still reports as "full".
    const restRequiredWidth = Math.max(...restItems.map((item) => item.measurement.prefWidth));
    heroWidth = Math.min(rect.width * 0.35, rect.width - gap - restRequiredWidth);
  }
  heroWidth = clamp(heroWidth, heroMinWidth, Math.min(rect.width, MAX_FILL_HERO_WIDTH));

  const restWidth = rect.width - heroWidth - (restItems.length ? gap : 0);
  if (restItems.length > 0 && restWidth <= 0) return null;

  const boxes: ResolvedBox[] = [];
  if (heroItems.length) {
    boxes.push(...layoutColumn(heroItems, { x: rect.x, y: rect.y, width: heroWidth, height: rect.height }, "center", gap, presentation));
  }
  if (restItems.length) {
    boxes.push(
      ...layoutColumn(
        restItems,
        { x: rect.x + heroWidth + gap, y: rect.y, width: restWidth, height: rect.height },
        "center",
        gap,
        presentation,
        true,
      ),
    );
  }
  return boxes.length > 0 ? { strategy: "side-by-side-split", presentation, boxes } : null;
}

/** Two-column grid in authored order. */
function adaptiveGrid(items: MeasuredElement[], rect: Rect, gap: number, presentation: PresentationVariant): LayoutCandidate | null {
  const ordered = inContentOrder(items);
  if (ordered.length === 0) return null;
  const cols = 2;
  const rows = Math.ceil(ordered.length / cols);
  const colWidth = (rect.width - gap * (cols - 1)) / cols;
  const rowHeight = (rect.height - gap * (rows - 1)) / rows;
  if (colWidth <= 0 || rowHeight <= 0) return null;

  const boxes = ordered.map((item, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const cellRect: Rect = {
      x: rect.x + col * (colWidth + gap),
      y: rect.y + row * (rowHeight + gap),
      width: colWidth,
      height: rowHeight,
    };
    return layoutColumn([item], cellRect, "center", gap, presentation)[0]!;
  });
  return { strategy: "adaptive-grid", presentation, boxes };
}

export type LayoutStrategy = (
  items: MeasuredElement[],
  rect: Rect,
  gap: number,
  presentation: PresentationVariant,
) => LayoutCandidate | null;

export const STRATEGIES: LayoutStrategy[] = [verticalStack, horizontalBand, sideBySideSplit, adaptiveGrid];
