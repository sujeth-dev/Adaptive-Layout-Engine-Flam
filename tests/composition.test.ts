import { describe, expect, it } from "vitest";
import { demoAd } from "../src/spec";
import { resolveLayout } from "../src/resolver";
import { broadcastLowerThird, mobileLandscape, mobilePortrait, retailKiosk } from "../src/surfaces";
import type { ResolvedLayout, SurfaceProfile } from "../src/types";
import { assertInvariants } from "./helpers";

function resolve(surface: SurfaceProfile): ResolvedLayout {
  const result = resolveLayout(demoAd, surface);
  expect(result.ok, !result.ok ? `${result.message}: ${result.details.join("; ")}` : "").toBe(true);
  if (!result.ok) throw new Error(result.message);
  assertInvariants(result.layout, surface, demoAd);
  return result.layout;
}

describe("frame-fill composition — 320×480 visual target", () => {
  it("uses authored order, full-width hero/action, strong coverage, and balanced margins", () => {
    const layout = resolve(mobilePortrait);
    const safeWidth = mobilePortrait.width - mobilePortrait.safeArea!.left - mobilePortrait.safeArea!.right;

    expect(layout.strategy).toBe("vertical-stack");
    expect(layout.presentation).toBe("frame-fill");
    expect(layout.omitted).toEqual([]);
    expect(layout.degradations).toEqual([]);
    expect([...layout.boxes].sort((a, b) => a.y - b.y).map((box) => box.id)).toEqual([
      "headline",
      "product-image",
      "cta",
      "price",
      "logo",
    ]);

    const headline = layout.boxes.find((box) => box.id === "headline")!;
    const hero = layout.boxes.find((box) => box.id === "product-image")!;
    const cta = layout.boxes.find((box) => box.id === "cta")!;
    const price = layout.boxes.find((box) => box.id === "price")!;
    const logo = layout.boxes.find((box) => box.id === "logo")!;

    expect(headline.width / safeWidth).toBeGreaterThanOrEqual(0.9);
    expect(hero.width / safeWidth).toBeGreaterThanOrEqual(0.95);
    expect(hero.width / hero.height).toBeCloseTo(1.3, 5);
    expect(cta.width / safeWidth).toBeGreaterThanOrEqual(0.9);
    expect(cta.height).toBeGreaterThanOrEqual(44);
    expect(price.width / safeWidth).toBeLessThan(0.3);
    expect(logo.width / safeWidth).toBeLessThan(0.3);
    expect(layout.composition.coverageX).toBeGreaterThanOrEqual(0.95);
    expect(layout.composition.coverageY).toBeGreaterThanOrEqual(0.85);
    expect(layout.composition.balanceX).toBeGreaterThanOrEqual(0.92);
    expect(layout.composition.balanceY).toBeGreaterThanOrEqual(0.92);
  });
});

describe("frame-fill composition — required and extreme surfaces", () => {
  it("uses the landscape flow axis", () => {
    expect(resolve(mobileLandscape).composition.coverageX).toBeGreaterThanOrEqual(0.9);
  });

  it("uses at least 80% of broadcast width", () => {
    const layout = resolve(broadcastLowerThird);
    expect(layout.strategy).toBe("horizontal-band");
    expect(layout.composition.coverageX).toBeGreaterThanOrEqual(0.8);
  });

  it("uses at least 60% of both kiosk axes", () => {
    const layout = resolve(retailKiosk);
    expect(layout.composition.coverageX).toBeGreaterThanOrEqual(0.6);
    expect(layout.composition.coverageY).toBeGreaterThanOrEqual(0.6);
  });

  it("fails cleanly at the minimum width and height", () => {
    const result = resolveLayout(demoAd, { id: "min-both", width: 100, height: 80 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-valid-layout");
  });

  it("keeps the priority-one core centered on an extremely tall, narrow surface", () => {
    const surface = { id: "min-width-max-height", width: 100, height: 1200 };
    const layout = resolve(surface);
    expect(layout.boxes.map((box) => box.id)).toEqual(expect.arrayContaining(["headline", "product-image"]));
    expect(layout.composition.balanceX).toBeGreaterThanOrEqual(0.92);
    expect(layout.composition.balanceY).toBeGreaterThanOrEqual(0.92);
  });

  it("fills the flow axis on extremely wide and narrow-tall surfaces", () => {
    const wide = resolve({ id: "max-width-min-height", width: 1920, height: 80 });
    const tall = resolve({ id: "narrow-tall", width: 200, height: 1200 });
    expect(wide.composition.coverageX).toBeGreaterThanOrEqual(0.8);
    expect(wide.composition.balanceX).toBeGreaterThanOrEqual(0.92);
    expect(wide.composition.balanceY).toBeGreaterThanOrEqual(0.92);
    expect(tall.composition.coverageY).toBeGreaterThanOrEqual(0.35);
    expect(tall.composition.balanceX).toBeGreaterThanOrEqual(0.92);
    expect(tall.composition.balanceY).toBeGreaterThanOrEqual(0.92);
  });

  it("covers both axes on the maximum-size surface", () => {
    const layout = resolve({ id: "max-both", width: 1920, height: 1200 });
    expect(layout.composition.coverageX).toBeGreaterThanOrEqual(0.55);
    expect(layout.composition.coverageY).toBeGreaterThanOrEqual(0.55);
  });

  it.each([
    { id: "explore-tall", width: 237, height: 947, safeArea: { top: 23, right: 9, bottom: 31, left: 14 }, minTapTarget: 44 },
    { id: "explore-wide", width: 1536, height: 184, safeArea: { top: 8, right: 48, bottom: 11, left: 36 }, minTextSize: 24 },
    { id: "explore-square", width: 711, height: 711, minTapTarget: 52, minTextSize: 18, touchOnly: true },
    { id: "explore-portrait", width: 420, height: 980, safeArea: { top: 37, right: 19, bottom: 41, left: 17 } },
    { id: "explore-landscape", width: 1280, height: 360, viewingDistance: "far" as const, minTextSize: 28 },
  ])("resolves exploratory profile $id with balanced geometry", (surface) => {
    const layout = resolve(surface);
    expect(layout.composition.balanceX).toBeGreaterThanOrEqual(0.75);
    expect(layout.composition.balanceY).toBeGreaterThanOrEqual(0.75);
  });
});
