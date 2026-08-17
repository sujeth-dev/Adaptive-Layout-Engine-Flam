// Generic candidate layout strategies. Every strategy is a pure function of
// the available rectangle, the current element pool, and the surface's own
// constraints — never a surface id. All four (stack/split/band/poster) run
// for every surface; validation + scoring decide which one wins, not a
// branch here. Each strategy produces exactly one raw, structurally-correct
// candidate — repair.ts is responsible for growing it toward its target
// proportions, not this file.
//
// One deliberate rule applied uniformly: padding insets where TEXT/button/
// brand elements sit (so nothing reads flush against the safe-area edge),
// but the hero image is allowed to use the full available rect on its own
// axis — it has no legibility margin to protect and is meant to dominate the
// composition, so it bleeds closer to the edge than the padded text does.

import type { AdElement, MeasuredElement, NormalizedSurfaceProfile, ResolvedBox, Rect } from "./types";
import {
  brandFontFor,
  buttonFontSize,
  ctaHeightFor,
  headlineFontFor,
  heroMinWidthFor,
  measureActiveContentWidth,
  paddingFor,
  posterHeadlineFontFor,
  priceFontFor,
} from "./measure";

const LINE_HEIGHT_FACTOR = 1.35; // matches measure.ts

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function byRole(items: MeasuredElement[], role: string): MeasuredElement | undefined {
  return items.find((item) => item.element.role === role);
}

function insetRect(rect: Rect, padding: number): Rect {
  return { x: rect.x + padding, y: rect.y + padding, width: rect.width - padding * 2, height: rect.height - padding * 2 };
}

interface Size {
  width: number;
  height: number;
  fontSize?: number;
}

/** Sizes a text box at `fontSize`, but if the content genuinely can't fit
 * `maxWidth` at that size, shrinks the font (down to `surface.minTextSize`)
 * until it does — the box is always sized to fit its own content, never
 * independently clamped narrower than what its font size needs (that would
 * produce a box the active text can't actually fit in). */
function sizeText(item: MeasuredElement, fontSize: number, surface: NormalizedSurfaceProfile, maxWidth?: number): Size {
  const el = item.element as Extract<AdElement, { type: "text" }>;
  let f = fontSize;
  let width = measureActiveContentWidth(el, item.contentVariant, f);
  if (maxWidth !== undefined && width > maxWidth && width > 0) {
    const scale = maxWidth / width;
    f = Math.max(surface.minTextSize, f * scale);
    width = measureActiveContentWidth(el, item.contentVariant, f);
  }
  width = Math.max(item.measurement.minWidth, width);
  return { width, height: f * LINE_HEIGHT_FACTOR, fontSize: f };
}

function sizeCta(item: MeasuredElement, surface: NormalizedSurfaceProfile): Size {
  const el = item.element as Extract<AdElement, { type: "button" }>;
  const fontSize = buttonFontSize(surface);
  const labelWidth = measureActiveContentWidth(el, item.contentVariant, fontSize);
  const width = Math.max(item.measurement.minWidth, labelWidth + 36); // 18px horizontal padding per side, matches measure.ts's measureButton
  return { width, height: ctaHeightFor(surface), fontSize };
}

function sizeBrand(item: MeasuredElement, surface: NormalizedSurfaceProfile, rect: Rect): Size {
  const fontSize = brandFontFor(surface, rect);
  const width = item.measurement.prefWidth;
  const height = Math.max(item.measurement.minHeight, fontSize * 1.6);
  return { width, height, fontSize };
}

/** Fits the hero's fixed aspect ratio inside a box up to `maxWidth`/`maxHeight` —
 * never stretches or squashes it; geometry may shrink, the shape never distorts. */
function sizeHero(item: MeasuredElement, maxWidth: number, maxHeight: number): Size {
  const aspect = item.measurement.prefWidth / item.measurement.prefHeight;
  let width = Math.min(maxWidth, Math.max(0, maxHeight) * aspect);
  let height = width / aspect;
  if (width > maxWidth) {
    width = maxWidth;
    height = width / aspect;
  }
  return { width, height };
}

function makeBox(item: MeasuredElement, x: number, y: number, size: Size): ResolvedBox {
  return {
    id: item.element.id,
    x,
    y,
    width: size.width,
    height: size.height,
    presentation: { variant: item.contentVariant, visible: true, cropped: item.cropped, fontSize: size.fontSize },
  };
}

// ---------------------------------------------------------------------------
// Stack — top: headline + reserved brand slot. bottom: price + CTA. hero: all
// legal middle remainder, spanning the full rect width (not padding-inset).
// ---------------------------------------------------------------------------

function stack(items: MeasuredElement[], rect: Rect, gap: number, surface: NormalizedSurfaceProfile): ReturnType<LayoutStrategy> {
  const padding = paddingFor(rect);
  const inner = insetRect(rect, padding);
  if (inner.width <= 0 || inner.height <= 0) return null;

  const headline = byRole(items, "primary");
  const hero = byRole(items, "hero");
  const price = byRole(items, "secondary");
  const cta = byRole(items, "action");
  const brand = byRole(items, "branding");
  if (!headline && !hero && !price && !cta && !brand) return null;

  const boxes: ResolvedBox[] = [];

  let brandSize: Size | undefined;
  if (brand) brandSize = sizeBrand(brand, surface, rect);
  const headlineBudget = brandSize ? Math.max(0, inner.width - brandSize.width - gap) : inner.width;

  let topRowHeight = 0;
  if (headline) {
    const size = sizeText(headline, headlineFontFor(surface, rect), surface, headlineBudget);
    boxes.push(makeBox(headline, inner.x, inner.y, size));
    topRowHeight = Math.max(topRowHeight, size.height);
  }
  if (brand && brandSize) {
    boxes.push(makeBox(brand, inner.x + inner.width - brandSize.width, inner.y, brandSize));
    topRowHeight = Math.max(topRowHeight, brandSize.height);
  }

  let bottomRowHeight = 0;
  let priceSize: Size | undefined;
  let ctaSize: Size | undefined;
  if (price) priceSize = sizeText(price, priceFontFor("stack", surface, rect), surface, inner.width);
  if (cta) ctaSize = sizeCta(cta, surface);
  if (priceSize) bottomRowHeight = Math.max(bottomRowHeight, priceSize.height);
  if (ctaSize) bottomRowHeight = Math.max(bottomRowHeight, ctaSize.height);
  const bottomY = inner.y + inner.height - bottomRowHeight;
  if (price && priceSize) {
    boxes.push(makeBox(price, inner.x, bottomY + (bottomRowHeight - priceSize.height) / 2, priceSize));
  }
  if (cta && ctaSize) {
    boxes.push(makeBox(cta, inner.x + inner.width - ctaSize.width, bottomY + (bottomRowHeight - ctaSize.height) / 2, ctaSize));
  }

  if (hero) {
    const heroTop = inner.y + topRowHeight + (topRowHeight > 0 ? gap : 0);
    const heroBottom = bottomY - (bottomRowHeight > 0 ? gap : 0);
    const availHeight = heroBottom - heroTop;
    if (availHeight <= 0) return null; // hero has nowhere to go — reject the whole candidate, never drop it silently
    // bounded by inner.width (padding-inset), not the full rect — Stack is a
    // headline-led composition, not a poster; a hero that bleeds to the edges
    // here would make Stack indistinguishable from Poster on square surfaces.
    const size = sizeHero(hero, inner.width, availHeight);
    const x = inner.x + (inner.width - size.width) / 2;
    const y = heroTop + (availHeight - size.height) / 2;
    boxes.push(makeBox(hero, x, y, size));
  }

  return boxes.length > 0 ? { strategy: "stack", boxes } : null;
}

// ---------------------------------------------------------------------------
// Split — left: headline top, commerce (price+CTA) centered in the remaining
// left height. right: reserved brand slot, hero fills the remaining right
// panel (bleeding to the rect's right/bottom edges, not padding-inset).
// ---------------------------------------------------------------------------

const SPLIT_HERO_SHARE = 0.56;
const SPLIT_HERO_MAX_SHARE = 0.7;
const SPLIT_CTA_TARGET_FILL = 0.86;

function split(items: MeasuredElement[], rect: Rect, gap: number, surface: NormalizedSurfaceProfile): ReturnType<LayoutStrategy> {
  const padding = paddingFor(rect);
  const inner = insetRect(rect, padding);
  if (inner.width <= 0 || inner.height <= 0) return null;

  const headline = byRole(items, "primary");
  const hero = byRole(items, "hero");
  const price = byRole(items, "secondary");
  const cta = byRole(items, "action");
  const brand = byRole(items, "branding");
  if (!headline && !hero && !price && !cta && !brand) return null;

  const heroMinW = hero ? Math.max(hero.measurement.minWidth, heroMinWidthFor(rect)) : 0;
  let heroWidth = hero ? clamp(rect.width * SPLIT_HERO_SHARE, heroMinW, rect.width * SPLIT_HERO_MAX_SHARE) : 0;
  const heroX = rect.x + rect.width - heroWidth;
  const leftWidth = hero ? heroX - gap - inner.x : inner.width;
  if (leftWidth <= 0) return null;

  const boxes: ResolvedBox[] = [];
  let headlineBottom = inner.y;
  if (headline) {
    const size = sizeText(headline, headlineFontFor(surface, rect), surface, leftWidth);
    boxes.push(makeBox(headline, inner.x, inner.y, size));
    headlineBottom = inner.y + size.height + gap;
  }

  const remainingTop = headlineBottom;
  const remainingHeight = inner.y + inner.height - remainingTop;
  let priceSize: Size | undefined;
  let ctaSize: Size | undefined;
  if (price) priceSize = sizeText(price, priceFontFor("split", surface, rect), surface, leftWidth);
  if (cta) {
    ctaSize = sizeCta(cta, surface);
    // widen toward the 86% target, but never narrower than the label actually needs
    ctaSize.width = Math.max(ctaSize.width, Math.min(leftWidth * SPLIT_CTA_TARGET_FILL, leftWidth));
  }
  const commerceHeight = (priceSize?.height ?? 0) + (priceSize && ctaSize ? gap : 0) + (ctaSize?.height ?? 0);
  let commerceY = remainingTop + Math.max(0, (remainingHeight - commerceHeight) / 2);
  if (price && priceSize) {
    const width = Math.min(Math.max(priceSize.width, leftWidth * 0.6), leftWidth);
    boxes.push(makeBox(price, inner.x, commerceY, { ...priceSize, width }));
    commerceY += priceSize.height + gap;
  }
  if (cta && ctaSize) {
    boxes.push(makeBox(cta, inner.x, commerceY, ctaSize));
  }

  let brandBottom = inner.y;
  if (brand) {
    const size = sizeBrand(brand, surface, rect);
    boxes.push(makeBox(brand, inner.x + inner.width - size.width, inner.y, size));
    brandBottom = inner.y + size.height + gap;
  }

  if (hero) {
    const heroTop = brandBottom;
    const heroAvailHeight = rect.y + rect.height - heroTop;
    if (heroAvailHeight <= 0) return null; // hero has nowhere to go — reject the whole candidate, never drop it silently
    const size = sizeHero(hero, heroWidth, heroAvailHeight);
    const x = heroX + (heroWidth - size.width) / 2;
    const y = heroTop + (heroAvailHeight - size.height) / 2;
    boxes.push(makeBox(hero, x, y, size));
  }

  return boxes.length > 0 ? { strategy: "split", boxes } : null;
}

// ---------------------------------------------------------------------------
// Band — fixed order headline | hero | price | CTA | brand. Fixed internal
// gaps; hero absorbs whatever horizontal slack remains after every fixed-
// width member is sized, bounded by its own min/max share. Any slack left
// after the hero's own cap becomes a balanced outer margin, not stretched
// gaps.
// ---------------------------------------------------------------------------

const BAND_HERO_MAX_SHARE = 0.45;

function band(items: MeasuredElement[], rect: Rect, gap: number, surface: NormalizedSurfaceProfile): ReturnType<LayoutStrategy> {
  const padding = paddingFor(rect);
  const inner = insetRect(rect, padding);
  if (inner.width <= 0 || inner.height <= 0) return null;

  const headline = byRole(items, "primary");
  const hero = byRole(items, "hero");
  const price = byRole(items, "secondary");
  const cta = byRole(items, "action");
  const brand = byRole(items, "branding");
  const order = [headline, hero, price, cta, brand].filter((m): m is MeasuredElement => !!m);
  if (order.length === 0) return null;

  const sizes = new Map<string, Size>();
  let fixedWidthTotal = 0;
  for (const m of order) {
    if (m === hero) continue;
    let size: Size;
    if (m === headline) size = sizeText(m, headlineFontFor(surface, rect), surface, inner.width);
    else if (m === price) size = sizeText(m, priceFontFor("band", surface, rect), surface, inner.width);
    else if (m === cta) size = sizeCta(m, surface);
    else size = sizeBrand(m, surface, rect);
    sizes.set(m.element.id, size);
    fixedWidthTotal += size.width;
  }

  const gapTotal = gap * Math.max(0, order.length - 1);
  let heroSize: Size | undefined;
  if (hero) {
    const remaining = inner.width - fixedWidthTotal - gapTotal;
    const heroMinW = Math.max(hero.measurement.minWidth, heroMinWidthFor(rect));
    const heroMaxW = inner.width * BAND_HERO_MAX_SHARE;
    const heroWidth = clamp(remaining, heroMinW, Math.max(heroMinW, heroMaxW));
    // hero may use the full rect height (not padding-inset) — it's the one
    // member here with no legibility margin to protect.
    heroSize = sizeHero(hero, heroWidth, rect.height);
  }

  const contentWidth = fixedWidthTotal + (heroSize?.width ?? 0) + gapTotal;
  const outerMargin = Math.max(0, (inner.width - contentWidth) / 2);

  const boxes: ResolvedBox[] = [];
  let x = inner.x + outerMargin;
  for (const m of order) {
    if (m === hero && heroSize) {
      const y = rect.y + (rect.height - heroSize.height) / 2;
      boxes.push(makeBox(hero, x, y, heroSize));
      x += heroSize.width + gap;
      continue;
    }
    const size = sizes.get(m.element.id);
    if (!size) continue;
    const height = Math.min(size.height, inner.height);
    const y = inner.y + (inner.height - height) / 2;
    boxes.push(makeBox(m, x, y, { ...size, height }));
    x += size.width + gap;
  }

  return boxes.length > 0 ? { strategy: "band", boxes } : null;
}

// ---------------------------------------------------------------------------
// Poster — top: headline + brand. center: large hero, target 82% of the rect
// width (not padding-inset — the hero is meant to dominate). bottom: price +
// CTA.
// ---------------------------------------------------------------------------

const POSTER_HERO_TARGET_SHARE = 0.82;

function poster(items: MeasuredElement[], rect: Rect, gap: number, surface: NormalizedSurfaceProfile): ReturnType<LayoutStrategy> {
  const padding = paddingFor(rect);
  const inner = insetRect(rect, padding);
  if (inner.width <= 0 || inner.height <= 0) return null;

  const headline = byRole(items, "primary");
  const hero = byRole(items, "hero");
  const price = byRole(items, "secondary");
  const cta = byRole(items, "action");
  const brand = byRole(items, "branding");
  if (!headline && !hero && !price && !cta && !brand) return null;

  const boxes: ResolvedBox[] = [];

  let brandSize: Size | undefined;
  if (brand) brandSize = sizeBrand(brand, surface, rect);
  const headlineBudget = brandSize ? Math.max(0, inner.width - brandSize.width - gap) : inner.width;

  let topRowHeight = 0;
  if (headline) {
    const size = sizeText(headline, posterHeadlineFontFor(surface, rect), surface, headlineBudget);
    boxes.push(makeBox(headline, inner.x, inner.y, size));
    topRowHeight = Math.max(topRowHeight, size.height);
  }
  if (brand && brandSize) {
    boxes.push(makeBox(brand, inner.x + inner.width - brandSize.width, inner.y, brandSize));
    topRowHeight = Math.max(topRowHeight, brandSize.height);
  }

  let bottomRowHeight = 0;
  let priceSize: Size | undefined;
  let ctaSize: Size | undefined;
  if (price) priceSize = sizeText(price, priceFontFor("poster", surface, rect), surface, inner.width);
  if (cta) ctaSize = sizeCta(cta, surface);
  if (priceSize) bottomRowHeight = Math.max(bottomRowHeight, priceSize.height);
  if (ctaSize) bottomRowHeight = Math.max(bottomRowHeight, ctaSize.height);
  const bottomY = inner.y + inner.height - bottomRowHeight;
  if (price && priceSize) {
    boxes.push(makeBox(price, inner.x, bottomY + (bottomRowHeight - priceSize.height) / 2, priceSize));
  }
  if (cta && ctaSize) {
    boxes.push(makeBox(cta, inner.x + inner.width - ctaSize.width, bottomY + (bottomRowHeight - ctaSize.height) / 2, ctaSize));
  }

  if (hero) {
    const heroTop = inner.y + topRowHeight + (topRowHeight > 0 ? gap : 0);
    const heroBottom = bottomY - (bottomRowHeight > 0 ? gap : 0);
    const availHeight = heroBottom - heroTop;
    if (availHeight <= 0) return null; // hero has nowhere to go — reject the whole candidate, never drop it silently
    const targetWidth = rect.width * POSTER_HERO_TARGET_SHARE;
    const size = sizeHero(hero, Math.min(targetWidth, rect.width), availHeight);
    const x = rect.x + (rect.width - size.width) / 2;
    const y = heroTop + (availHeight - size.height) / 2;
    boxes.push(makeBox(hero, x, y, size));
  }

  return boxes.length > 0 ? { strategy: "poster", boxes } : null;
}

export type LayoutStrategy = (
  items: MeasuredElement[],
  rect: Rect,
  gap: number,
  surface: NormalizedSurfaceProfile,
) => { strategy: string; boxes: ResolvedBox[] } | null;

export const STRATEGIES: LayoutStrategy[] = [stack, split, band, poster];
