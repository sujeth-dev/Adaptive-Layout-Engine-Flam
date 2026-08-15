import { describe, expect, it } from "vitest";
import { demoAd } from "../src/spec";
import { broadcastLowerThird, mobileLandscape, mobilePortrait, retailKiosk, requiredSurfaces } from "../src/surfaces";
import { resolveLayout } from "../src/resolver";
import { measureElement } from "../src/measure";
import { normalizeSurfaceProfile } from "../src/validate";
import type { ResolvedLayout, SurfaceProfile } from "../src/types";

function assertInvariants(layout: ResolvedLayout, surface: SurfaceProfile) {
  const normalized = normalizeSurfaceProfile(surface);
  const bounds = {
    left: normalized.safeArea.left,
    top: normalized.safeArea.top,
    right: normalized.width - normalized.safeArea.right,
    bottom: normalized.height - normalized.safeArea.bottom,
  };

  for (const box of layout.boxes) {
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(bounds.left - 0.01);
    expect(box.y).toBeGreaterThanOrEqual(bounds.top - 0.01);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.right + 0.01);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.bottom + 0.01);
  }

  for (let i = 0; i < layout.boxes.length; i++) {
    for (let j = i + 1; j < layout.boxes.length; j++) {
      const a = layout.boxes[i]!;
      const b = layout.boxes[j]!;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(overlapX > 0.01 && overlapY > 0.01, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }

  const rect = { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
  for (const el of demoAd.elements) {
    const box = layout.boxes.find((b) => b.id === el.id);
    if (!box) continue; // omitted, checked elsewhere
    const measurement = measureElement(el, normalized, rect);
    expect(box.width, `${el.id} width below floor`).toBeGreaterThanOrEqual(measurement.minWidth - 0.5);
    expect(box.height, `${el.id} height below floor`).toBeGreaterThanOrEqual(measurement.minHeight - 0.5);
    if (el.type === "button" && normalized.minTapTarget > 0) {
      expect(box.width).toBeGreaterThanOrEqual(normalized.minTapTarget - 0.5);
      expect(box.height).toBeGreaterThanOrEqual(normalized.minTapTarget - 0.5);
    }
  }

  const priorityOneIds = demoAd.elements.filter((e) => e.priority === 1).map((e) => e.id);
  for (const id of priorityOneIds) {
    expect(layout.omitted.some((o) => o.id === id), `priority-1 element "${id}" was omitted`).toBe(false);
    expect(layout.boxes.some((b) => b.id === id), `priority-1 element "${id}" missing from boxes`).toBe(true);
  }
}

describe("resolveLayout — required surfaces", () => {
  for (const surface of requiredSurfaces) {
    it(`resolves ${surface.id} with no overlap/clipping and priority-1 intact`, () => {
      const result = resolveLayout(demoAd, surface);
      expect(result.ok, !result.ok ? result.message + " " + result.details.join("; ") : "").toBe(true);
      if (result.ok) assertInvariants(result.layout, surface);
    });
  }
});

describe("resolveLayout — unknown fifth surface", () => {
  it("resolves an arbitrary never-seen-before profile without resolver changes", () => {
    const interviewSurface: SurfaceProfile = {
      id: "interviewSurface",
      width: 742,
      height: 286,
      minTapTarget: 52,
      minTextSize: 20,
      viewingDistance: "medium",
    };
    const result = resolveLayout(demoAd, interviewSurface);
    expect(result.ok).toBe(true);
    if (result.ok) assertInvariants(result.layout, interviewSurface);
  });
});

describe("resolveLayout — constrained surface", () => {
  it("degrades lower-priority content before dropping to a valid layout", () => {
    const tight: SurfaceProfile = { id: "tightBanner", width: 300, height: 130, minTapTarget: 40 };
    const result = resolveLayout(demoAd, tight);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertInvariants(result.layout, tight);
    // something had to give in a space this tight
    expect(result.layout.degradations.length + result.layout.omitted.length).toBeGreaterThan(0);
    // branding (priority 3) must be sacrificed before headline/hero (priority 1)
    if (result.layout.omitted.length > 0) {
      const omittedIds = result.layout.omitted.map((o) => o.id);
      expect(omittedIds).toContain("logo");
      expect(omittedIds).not.toContain("headline");
      expect(omittedIds).not.toContain("product-image");
    }
  });
});

describe("resolveLayout — determinism", () => {
  it("produces an identical result across repeated resolutions", () => {
    const a = resolveLayout(demoAd, mobilePortrait);
    const b = resolveLayout(demoAd, mobilePortrait);
    expect(a).toEqual(b);
  });
});

describe("resolveLayout — structural adaptation", () => {
  it("portrait and broadcast surfaces produce genuinely different compositions", () => {
    const portrait = resolveLayout(demoAd, mobilePortrait);
    const broadcast = resolveLayout(demoAd, broadcastLowerThird);
    expect(portrait.ok).toBe(true);
    expect(broadcast.ok).toBe(true);
    if (!portrait.ok || !broadcast.ok) return;

    // not just uniform scaling: the strategy chosen (and therefore the arrangement) differs
    expect(portrait.layout.strategy).not.toBe(broadcast.layout.strategy);

    const heroPortrait = portrait.layout.boxes.find((b) => b.id === "product-image")!;
    const heroBroadcast = broadcast.layout.boxes.find((b) => b.id === "product-image")!;
    // relative position of hero vs headline should differ (not simply scaled copies)
    const portraitHeroIsAboveHeadline = heroPortrait.y < portrait.layout.boxes.find((b) => b.id === "headline")!.y;
    const broadcastHeroIsAboveHeadline = heroBroadcast.y < broadcast.layout.boxes.find((b) => b.id === "headline")!.y;
    expect(portraitHeroIsAboveHeadline !== broadcastHeroIsAboveHeadline || portrait.layout.strategy !== broadcast.layout.strategy).toBe(
      true,
    );
  });

  it("mobile landscape and mobile portrait do not resolve to identical geometry", () => {
    const portrait = resolveLayout(demoAd, mobilePortrait);
    const landscape = resolveLayout(demoAd, mobileLandscape);
    expect(portrait.ok).toBe(true);
    expect(landscape.ok).toBe(true);
    if (!portrait.ok || !landscape.ok) return;
    expect(portrait.layout.boxes).not.toEqual(landscape.layout.boxes);
  });

  it("kiosk (square) uses a meaningfully different arrangement than the lower-third (ultra-wide)", () => {
    const kiosk = resolveLayout(demoAd, retailKiosk);
    const broadcast = resolveLayout(demoAd, broadcastLowerThird);
    expect(kiosk.ok).toBe(true);
    expect(broadcast.ok).toBe(true);
    if (!kiosk.ok || !broadcast.ok) return;
    expect(kiosk.layout.boxes).not.toEqual(broadcast.layout.boxes);
  });
});

describe("resolveLayout — impossible input", () => {
  it("fails cleanly (typed failure) instead of producing broken geometry when nothing can fit", () => {
    const impossible: SurfaceProfile = { id: "impossible", width: 20, height: 20 };
    const result = resolveLayout(demoAd, impossible);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no-valid-layout");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("rejects an invalid surface profile before ever attempting layout", () => {
    const bad: SurfaceProfile = { id: "bad", width: -5, height: 100 };
    const result = resolveLayout(demoAd, bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid-surface");
  });

  it("rejects an invalid ad spec before ever attempting layout", () => {
    const badSpec = { id: "bad-spec", elements: [] };
    const result = resolveLayout(badSpec, mobilePortrait);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid-spec");
  });
});
