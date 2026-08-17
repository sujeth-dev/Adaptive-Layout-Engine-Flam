// General composition quality checks on surfaces OTHER than the five
// canonical checkpoints (those live in tests/checkpoints.test.ts) — extreme
// aspect ratios, exploratory profiles, and clean-failure behavior.

import { describe, expect, it } from "vitest";
import { demoAd } from "../src/spec";
import { resolveLayout } from "../src/resolver";
import type { ResolvedLayout, SurfaceProfile } from "../src/types";
import { assertInvariants } from "./helpers";

function resolve(surface: SurfaceProfile): ResolvedLayout {
  const result = resolveLayout(demoAd, surface);
  expect(result.ok, !result.ok ? `${result.message}: ${result.details.join("; ")}` : "").toBe(true);
  if (!result.ok) throw new Error(result.message);
  assertInvariants(result.layout, surface, demoAd);
  return result.layout;
}

describe("extreme aspect ratios", () => {
  it("fails cleanly at the minimum width and height", () => {
    const result = resolveLayout(demoAd, { id: "min-both", width: 100, height: 80 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-valid-layout");
  });

  it("keeps the priority-one core present on an extremely tall, narrow surface", () => {
    const surface = { id: "min-width-max-height", width: 100, height: 1200 };
    const layout = resolve(surface);
    expect(layout.boxes.map((box) => box.id)).toEqual(expect.arrayContaining(["headline", "product-image"]));
  });

  it("resolves a valid band on an extremely wide, short surface", () => {
    // At only 80px tall, every element (including the hero, aspect-bound by
    // height) is naturally small — a sparse-looking but perfectly legal
    // composition, not a bug. This just confirms it resolves cleanly.
    const wide = resolve({ id: "max-width-min-height", width: 1920, height: 80 });
    expect(wide.strategy).toBe("band");
  });

  it("covers both axes on the maximum-size surface", () => {
    const layout = resolve({ id: "max-both", width: 1920, height: 1200 });
    expect(layout.composition.coverageX).toBeGreaterThanOrEqual(0.3);
    expect(layout.composition.coverageY).toBeGreaterThanOrEqual(0.3);
  });

  it.each([
    { id: "explore-tall", width: 237, height: 947, safeArea: { top: 23, right: 9, bottom: 31, left: 14 }, minTapTarget: 44 },
    { id: "explore-wide", width: 1536, height: 184, safeArea: { top: 8, right: 48, bottom: 11, left: 36 }, minTextSize: 24 },
    { id: "explore-square", width: 711, height: 711, minTapTarget: 52, minTextSize: 18, touchOnly: true },
    { id: "explore-portrait", width: 420, height: 980, safeArea: { top: 37, right: 19, bottom: 41, left: 17 } },
    { id: "explore-landscape", width: 1280, height: 360, viewingDistance: "far" as const, minTextSize: 28 },
  ])("resolves exploratory profile $id with a valid, invariant-respecting layout", (surface) => {
    resolve(surface);
  });
});
