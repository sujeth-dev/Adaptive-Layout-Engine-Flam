// Unit tests for the repair stage (generate -> repair -> hard validate).
// repairCandidate() must only ever improve soft geometry — reserve hard
// minimums, grow toward per-strategy targets when slack exists — and must
// never drop an element or return a box the raw candidate didn't have.

import { describe, expect, it } from "vitest";
import { repairCandidate } from "../src/repair";
import { normalizeSurfaceProfile } from "../src/validate";
import { measureAll } from "../src/measure";
import { demoAd } from "../src/spec";
import type { ElementPresentation, LayoutCandidate, Rect, ResolvedBox } from "../src/types";

const surface = normalizeSurfaceProfile({ id: "repair-test", width: 800, height: 600, minTapTarget: 44, minTextSize: 14 });
const rect: Rect = { x: 0, y: 0, width: 800, height: 600 };
const pool = measureAll(demoAd.elements, surface, rect);

function presentation(overrides: Partial<ElementPresentation> = {}): ElementPresentation {
  return { variant: "full", visible: true, cropped: false, ...overrides };
}

describe("repairCandidate — global steps", () => {
  it("grows a box that fell below its measured minimum back up to the floor", () => {
    const cta = pool.find((p) => p.element.id === "cta")!;
    const undersized: ResolvedBox = {
      id: "cta",
      x: 10,
      y: 10,
      width: cta.measurement.minWidth - 20,
      height: cta.measurement.minHeight,
      presentation: presentation(),
    };
    const raw: LayoutCandidate = { strategy: "band", boxes: [undersized] };
    const repaired = repairCandidate(raw, pool, rect, 10, surface);
    const box = repaired.boxes.find((b) => b.id === "cta")!;
    expect(box.width).toBeGreaterThanOrEqual(cta.measurement.minWidth - 0.01);
  });

  it("never drops a box the raw candidate had", () => {
    const heroItem = pool.find((p) => p.element.id === "product-image")!;
    const headlineItem = pool.find((p) => p.element.id === "headline")!;
    const raw: LayoutCandidate = {
      strategy: "stack",
      boxes: [
        { id: "headline", x: 0, y: 0, width: headlineItem.measurement.prefWidth, height: headlineItem.measurement.prefHeight, presentation: presentation() },
        { id: "product-image", x: 0, y: 60, width: heroItem.measurement.prefWidth, height: heroItem.measurement.prefHeight, presentation: presentation() },
      ],
    };
    const repaired = repairCandidate(raw, pool, rect, 10, surface);
    expect(repaired.boxes.length).toBe(raw.boxes.length);
    expect(repaired.boxes.map((b) => b.id).sort()).toEqual(raw.boxes.map((b) => b.id).sort());
  });

  it("leaves a well-formed candidate materially unchanged (idempotent under repeated repair)", () => {
    const heroItem = pool.find((p) => p.element.id === "product-image")!;
    const raw: LayoutCandidate = {
      strategy: "poster",
      boxes: [{ id: "product-image", x: 250, y: 100, width: 300, height: 300 / (heroItem.measurement.prefWidth / heroItem.measurement.prefHeight), presentation: presentation() }],
    };
    const once = repairCandidate(raw, pool, rect, 10, surface);
    const twice = repairCandidate(once, pool, rect, 10, surface);
    expect(twice.boxes[0]!.width).toBeCloseTo(once.boxes[0]!.width, 1);
    expect(twice.boxes[0]!.height).toBeCloseTo(once.boxes[0]!.height, 1);
  });
});

describe("repairCandidate — split", () => {
  it("grows the CTA toward its 86% copy-column target when slack exists", () => {
    const heroBox: ResolvedBox = { id: "product-image", x: 500, y: 0, width: 300, height: 230, presentation: presentation() };
    const narrowCta: ResolvedBox = { id: "cta", x: 20, y: 300, width: 100, height: 44, presentation: presentation() };
    const raw: LayoutCandidate = { strategy: "split", boxes: [heroBox, narrowCta] };

    const repaired = repairCandidate(raw, pool, rect, 10, surface);
    const repairedCta = repaired.boxes.find((b) => b.id === "cta")!;

    const copyColumnWidth = heroBox.x - 10 - rect.x; // gap=10
    expect(repairedCta.width).toBeGreaterThan(narrowCta.width);
    expect(repairedCta.width).toBeCloseTo(copyColumnWidth * 0.86, 0);
  });

  it("does not shrink a CTA that's already wider than the 86% target", () => {
    const heroBox: ResolvedBox = { id: "product-image", x: 500, y: 0, width: 300, height: 230, presentation: presentation() };
    const wideCta: ResolvedBox = { id: "cta", x: 20, y: 300, width: 470, height: 44, presentation: presentation() };
    const raw: LayoutCandidate = { strategy: "split", boxes: [heroBox, wideCta] };
    const repaired = repairCandidate(raw, pool, rect, 10, surface);
    const repairedCta = repaired.boxes.find((b) => b.id === "cta")!;
    expect(repairedCta.width).toBeGreaterThanOrEqual(wideCta.width - 0.01);
  });
});

describe("repairCandidate — band", () => {
  it("reclaims an oversized gap between two non-hero members and hands it to the hero instead of leaving it as dead space", () => {
    // repairBand only reclaims slack found between two NON-hero neighbors
    // (mirroring how a real Band composition can end up with, say, extra
    // room between price and CTA) — a gap directly touching the hero is left
    // alone since the hero's own width is what's being adjusted.
    const headlineItem = pool.find((p) => p.element.id === "headline")!;
    const priceItem = pool.find((p) => p.element.id === "price")!;
    const ctaItem = pool.find((p) => p.element.id === "cta")!;
    const heroItem = pool.find((p) => p.element.id === "product-image")!;

    const headlineBox: ResolvedBox = {
      id: "headline",
      x: 0,
      y: 30,
      width: headlineItem.measurement.minWidth + 20,
      height: headlineItem.measurement.minHeight,
      presentation: presentation(),
    };
    const heroBox: ResolvedBox = {
      id: "product-image",
      x: headlineBox.x + headlineBox.width + 10,
      y: 0,
      width: heroItem.measurement.minWidth + 20,
      height: 100,
      presentation: presentation(),
    };
    const priceBox: ResolvedBox = {
      id: "price",
      x: heroBox.x + heroBox.width + 10,
      y: 30,
      width: priceItem.measurement.minWidth + 10,
      height: priceItem.measurement.minHeight,
      presentation: presentation(),
    };
    // gap between price and CTA is 60px, far more than the configured gap of 10
    const ctaBox: ResolvedBox = {
      id: "cta",
      x: priceBox.x + priceBox.width + 60,
      y: 20,
      width: ctaItem.measurement.minWidth + 10,
      height: ctaItem.measurement.minHeight,
      presentation: presentation(),
    };
    const raw: LayoutCandidate = { strategy: "band", boxes: [headlineBox, heroBox, priceBox, ctaBox] };

    const repaired = repairCandidate(raw, pool, rect, 10, surface);
    const repairedHero = repaired.boxes.find((b) => b.id === "product-image")!;

    const excessGap = 60 - 10;
    expect(repairedHero.width).toBeCloseTo(heroBox.width + excessGap, 0);
  });
});

describe("repairCandidate — poster", () => {
  it("grows the hero toward its 82% target width when vertical room allows", () => {
    // headline above, CTA below — both centered on the same axis as the hero,
    // so the generic post-repair rebalance pass has no asymmetric slack to
    // correct and this test isolates repairPoster's own centering logic.
    // (With no other boxes, availHeight would collapse to exactly the hero's
    // own height — i.e. zero slack — by construction.)
    const headlineBox: ResolvedBox = { id: "headline", x: 300, y: 20, width: 200, height: 40, presentation: presentation() };
    const ctaBox: ResolvedBox = { id: "cta", x: 340, y: 500, width: 120, height: 44, presentation: presentation() };
    const smallHero: ResolvedBox = { id: "product-image", x: 300, y: 150, width: 200, height: 153.8, presentation: presentation() };
    const raw: LayoutCandidate = { strategy: "poster", boxes: [headlineBox, smallHero, ctaBox] };

    const repaired = repairCandidate(raw, pool, rect, 10, surface);
    const repairedHero = repaired.boxes.find((b) => b.id === "product-image")!;

    expect(repairedHero.width).toBeGreaterThan(smallHero.width);
    expect(repairedHero.width).toBeLessThanOrEqual(rect.width * 0.82 + 0.5);
    // stays centered
    const center = repairedHero.x + repairedHero.width / 2;
    expect(center).toBeCloseTo(rect.x + rect.width / 2, -1);
  });
});
