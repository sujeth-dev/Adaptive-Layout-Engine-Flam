// Framework-independent measurement layer.
//
// Turns spec content + surface constraints into concrete min/preferred box
// sizes. No real DOM text measurement here (that's a documented bonus we
// didn't build) — sizes are estimated from character counts and a fixed
// average-glyph-width factor. The estimator is intentionally simple and
// isolated to this file so it could be swapped for real text metrics later
// without touching strategies/validate/score/resolver.

import type { AdElement, ElementMeasurement, MeasuredElement, NormalizedSurfaceProfile, Rect } from "./types";

const LINE_HEIGHT_FACTOR = 1.35;
const AVG_CHAR_WIDTH_FACTOR = 0.56;
const GAP = 8;

function measureText(el: Extract<AdElement, { type: "text" }>, surface: NormalizedSurfaceProfile): ElementMeasurement {
  const baseFontSize = el.role === "primary" ? 22 : 15;
  // far viewing distance / a surface's minTextSize both push the effective floor up
  const effectiveFontSize = Math.max(baseFontSize, surface.minTextSize);
  const lineHeight = effectiveFontSize * LINE_HEIGHT_FACTOR;
  const charWidth = effectiveFontSize * AVG_CHAR_WIDTH_FACTOR;

  const prefWidth = el.content.length * charWidth;
  // a hard floor of ~6 legible characters — below this, truncation stops being meaningful
  const minWidth = Math.max(charWidth * 6, prefWidth * 0.35);

  return {
    id: el.id,
    minWidth,
    minHeight: lineHeight, // can't go below one line at the effective font size
    prefWidth,
    prefHeight: lineHeight,
  };
}

function measureImage(el: Extract<AdElement, { type: "image" }>, rect: Rect): ElementMeasurement {
  const aspect = el.aspectRatio && el.aspectRatio > 0 ? el.aspectRatio : 1;
  const isHero = el.role === "hero";

  if (!isHero) {
    // branding/logo stays compact regardless of canvas size — logos don't need to grow with the surface.
    // A wordmark-shaped logo (wide aspect) still needs a legible floor height, not aspect-ratio-thin.
    const prefWidth = 72;
    const minWidth = 28;
    const minHeight = Math.max(minWidth / aspect, 18);
    return { id: el.id, minWidth, minHeight, prefWidth, prefHeight: prefWidth / aspect };
  }

  // A hero image should want to fill a meaningful chunk of whichever dimension is more
  // constrained, not a fixed pixel size — otherwise a huge kiosk canvas ends up with the
  // same tiny hero as a phone banner, leaving most of the surface unused. Budget from both
  // width and height (converted through the aspect ratio) and take the tighter one.
  const widthBudget = rect.width * 0.45;
  const heightBudget = rect.height * 0.85 * aspect;
  const prefWidth = Math.min(Math.max(Math.min(widthBudget, heightBudget), 140), 480);
  const minWidth = 96;

  return {
    id: el.id,
    minWidth,
    minHeight: minWidth / aspect,
    prefWidth,
    prefHeight: prefWidth / aspect,
  };
}

function measureButton(el: Extract<AdElement, { type: "button" }>, surface: NormalizedSurfaceProfile): ElementMeasurement {
  const fontSize = Math.max(15, surface.minTextSize * 0.8);
  const charWidth = fontSize * AVG_CHAR_WIDTH_FACTOR;
  const padding = 16;

  const textWidth = el.label.length * charWidth;
  const prefWidth = textWidth + padding * 2;
  // tap target is a hard floor on BOTH dimensions once the surface declares one
  const minHeight = Math.max(fontSize * LINE_HEIGHT_FACTOR, surface.minTapTarget);
  const prefHeight = Math.max(minHeight, fontSize * LINE_HEIGHT_FACTOR + padding);
  const minWidth = Math.max(prefWidth * 0.6, surface.minTapTarget);

  return { id: el.id, minWidth, minHeight, prefWidth, prefHeight };
}

export function measureElement(el: AdElement, surface: NormalizedSurfaceProfile, rect: Rect): ElementMeasurement {
  switch (el.type) {
    case "text":
      return measureText(el, surface);
    case "image":
      return measureImage(el, rect);
    case "button":
      return measureButton(el, surface);
  }
}

export function measureAll(elements: AdElement[], surface: NormalizedSurfaceProfile, rect: Rect): MeasuredElement[] {
  return elements.map((element) => ({
    element,
    measurement: measureElement(element, surface, rect),
    truncated: false,
  }));
}

/** Deterministic content order used by every strategy — semantic (role), not surface-driven.
 * Branding sorts first: a logo reads as a small masthead mark, not the last thing in the flow. */
const ROLE_ORDER: Record<string, number> = {
  branding: 0,
  hero: 1,
  primary: 2,
  secondary: 3,
  action: 4,
};

export function inContentOrder(items: MeasuredElement[]): MeasuredElement[] {
  return [...items].sort((a, b) => {
    const roleDiff = (ROLE_ORDER[a.element.role] ?? 99) - (ROLE_ORDER[b.element.role] ?? 99);
    if (roleDiff !== 0) return roleDiff;
    return a.element.priority - b.element.priority;
  });
}

export { GAP };
