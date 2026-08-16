// Tests for the content-and-spacing-aware degradation ladder: the global
// spacing-compaction rung, and the per-tier merge/shorten/iconify content rungs that
// run before the existing shrink/truncate/crop/drop rungs. See resolver.ts's header
// comment for the exact rung order.

import { describe, expect, it } from "vitest";
import { demoAd } from "../src/spec";
import { resolveLayout } from "../src/resolver";
import { measureElement } from "../src/measure";
import { normalizeSurfaceProfile } from "../src/validate";
import type { SurfaceProfile } from "../src/types";
import { assertInvariants as assertInvariantsShared } from "./helpers";

function assertInvariants(layout: Parameters<typeof assertInvariantsShared>[0], surface: SurfaceProfile) {
  assertInvariantsShared(layout, surface, demoAd);
}

describe("degradation ladder — content-variant rungs", () => {
  const tight: SurfaceProfile = {
    id: "tight-content-ladder",
    width: 320,
    height: 211,
    safeArea: { top: 31, bottom: 3, left: 75, right: 87 },
    minTapTarget: 7,
    minTextSize: 11,
  };

  it("shortens and merges price/cta content before ever touching priority-1 headline/hero", () => {
    const result = resolveLayout(demoAd, tight);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertInvariants(result.layout, tight);

    // priority-3 branding drops first, as before this feature existed
    expect(result.layout.omitted.map((o) => o.id)).toContain("logo");

    // price folded into the CTA rather than existing as its own box
    expect(result.layout.boxes.some((b) => b.id === "price")).toBe(false);
    expect(result.layout.degradations.some((d) => d.id === "cta" && d.action === "merge" && d.mergedContent === "Buy $30")).toBe(true);
    expect(result.layout.omitted.some((o) => o.id === "price" && o.reason.includes("merged"))).toBe(true);

    // priority-1 content (headline/hero) is untouched — cta (priority 2) absorbed the
    // degradation first, exactly what "lower priority degrades first" requires
    expect(result.layout.degradations.some((d) => d.id === "headline")).toBe(false);
    expect(result.layout.degradations.some((d) => d.id === "product-image")).toBe(false);
    expect(result.layout.boxes.find((b) => b.id === "headline")?.width).toBeGreaterThan(0);
    expect(result.layout.boxes.find((b) => b.id === "product-image")?.width).toBeGreaterThan(0);
  });

  it("collapses the CTA to icon-only (with a merge already applied) rather than dropping it", () => {
    const result = resolveLayout(demoAd, tight);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // cta survives as a box — never dropped in this scenario, despite being degraded
    // through merge + iconify + shrink
    expect(result.layout.boxes.some((b) => b.id === "cta")).toBe(true);
    expect(result.layout.omitted.some((o) => o.id === "cta")).toBe(false);
    expect(result.layout.degradations.some((d) => d.id === "cta" && d.action === "iconify")).toBe(true);
  });
});

describe("degradation ladder — icon-only tap target guarantee", () => {
  it("an icon-only button's measured floor never drops below minTapTarget", () => {
    const surface = normalizeSurfaceProfile({ id: "tap-check", width: 400, height: 400, minTapTarget: 44 });
    const rect = { x: 0, y: 0, width: 400, height: 400 };
    const cta = demoAd.elements.find((e) => e.id === "cta")!;
    const iconMeasurement = measureElement(cta, surface, rect, "icon", false);
    // this is exactly what guarantees an icon-only CTA can never be squeezed narrower
    // or shorter than a real tappable target, the same guarantee the full-label state
    // already had (see measure.ts's measureButton)
    expect(iconMeasurement.minWidth).toBeGreaterThanOrEqual(44);
    expect(iconMeasurement.minHeight).toBeGreaterThanOrEqual(44);
  });

  // The accessible name (aria-label = the full original label whenever the icon-only
  // state renders) is enforced in render-dom.tsx, not resolver.ts — this project has no
  // DOM/component-testing harness (no @testing-library/react, no jsdom environment;
  // vite.config.ts runs tests under environment:"node"), so that specific behavior is
  // verified by code review and manual browser check rather than an automated test here.
});

describe("degradation ladder — global spacing-compaction rung", () => {
  it("resolves via a tighter gap alone, before any content or geometry degrades", () => {
    const surface: SurfaceProfile = {
      id: "gap-only",
      width: 220,
      height: 296,
      safeArea: { top: 16, right: 12, bottom: 16, left: 12 },
      minTapTarget: 44,
    };
    const result = resolveLayout(demoAd, surface);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertInvariants(result.layout, surface);
    expect(result.layout.degradations).toEqual([{ id: "*", action: "compact-spacing", detail: "gap reduced to 10px" }]);
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
    // it was verified manually (Playwright screenshots of the running demo) rather
    // than by an automated test, for the same reason noted above.
    const surface = normalizeSurfaceProfile({ id: "text-check", width: 400, height: 400 });
    const rect = { x: 0, y: 0, width: 400, height: 400 };
    const headline = demoAd.elements.find((e) => e.id === "headline")!;
    const full = measureElement(headline, surface, rect, "full", false);
    const short = measureElement(headline, surface, rect, "short", false);
    expect(full.prefWidth).toBeGreaterThan(0);
    expect(short.prefWidth).toBeGreaterThan(0);
    // "40% Off" is meaningfully shorter than "Summer Sale — 40% Off"
    expect(short.prefWidth).toBeLessThan(full.prefWidth);
  });
});
