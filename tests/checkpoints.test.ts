// Golden checkpoint assertions for the five canonical surfaces (§18 of
// FINAL_IMPLEMENTATION_GUIDE.md). These lock the *target* compositions before
// the strategies/repair/resolver rewrite lands, so they intentionally fail
// (or fail to compile against a stale strategy id) until those phases close
// the loop — that is the point of locking the checkpoint first.

import { describe, expect, it } from "vitest";
import { demoAd } from "../src/spec";
import { resolveLayout } from "../src/resolver";
import { CHECKPOINTS } from "../src/checkpoints";
import type { ResolvedBox, ResolvedLayout, SurfaceProfile } from "../src/types";
import { assertInvariants } from "./helpers";

function resolve(surface: SurfaceProfile): ResolvedLayout {
  const result = resolveLayout(demoAd, surface);
  expect(result.ok, !result.ok ? `${result.message}: ${result.details.join("; ")}` : "").toBe(true);
  if (!result.ok) throw new Error(result.message);
  assertInvariants(result.layout, surface, demoAd);
  return result.layout;
}

function box(layout: ResolvedLayout, id: string): ResolvedBox {
  const found = layout.boxes.find((b) => b.id === id);
  if (!found) throw new Error(`expected box "${id}" to be present`);
  return found;
}

function usableRect(surface: SurfaceProfile) {
  const sa = surface.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    x: sa.left,
    y: sa.top,
    width: surface.width - sa.left - sa.right,
    height: surface.height - sa.top - sa.bottom,
  };
}

describe("checkpoint 1 — 320×480 Stack, full content", () => {
  const cp = CHECKPOINTS[0]!;
  it("matches the vertical-story target", () => {
    const layout = resolve(cp.surface);
    const rect = usableRect(cp.surface);
    expect(layout.strategy).toBe("stack");
    expect(layout.omitted).toEqual([]);
    expect(layout.boxes.length).toBe(5);

    const headline = box(layout, "headline");
    const hero = box(layout, "product-image");
    const price = box(layout, "price");
    const cta = box(layout, "cta");
    const logo = box(layout, "logo");

    expect(headline.y + headline.height).toBeLessThanOrEqual(hero.y + 1);
    expect(hero.y + hero.height).toBeLessThanOrEqual(Math.min(price.y, cta.y) + 1);
    expect(price.x + price.width).toBeLessThanOrEqual(cta.x + 1);
    // brand reads top-right: right-aligned, and above or beside the hero, never below it
    expect(logo.x + logo.width).toBeGreaterThan(rect.x + rect.width * 0.6);
    expect(logo.y).toBeLessThanOrEqual(hero.y + 1);
    expect((hero.width * hero.height) / (rect.width * rect.height)).toBeGreaterThanOrEqual(0.42);
  });
});

describe("checkpoint 2 — 480×320 Split, full content", () => {
  const cp = CHECKPOINTS[1]!;
  it("matches the no-dead-space split target", () => {
    const layout = resolve(cp.surface);
    const rect = usableRect(cp.surface);
    expect(layout.strategy).toBe("split");

    const headline = box(layout, "headline");
    const hero = box(layout, "product-image");
    const price = box(layout, "price");
    const cta = box(layout, "cta");

    // hero sits right of the copy column
    expect(hero.x).toBeGreaterThan(headline.x);
    const heroShare = hero.width / rect.width;
    expect(heroShare).toBeGreaterThanOrEqual(0.48);
    expect(heroShare).toBeLessThanOrEqual(0.6);

    const copyColumnLeftEdge = Math.min(headline.x, price.x, cta.x);
    const copyColumnWidth = hero.x - copyColumnLeftEdge;
    const ctaFill = cta.width / copyColumnWidth;
    expect(ctaFill).toBeGreaterThanOrEqual(0.65);
    expect(ctaFill).toBeLessThanOrEqual(0.92);

    // commerce (price+cta) centered within the copy column's remaining height below the headline
    const remainingTop = headline.y + headline.height;
    const remainingHeight = rect.y + rect.height - remainingTop;
    const commerceTop = Math.min(price.y, cta.y);
    const commerceBottom = Math.max(price.y + price.height, cta.y + cta.height);
    const commerceCenter = (commerceTop + commerceBottom) / 2;
    const remainingCenter = remainingTop + remainingHeight / 2;
    expect(Math.abs(commerceCenter - remainingCenter)).toBeLessThanOrEqual(remainingHeight * 0.3);

    // occupancy = the vertical span the left column's content claims (headline top
    // to commerce bottom), not just summed content pixel heights — a centered
    // commerce block with breathing room around it still "occupies" that space.
    const leftOccupancy = (commerceBottom - headline.y) / rect.height;
    expect(leftOccupancy).toBeGreaterThanOrEqual(0.72 - 0.1); // tolerance around a geometric target, not a pixel snapshot
  });
});

describe("checkpoint 3 — 1920×250 Band, full content", () => {
  const cp = CHECKPOINTS[2]!;
  it("matches the wide-band target", () => {
    const layout = resolve(cp.surface);
    const rect = usableRect(cp.surface);
    expect(layout.strategy).toBe("band");
    expect(layout.omitted).toEqual([]);

    const headline = box(layout, "headline");
    const hero = box(layout, "product-image");
    const price = box(layout, "price");
    const cta = box(layout, "cta");
    const logo = box(layout, "logo");

    const order = [headline, hero, price, cta, logo].map((b) => b.x);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]!);
    }

    expect(headline.presentation.fontSize ?? 0).toBeGreaterThanOrEqual(32);
    expect(cta.presentation.fontSize ?? 0).toBeGreaterThanOrEqual(32);
    expect(hero.width / rect.width).toBeGreaterThanOrEqual(0.16);
  });
});

describe("checkpoint 4 — 1080×1080 Poster, full content", () => {
  const cp = CHECKPOINTS[3]!;
  it("matches the hero-dominant poster target", () => {
    const layout = resolve(cp.surface);
    const rect = usableRect(cp.surface);
    expect(layout.strategy).toBe("poster");

    const hero = box(layout, "product-image");
    const cta = box(layout, "cta");

    const heroWidthRatio = hero.width / rect.width;
    expect(heroWidthRatio).toBeGreaterThanOrEqual(0.68);
    expect(heroWidthRatio).toBeLessThanOrEqual(0.88);

    const heroAreaRatio = (hero.width * hero.height) / (rect.width * rect.height);
    expect(heroAreaRatio).toBeGreaterThanOrEqual(0.38);
    expect(heroAreaRatio).toBeLessThanOrEqual(0.66);

    const heroCenter = hero.x + hero.width / 2;
    const rectCenter = rect.x + rect.width / 2;
    expect(Math.abs(heroCenter - rectCenter) / rect.width).toBeLessThanOrEqual(0.05);

    expect(cta.height).toBeGreaterThanOrEqual(60);
  });
});

describe("checkpoint 5 — 510×90 Band, constrained strip", () => {
  const cp = CHECKPOINTS[4]!;
  it("fits the full band on a very short, wide strip with a tap-compliant CTA", () => {
    const layout = resolve(cp.surface);
    expect(layout.strategy).toBe("band");

    const headline = box(layout, "headline");
    const hero = box(layout, "product-image");
    const price = box(layout, "price");
    const cta = box(layout, "cta");

    const order = [headline, hero, price, cta].map((b) => b.x);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]!);
    }
    expect(cta.height).toBeGreaterThanOrEqual(cp.surface.minTapTarget ?? 0);
    expect(cta.width).toBeGreaterThanOrEqual(cp.surface.minTapTarget ?? 0);
  });
});
