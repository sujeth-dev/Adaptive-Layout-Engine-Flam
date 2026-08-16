// Fuzz testing: hundreds of arbitrary surface profiles, none hand-picked.
// For every successful resolution, every hard invariant must hold. For every
// failure, it must be a typed ResolutionFailure, never a thrown exception or
// broken geometry. A seeded PRNG keeps a failing run reproducible.

import { describe, expect, it } from "vitest";
import { demoAd } from "../src/spec";
import { resolveLayout } from "../src/resolver";
import { findInvariantViolations } from "./helpers";
import type { SurfaceProfile, ViewingDistance } from "../src/types";

const RUNS = 400;
const SEED = 20260815;

// mulberry32 -- small, deterministic, dependency-free PRNG
function mulberry32(seed: number) {
  let state = seed;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randomSurface(rand: () => number, index: number): SurfaceProfile {
  // 20% of draws are biased toward the tight low-end corner (small dims + large
  // constraints), since independently-uniform sampling across the full suggested
  // range rarely lands on a genuinely impossible combination on its own.
  const stressCorner = rand() < 0.2;
  const width = stressCorner ? randInt(rand, 200, 360) : randInt(rand, 200, 1920);
  const height = stressCorner ? randInt(rand, 120, 220) : randInt(rand, 120, 1200);
  const viewingDistances: ViewingDistance[] = ["close", "medium", "far"];

  const surface: SurfaceProfile = {
    id: `fuzz-${index}`,
    width,
    height,
  };
  if (rand() < 0.5) {
    surface.safeArea = {
      top: randInt(rand, 0, Math.floor(height * (stressCorner ? 0.3 : 0.15))),
      bottom: randInt(rand, 0, Math.floor(height * (stressCorner ? 0.3 : 0.15))),
      left: randInt(rand, 0, Math.floor(width * (stressCorner ? 0.3 : 0.15))),
      right: randInt(rand, 0, Math.floor(width * (stressCorner ? 0.3 : 0.15))),
    };
  }
  if (rand() < 0.6) surface.minTapTarget = randInt(rand, 0, stressCorner ? 90 : 72);
  if (rand() < 0.6) surface.minTextSize = randInt(rand, 0, stressCorner ? 48 : 40);
  if (rand() < 0.4) surface.viewingDistance = viewingDistances[randInt(rand, 0, 2)];
  if (rand() < 0.3) surface.touchOnly = true;
  return surface;
}

describe("fuzz — random surface profiles", () => {
  it(`resolves ${RUNS} arbitrary surfaces with zero invariant violations`, () => {
    const rand = mulberry32(SEED);
    let successes = 0;
    let explicitFailures = 0;
    const invariantViolations: string[] = [];

    for (let i = 0; i < RUNS; i++) {
      const surface = randomSurface(rand, i);
      const result = resolveLayout(demoAd, surface);

      if (result.ok) {
        successes++;
        const violations = findInvariantViolations(result.layout, surface, demoAd);
        if (result.layout.boxes.length >= 4) {
          if (result.layout.composition.balanceX < 0.7 || result.layout.composition.balanceY < 0.7) {
            violations.push(
              `composition is visibly edge-biased (balance ${result.layout.composition.balanceX.toFixed(3)}x${result.layout.composition.balanceY.toFixed(3)})`,
            );
          }
        }
        if (violations.length > 0) {
          invariantViolations.push(`surface ${JSON.stringify(surface)}:\n  ${violations.join("\n  ")}`);
        }
      } else {
        explicitFailures++;
        // must be a typed failure, not a thrown exception or empty message
        expect(["invalid-spec", "invalid-surface", "no-valid-layout"]).toContain(result.reason);
        expect(result.message.length).toBeGreaterThan(0);
      }
    }

    // eslint-disable-next-line no-console
    console.log(`fuzz: ${successes} resolved, ${explicitFailures} explicit failures, ${invariantViolations.length} invariant violations`);
    expect(invariantViolations, invariantViolations.slice(0, 5).join("\n\n")).toEqual([]);
    // sanity: the range (including the stress corner) should exercise both outcomes
    expect(successes).toBeGreaterThan(0);
    expect(explicitFailures).toBeGreaterThan(0);
  });

  it("never throws, even on extreme edges of the fuzzed range", () => {
    const edgeCases: SurfaceProfile[] = [
      { id: "min-both", width: 200, height: 120 },
      { id: "max-both", width: 1920, height: 1200 },
      { id: "min-width-max-height", width: 200, height: 1200 },
      { id: "max-width-min-height", width: 1920, height: 120 },
      { id: "huge-tap-target", width: 400, height: 400, minTapTarget: 500 },
      { id: "huge-text-size", width: 400, height: 400, minTextSize: 300 },
    ];
    for (const surface of edgeCases) {
      expect(() => resolveLayout(demoAd, surface)).not.toThrow();
    }
  });
});
