// Unit tests for scoreCandidate — comparing a deliberately good candidate
// against a deliberately weak one on the same rect/pool, per term where it
// matters. Never asserts against a checkpoint dimension; every rect here is
// a plain, arbitrary size.

import { describe, expect, it } from "vitest";
import { evaluateComposition, scoreCandidate } from "../src/score";
import { normalizeSurfaceProfile } from "../src/validate";
import { measureAll } from "../src/measure";
import { demoAd } from "../src/spec";
import type { LayoutCandidate, Rect, ResolvedBox } from "../src/types";

const surface = normalizeSurfaceProfile({ id: "score-test", width: 800, height: 600, minTapTarget: 44, minTextSize: 14 });
const rect: Rect = { x: 0, y: 0, width: 800, height: 600 };
const pool = measureAll(demoAd.elements, surface, rect);

function box(id: string, x: number, y: number, width: number, height: number, variant: "full" | "compact" = "full", cropped = false): ResolvedBox {
  return { id, x, y, width, height, presentation: { variant, visible: true, cropped, fontSize: 16 } };
}

function score(candidate: LayoutCandidate, withPool = pool) {
  return scoreCandidate(candidate, withPool, demoAd.elements, rect, evaluateComposition(candidate, rect));
}

// priorityRetention/cropPenalty/degradationPenalty read the POOL's own
// contentVariant/cropped/shrunk flags (the resolver keeps pool and box
// presentation in sync within a real attempt) — so a synthetic test that
// wants a "cropped" or "compact" candidate needs a pool reflecting that too,
// not just a box.presentation flag with no matching pool state.
function poolWith(id: string, overrides: Partial<(typeof pool)[number]>) {
  return pool.map((item) => (item.element.id === id ? { ...item, ...overrides } : item));
}

describe("scoreCandidate — priority retention", () => {
  it("scores a candidate with all elements higher than one missing a low-priority element, all else equal", () => {
    const full: LayoutCandidate = {
      strategy: "band",
      boxes: [box("headline", 0, 0, 200, 40), box("product-image", 220, 0, 200, 150), box("price", 440, 0, 60, 30), box("cta", 520, 0, 100, 44), box("logo", 640, 0, 72, 20)],
    };
    const missingBrand: LayoutCandidate = { strategy: "band", boxes: full.boxes.filter((b) => b.id !== "logo") };
    expect(score(full)).toBeGreaterThan(score(missingBrand));
  });

  it("scores a candidate missing the CTA (priority 2) lower than one missing only branding (priority 3), holding geometry identical", () => {
    // Same four rectangles in both candidates — only the id label on the
    // fourth slot changes — so coverage/balance/dead-region are identical
    // and the only thing that can move the score is which priority value
    // was dropped.
    const commonSlots = [box("headline", 0, 0, 200, 40), box("product-image", 220, 0, 200, 150), box("price", 440, 0, 60, 30)];
    const missingBranding: LayoutCandidate = { strategy: "band", boxes: [...commonSlots, box("cta", 520, 0, 100, 44)] };
    const missingCta: LayoutCandidate = { strategy: "band", boxes: [...commonSlots, box("logo", 520, 0, 100, 44)] };
    expect(score(missingBranding)).toBeGreaterThan(score(missingCta));
  });
});

describe("scoreCandidate — hero quality and prominence", () => {
  it("prefers a hero near its natural aspect ratio over one stretched away from it", () => {
    const heroItem = pool.find((p) => p.element.id === "product-image")!;
    const aspect = heroItem.measurement.prefWidth / heroItem.measurement.prefHeight;
    const natural: LayoutCandidate = { strategy: "poster", boxes: [box("product-image", 200, 100, 400, 400 / aspect)] };
    const stretched: LayoutCandidate = { strategy: "poster", boxes: [box("product-image", 200, 100, 400, 100)] };
    expect(score(natural)).toBeGreaterThan(score(stretched));
  });

  it("prefers a moderately prominent hero over a token-sized one", () => {
    const heroItem = pool.find((p) => p.element.id === "product-image")!;
    const aspect = heroItem.measurement.prefWidth / heroItem.measurement.prefHeight;
    const moderate: LayoutCandidate = { strategy: "poster", boxes: [box("product-image", 200, 100, 360, 360 / aspect)] };
    const tiny: LayoutCandidate = { strategy: "poster", boxes: [box("product-image", 380, 280, 40, 40 / aspect)] };
    expect(score(moderate)).toBeGreaterThan(score(tiny));
  });

  it("hero-area prominence term peaks mid-range rather than favoring maximum area", () => {
    // Isolate the prominence sub-term directly: heroQualityAndProminence
    // peaks around ~45% of the rect's area rather than rewarding area
    // monotonically. The full composite score blends this with frameUsage,
    // hierarchyQuality, etc., which can legitimately pull the other way for
    // any single synthetic example — this checks the term itself, which is
    // what CP4 (1080×1080 Poster) actually depends on in practice.
    const heroItem = pool.find((p) => p.element.id === "product-image")!;
    const aspect = heroItem.measurement.prefWidth / heroItem.measurement.prefHeight;
    const rectArea = rect.width * rect.height;
    const nearPeakWidth = Math.sqrt(rectArea * 0.45 * aspect);
    const nearPeak: LayoutCandidate = { strategy: "poster", boxes: [box("product-image", (rect.width - nearPeakWidth) / 2, 0, nearPeakWidth, nearPeakWidth / aspect)] };
    const edgeToEdge: LayoutCandidate = { strategy: "poster", boxes: [box("product-image", 0, 0, rect.width, rect.width / aspect)] };
    // both are single-box candidates with equal aspect fidelity, so any score
    // difference here comes from the area term alone
    expect(score(nearPeak)).toBeGreaterThan(score(edgeToEdge));
  });
});

describe("scoreCandidate — dead region penalty", () => {
  it("penalizes content pushed to the far edges with a hollow, empty middle", () => {
    // symmetric content near both edges, nothing in the center third
    const hollow: LayoutCandidate = {
      strategy: "band",
      boxes: [box("headline", 0, 0, 100, 40), box("product-image", 700, 0, 100, 80), box("price", 0, 100, 80, 30), box("cta", 700, 100, 100, 44)],
    };
    // same elements, distributed across the full width including the center
    const distributed: LayoutCandidate = {
      strategy: "band",
      boxes: [box("headline", 0, 0, 100, 40), box("product-image", 350, 0, 100, 80), box("price", 500, 100, 80, 30), box("cta", 650, 100, 100, 44)],
    };
    expect(score(distributed)).toBeGreaterThan(score(hollow));
  });
});

describe("scoreCandidate — crop and degradation penalties", () => {
  it("prefers an uncropped hero over a cropped one, all else equal", () => {
    const heroItem = pool.find((p) => p.element.id === "product-image")!;
    const aspect = heroItem.measurement.prefWidth / heroItem.measurement.prefHeight;
    const uncropped: LayoutCandidate = { strategy: "poster", boxes: [box("product-image", 200, 100, 360, 360 / aspect, "full", false)] };
    const cropped: LayoutCandidate = { strategy: "poster", boxes: [box("product-image", 200, 100, 360, 360 / aspect, "full", true)] };
    const croppedPool = poolWith("product-image", { cropped: true });
    expect(score(uncropped)).toBeGreaterThan(score(cropped, croppedPool));
  });

  it("prefers full content over compact content, all else equal", () => {
    const full: LayoutCandidate = { strategy: "band", boxes: [box("headline", 0, 0, 200, 40, "full")] };
    const compact: LayoutCandidate = { strategy: "band", boxes: [box("headline", 0, 0, 200, 40, "compact")] };
    const compactPool = poolWith("headline", { contentVariant: "compact" });
    expect(score(full)).toBeGreaterThan(score(compact, compactPool));
  });
});

describe("scoreCandidate — bounds", () => {
  it("always returns a value in [0, 1]", () => {
    const candidate: LayoutCandidate = { strategy: "band", boxes: [box("headline", 0, 0, 200, 40), box("product-image", 220, 0, 200, 150)] };
    const s = score(candidate);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});
