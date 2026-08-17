import { describe, expect, it } from "vitest";
import { demoAd } from "../src/spec";
import { broadcastLowerThird, mobileLandscape, mobilePortrait, retailKiosk, requiredSurfaces } from "../src/surfaces";
import { resolveLayout } from "../src/resolver";
import type { SurfaceProfile } from "../src/types";
import { assertInvariants as assertInvariantsShared } from "./helpers";

function assertInvariants(layout: Parameters<typeof assertInvariantsShared>[0], surface: SurfaceProfile) {
  assertInvariantsShared(layout, surface, demoAd);
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
    const tight: SurfaceProfile = { id: "tightBanner", width: 220, height: 90, minTapTarget: 40 };
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
