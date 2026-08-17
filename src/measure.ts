// Framework-independent measurement layer.
//
// Two jobs live here: (1) turn spec content + surface constraints into
// concrete min/preferred box sizes for the generic candidate/validation
// pipeline, and (2) expose the shared sizing formulas (padding, gap, per-
// strategy font sizes) that strategies.ts and repair.ts call directly when
// they need an exact, strategy-specific number rather than a generic
// estimate. Both real-Canvas and Node-fallback text measurement stay
// isolated to this file so the strategy can keep evolving without touching
// strategies/repair/validate/score/resolver.

import type { AdElement, ContentVariant, ElementMeasurement, MeasuredElement, NormalizedSurfaceProfile, Rect } from "./types";

const LINE_HEIGHT_FACTOR = 1.35;
// Fallback only — used when no canvas is available to measure real glyph widths
// (Node/vitest). Kept as a deliberate overestimate (real text tends to render
// narrower than this) so a layout that only "just barely" fits by this estimate
// still has a little slack once real fonts render, instead of silently overflowing
// past what the resolver reported as a genuine fit.
const AVG_CHAR_WIDTH_FACTOR = 0.58;

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
export function measureTextWidth(text: string, fontSize: number, fontFamily: string, fontWeight: number): number {
  const ctx = getMeasureContext();
  if (ctx) {
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    return ctx.measureText(text).width;
  }
  return text.length * fontSize * AVG_CHAR_WIDTH_FACTOR;
}

// ---------------------------------------------------------------------------
// Shared sizing formulas. Every one is a pure function of the surface's short
// axis (min(rect.width, rect.height)) and, where relevant, the surface's own
// hard floors (minTextSize/minTapTarget) — never a surface id or fixed pixel
// table. strategies.ts and repair.ts call these directly; this file never
// picks a strategy.
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function shortAxis(rect: Rect): number {
  return Math.min(rect.width, rect.height);
}

export function paddingFor(rect: Rect): number {
  return clamp(shortAxis(rect) * 0.045, 8, 32);
}

export function gapFor(rect: Rect): number {
  return clamp(shortAxis(rect) * 0.032, 6, 24);
}

/** One tighter rung than gapFor(), tried before any element's content or
 * geometry degrades ("full content + compact spacing" in the ladder). */
export function compactGapFor(rect: Rect): number {
  return clamp(shortAxis(rect) * 0.032 * 0.65, 4, 16);
}

export function headlineFontFor(surface: NormalizedSurfaceProfile, rect: Rect): number {
  return clamp(shortAxis(rect) * 0.085, surface.minTextSize, 34);
}

export function posterHeadlineFontFor(surface: NormalizedSurfaceProfile, rect: Rect): number {
  return clamp(shortAxis(rect) * 0.06, surface.minTextSize, 64);
}

export type PriceStrategyId = "stack" | "split" | "band" | "poster";

/** Price reads at a different scale in every composition — a Poster's price sits
 * near a large hero and stays modest, a Band's price is the tallest text on the
 * strip. One formula per strategy, all still pure functions of the surface. */
export function priceFontFor(strategyId: PriceStrategyId, surface: NormalizedSurfaceProfile, rect: Rect): number {
  const s = shortAxis(rect);
  switch (strategyId) {
    case "stack":
      return clamp(s * 0.075, Math.max(surface.minTextSize, 14), 28);
    case "split":
      return clamp(s * 0.095, Math.max(surface.minTextSize, 18), 34);
    case "band":
      return clamp(s * 0.14, Math.max(surface.minTextSize, 16), 40);
    case "poster":
      return clamp(s * 0.045, Math.max(surface.minTextSize, 18), 48);
  }
}

// surface isn't read — brandFont has no minTextSize floor, deliberately: brand
// is the lowest-priority text and allowed to run smaller than body copy. The
// parameter stays for signature symmetry with the other *FontFor helpers.
export function brandFontFor(_surface: NormalizedSurfaceProfile, rect: Rect): number {
  return clamp(shortAxis(rect) * 0.026, 8, 12);
}

export function heroMinWidthFor(rect: Rect): number {
  return Math.max(64, shortAxis(rect) * 0.22);
}

export function buttonFontSize(surface: NormalizedSurfaceProfile): number {
  return Math.max(surface.minTextSize, 15);
}

export function ctaHeightFor(surface: NormalizedSurfaceProfile): number {
  return Math.max(surface.minTapTarget, Math.ceil(buttonFontSize(surface) * 1.35 + 18));
}

export function measureButtonLabelWidth(
  label: string,
  surface: NormalizedSurfaceProfile,
  fontSize = buttonFontSize(surface),
): number {
  return measureTextWidth(label, fontSize, SANS_STACK, 600);
}

/** The exact string a text/button element renders for a given content variant —
 * single source of truth shared by measurement, validation, and the renderer. */
export function activeContentFor(el: Extract<AdElement, { type: "text" | "button" }>, variant: ContentVariant): string {
  if (el.type === "text") return variant === "compact" && el.compactContent ? el.compactContent : el.content;
  return variant === "compact" && el.compactLabel ? el.compactLabel : el.label;
}

/** Real pixel width of a text/button element's active content at a specific
 * resolved font size — used to hard-validate that "full active text" genuinely
 * fits its box, not just that it fits at the generic measurement pass's font. */
export function measureActiveContentWidth(el: Extract<AdElement, { type: "text" | "button" }>, variant: ContentVariant, fontSize: number): number {
  const content = activeContentFor(el, variant);
  if (el.type === "text") {
    const fontFamily = el.role === "primary" ? SERIF_STACK : SANS_STACK;
    const fontWeight = el.role === "primary" ? 600 : 500;
    return measureTextWidth(content, fontSize, fontFamily, fontWeight);
  }
  return measureTextWidth(content, fontSize, SANS_STACK, 600);
}

// ---------------------------------------------------------------------------
// Generic per-element measurement — the min/preferred sizes the candidate
// generator and hard validator work against. Strategies additionally call the
// formulas above to pick an exact, strategy-specific font size when they
// place headline/price/brand/CTA; this pass just needs honest floors.
// ---------------------------------------------------------------------------

function measureText(el: Extract<AdElement, { type: "text" }>, surface: NormalizedSurfaceProfile, rect: Rect, variant: ContentVariant): ElementMeasurement {
  const activeContent = activeContentFor(el, variant);
  const baseFontSize = el.role === "primary" ? headlineFontFor(surface, rect) : Math.max(surface.minTextSize, 15);
  const lineHeight = baseFontSize * LINE_HEIGHT_FACTOR;
  const fontFamily = el.role === "primary" ? SERIF_STACK : SANS_STACK;
  const fontWeight = el.role === "primary" ? 600 : 500;

  const prefWidth = measureTextWidth(activeContent, baseFontSize, fontFamily, fontWeight);
  // average glyph width derived from the real measurement itself, so the "~6 legible
  // characters" floor stays consistent with whatever font actually rendered it
  const avgCharWidth = activeContent.length > 0 ? prefWidth / activeContent.length : baseFontSize * AVG_CHAR_WIDTH_FACTOR;
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
    const prefWidth = 88;
    const minWidth = 28;
    const minHeight = Math.max(minWidth / aspect, 18);
    return { id: el.id, minWidth, minHeight, prefWidth, prefHeight: prefWidth / aspect };
  }

  // A hero wants to fill a meaningful share of whichever axis is more constrained,
  // not a fixed pixel size — otherwise a huge kiosk canvas ends up with the same
  // tiny hero as a phone banner. No fixed cap: strategies/repair are responsible
  // for bounding the final placed width against their own target ratios.
  const minWidth = heroMinWidthFor(rect);
  const prefWidth = Math.max(minWidth, Math.min(rect.width * 0.78, rect.height * 0.72 * aspect));

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
  const padding = 18;
  const activeLabel = activeContentFor(el, variant);

  const textWidth = measureButtonLabelWidth(activeLabel, surface, fontSize);
  const prefWidth = textWidth + padding * 2;
  const minHeight = ctaHeightFor(surface);
  const prefHeight = minHeight;
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
      return measureText(el, surface, rect, variant);
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
    contentVariant: "full",
    cropped: false,
    shrunk: false,
  }));
}

/** Role order is deliberately reserved for degradation tie-breaking. Layout flow uses
 * the authored spec order, which is the creative's declared reading order. */
export const ROLE_ORDER: Record<string, number> = {
  branding: 0,
  hero: 1,
  primary: 2,
  secondary: 3,
  action: 4,
};

export function inContentOrder(items: MeasuredElement[]): MeasuredElement[] {
  return [...items];
}
