// Framework-independent measurement layer.
//
// Turns spec content + surface constraints into concrete min/preferred box
// sizes. Text is measured with the real Canvas Text API wherever a canvas is
// available (any real browser); a character-count estimate is the fallback
// for environments without one (Node/vitest). Both paths are isolated to this
// file so the measurement strategy can keep evolving without touching
// strategies/validate/score/resolver.

import type { AdElement, ContentVariant, ElementMeasurement, MeasuredElement, NormalizedSurfaceProfile, Rect } from "./types";

const LINE_HEIGHT_FACTOR = 1.35;
// Fallback only — used when no canvas is available to measure real glyph widths
// (Node/vitest). Kept as a deliberate overestimate (real text tends to render
// narrower than this) so a layout that only "just barely" fits by this estimate
// still has a little slack once real fonts render, instead of silently overflowing
// into CSS text-overflow:ellipsis despite the resolver reporting zero degradation.
const AVG_CHAR_WIDTH_FACTOR = 0.62;
const GAP = 14;

// Must stay in sync with the CSS custom properties of the same name in App.css
// (--font-serif / --font-sans) — used only so canvas.measureText sees the same font
// the browser will actually render, never to make a layout decision based on
// surface/CSS identity.
const SERIF_STACK = `Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif`;
const SANS_STACK = `-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif`;

let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  if (typeof document === "undefined") {
    measureCtx = null;
    return measureCtx;
  }
  try {
    measureCtx = document.createElement("canvas").getContext("2d");
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

/** Real rendered text width when a canvas is available (any real browser); falls
 * back to a character-count estimate in environments without one (Node/vitest). */
function measureTextWidth(text: string, fontSize: number, fontFamily: string, fontWeight: number): number {
  const ctx = getMeasureContext();
  if (ctx) {
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    return ctx.measureText(text).width;
  }
  return text.length * fontSize * AVG_CHAR_WIDTH_FACTOR;
}

export function buttonFontSize(surface: NormalizedSurfaceProfile): number {
  return Math.max(15, surface.minTextSize * 0.8);
}

function measureText(el: Extract<AdElement, { type: "text" }>, surface: NormalizedSurfaceProfile, variant: ContentVariant): ElementMeasurement {
  const activeContent = variant === "short" && el.shortContent ? el.shortContent : el.content;
  const baseFontSize = el.role === "primary" ? 22 : 15;
  // far viewing distance / a surface's minTextSize both push the effective floor up
  const effectiveFontSize = Math.max(baseFontSize, surface.minTextSize);
  const lineHeight = effectiveFontSize * LINE_HEIGHT_FACTOR;
  const fontFamily = el.role === "primary" ? SERIF_STACK : SANS_STACK;
  const fontWeight = el.role === "primary" ? 600 : 500;

  const prefWidth = measureTextWidth(activeContent, effectiveFontSize, fontFamily, fontWeight);
  // average glyph width derived from the real measurement itself, so the "~6 legible
  // characters" floor stays consistent with whatever font actually rendered it
  const avgCharWidth = activeContent.length > 0 ? prefWidth / activeContent.length : effectiveFontSize * AVG_CHAR_WIDTH_FACTOR;
  const minWidth = Math.max(avgCharWidth * 6, prefWidth * 0.35);

  return {
    id: el.id,
    minWidth,
    minHeight: lineHeight, // can't go below one line at the effective font size
    prefWidth,
    prefHeight: lineHeight,
  };
}

function measureImage(el: Extract<AdElement, { type: "image" }>, rect: Rect, cropped: boolean): ElementMeasurement {
  const useCropped = cropped && el.croppedAspectRatio && el.croppedAspectRatio > 0;
  const aspect = useCropped ? el.croppedAspectRatio! : el.aspectRatio && el.aspectRatio > 0 ? el.aspectRatio : 1;
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

function measureButton(el: Extract<AdElement, { type: "button" }>, surface: NormalizedSurfaceProfile, variant: ContentVariant): ElementMeasurement {
  const fontSize = buttonFontSize(surface);
  const padding = 16;
  const activeLabel = variant === "icon" && el.icon ? el.icon : variant === "short" && el.shortLabel ? el.shortLabel : el.label;

  const textWidth = measureTextWidth(activeLabel, fontSize, SANS_STACK, 600);
  const prefWidth = textWidth + padding * 2;
  // tap target is a hard floor on BOTH dimensions once the surface declares one
  const minHeight = Math.max(fontSize * LINE_HEIGHT_FACTOR, surface.minTapTarget);
  const prefHeight = Math.max(minHeight, fontSize * LINE_HEIGHT_FACTOR + padding);
  // A button can shrink toward its tap-target floor, but never below what its own
  // label needs at this exact font size — render-dom renders buttons at this same
  // buttonFontSize(), so a narrower box would wrap the label instead of shrinking it.
  const minWidth = Math.max(prefWidth, surface.minTapTarget);

  return { id: el.id, minWidth, minHeight, prefWidth, prefHeight };
}

export function measureElement(
  el: AdElement,
  surface: NormalizedSurfaceProfile,
  rect: Rect,
  variant: ContentVariant = "full",
  cropped = false,
): ElementMeasurement {
  switch (el.type) {
    case "text":
      return measureText(el, surface, variant);
    case "image":
      return measureImage(el, rect, cropped);
    case "button":
      return measureButton(el, surface, variant);
  }
}

export function measureAll(elements: AdElement[], surface: NormalizedSurfaceProfile, rect: Rect): MeasuredElement[] {
  return elements.map((element) => ({
    element,
    measurement: measureElement(element, surface, rect, "full", false),
    truncated: false,
    contentVariant: "full",
    cropped: false,
    shrunk: false,
  }));
}

/** Deterministic content order used by every strategy — semantic (role), not surface-driven.
 * Branding sorts first: a logo reads as a small masthead mark, not the last thing in the flow. */
export const ROLE_ORDER: Record<string, number> = {
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
