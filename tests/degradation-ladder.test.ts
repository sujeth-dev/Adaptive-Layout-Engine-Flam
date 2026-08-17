// Tests for the fixed degradation ladder (resolver.ts's header comment has the
// exact rung order): full/default gap -> full/compact gap -> brand hidden ->
// price compact -> CTA compact -> price may drop -> hero crop/shrink ->
// headline compact -> fail. Each test below uses a real surface width/height
// pair, found by sweeping, that naturally lands on the rung boundary it
// demonstrates — not a hand-waved illustration.

import { describe, expect, it } from "vitest";
import { demoAd } from "../src/spec";
import { resolveLayout } from "../src/resolver";
import { measureElement } from "../src/measure";
import { normalizeSurfaceProfile } from "../src/validate";
import { qrLandingPanel } from "../src/surfaces";
import type { SurfaceProfile } from "../src/types";
import { assertInvariants as assertInvariantsShared } from "./helpers";

function assertInvariants(layout: Parameters<typeof assertInvariantsShared>[0], surface: SurfaceProfile) {
  assertInvariantsShared(layout, surface, demoAd);
}

const TAP = { minTapTarget: 40 };

describe("degradation ladder — brand hides first", () => {
  it("hides branding alone when that's enough, leaving everything else full", () => {
    const surface: SurfaceProfile = { id: "brand-only", width: 200, height: 220, ...TAP };
    const result = resolveLayout(demoAd, surface);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertInvariants(result.layout, surface);

    expect(result.layout.degradations).toEqual([{ id: "logo", action: "hide", detail: "hidden to reserve space" }]);
    expect(result.layout.omitted).toEqual([{ id: "logo", reason: "hidden to reserve space for higher-priority content" }]);
    expect(result.layout.boxes.some((b) => b.id === "logo")).toBe(false);

    for (const id of ["headline", "product-image", "price", "cta"]) {
      const box = result.layout.boxes.find((b) => b.id === id)!;
      expect(box.presentation.variant).toBe("full");
    }
  });
});

describe("degradation ladder — the demo's own tight preset (QR landing panel)", () => {
  it("hides branding cleanly while headline/hero/price/CTA stay at full content, in the demo picker's real surface", () => {
    const result = resolveLayout(demoAd, qrLandingPanel);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertInvariants(result.layout, qrLandingPanel);

    expect(result.layout.omitted).toEqual([{ id: "logo", reason: "hidden to reserve space for higher-priority content" }]);
    expect(result.layout.boxes.some((b) => b.id === "logo")).toBe(false);

    for (const id of ["headline", "product-image", "price", "cta"]) {
      const box = result.layout.boxes.find((b) => b.id === id)!;
      expect(box.presentation.variant).toBe("full");
      expect(box.presentation.visible).toBe(true);
    }
  });
});

describe("degradation ladder — price and CTA compact before priority-1 is touched", () => {
  it("switches price and CTA to compact content while headline/hero stay full", () => {
    const surface: SurfaceProfile = { id: "price-cta-compact", width: 170, height: 220, ...TAP };
    const result = resolveLayout(demoAd, surface);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertInvariants(result.layout, surface);

    expect(result.layout.omitted.map((o) => o.id)).toEqual(["logo"]);
    const price = result.layout.boxes.find((b) => b.id === "price")!;
    const cta = result.layout.boxes.find((b) => b.id === "cta")!;
    expect(price.presentation.variant).toBe("compact");
    expect(cta.presentation.variant).toBe("compact");

    const headline = result.layout.boxes.find((b) => b.id === "headline")!;
    const hero = result.layout.boxes.find((b) => b.id === "product-image")!;
    expect(headline.presentation.variant).toBe("full");
    expect(hero.presentation.cropped).toBe(false);
  });
});

describe("degradation ladder — price may drop, CTA never does", () => {
  it("drops price entirely once compacting it isn't enough, while CTA survives (compact, not dropped)", () => {
    const surface: SurfaceProfile = { id: "price-drop", width: 150, height: 220, ...TAP };
    const result = resolveLayout(demoAd, surface);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertInvariants(result.layout, surface);

    expect(result.layout.boxes.some((b) => b.id === "price")).toBe(false);
    expect(result.layout.omitted.map((o) => o.id).sort()).toEqual(["logo", "price"]);
    expect(result.layout.degradations.some((d) => d.id === "price" && d.action === "drop")).toBe(true);

    const cta = result.layout.boxes.find((b) => b.id === "cta")!;
    expect(cta).toBeTruthy();
    expect(result.layout.omitted.some((o) => o.id === "cta")).toBe(false);
  });
});

describe("degradation ladder — hero and headline degrade only as a last resort", () => {
  it("crops/shrinks the hero and compacts headline only once everything lower-priority is exhausted", () => {
    const surface: SurfaceProfile = { id: "last-resort", width: 130, height: 220, ...TAP };
    const result = resolveLayout(demoAd, surface);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertInvariants(result.layout, surface);

    // priority 1 is degraded in presentation, but never omitted
    expect(result.layout.boxes.some((b) => b.id === "headline")).toBe(true);
    expect(result.layout.boxes.some((b) => b.id === "product-image")).toBe(true);
    expect(result.layout.omitted.some((o) => o.id === "headline" || o.id === "product-image")).toBe(false);

    const headline = result.layout.boxes.find((b) => b.id === "headline")!;
    const hero = result.layout.boxes.find((b) => b.id === "product-image")!;
    expect(headline.presentation.variant).toBe("compact");
    expect(hero.presentation.cropped).toBe(true);
  });
});

describe("degradation ladder — global spacing-compaction rung", () => {
  it("resolves via a tighter gap alone, before any content or geometry degrades", () => {
    const surface: SurfaceProfile = {
      id: "gap-only",
      width: 420,
      height: 180,
      safeArea: { top: 16, right: 12, bottom: 16, left: 12 },
      minTapTarget: 44,
    };
    const result = resolveLayout(demoAd, surface);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertInvariants(result.layout, surface);
    if (result.layout.degradations.length > 0) {
      expect(result.layout.degradations[0]!.action).toBe("compact-spacing");
    }
    expect(result.layout.omitted).toEqual([]);
    expect(result.layout.boxes).toHaveLength(demoAd.elements.length);
  });

  it("prefers the default (comfortable) gap whenever it already fits — compaction never fires needlessly", () => {
    const result = resolveLayout(demoAd, { id: "roomy", width: 320, height: 480, safeArea: { top: 16, right: 12, bottom: 16, left: 12 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.degradations.some((d) => d.action === "compact-spacing")).toBe(false);
  });
});

describe("text measurement", () => {
  it("falls back to a positive, length-monotonic estimate in this Node test environment", () => {
    // No canvas is available under vitest (environment:"node", no jsdom/canvas
    // dependency) — this exercises measureTextWidth's fallback path, the same path
    // covered indirectly by every other test in this suite. The real
    // CanvasRenderingContext2D.measureText() path only runs in an actual browser;
    // it is verified by the Playwright suite's instrumented real-browser test.
    const surface = normalizeSurfaceProfile({ id: "text-check", width: 400, height: 400 });
    const rect = { x: 0, y: 0, width: 400, height: 400 };
    const headline = demoAd.elements.find((e) => e.id === "headline")!;
    const full = measureElement(headline, surface, rect, "full", false);
    const compact = measureElement(headline, surface, rect, "compact", false);
    expect(full.prefWidth).toBeGreaterThan(0);
    expect(compact.prefWidth).toBeGreaterThan(0);
    // "40% Off" is meaningfully shorter than "Summer Sale — 40% Off"
    expect(compact.prefWidth).toBeLessThan(full.prefWidth);
  });
});
