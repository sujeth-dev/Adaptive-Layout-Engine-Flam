// Fuzz testing: hundreds of arbitrary surface profiles, none hand-picked.
// For every successful resolution, every hard invariant must hold. For every
// failure, it must be a typed ResolutionFailure, never a thrown exception or
// broken geometry. A seeded PRNG keeps a failing run reproducible. Per §20,
// biased toward tight / ultra-wide / ultra-tall / large-safe-area / high-
// floor corners — never toward a specific expected strategy, which stays an
// emergent property of scoring, not something fuzz should assert on.

import { describe, expect, it } from "vitest";
import { demoAd } from "../src/spec";
import { resolveLayout } from "../src/resolver";
import { findInvariantViolations } from "./helpers";
import type { SurfaceProfile, ViewingDistance } from "../src/types";

const RUNS = 1000;
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

type StressBias = "none" | "tight" | "ultraWide" | "ultraTall" | "largeSafeArea" | "highFloors";

function pickBias(rand: () => number): StressBias {
  const r = rand();
  if (r < 0.6) return "none";
  if (r < 0.7) return "tight";
  if (r < 0.8) return "ultraWide";
  if (r < 0.88) return "ultraTall";
  if (r < 0.94) return "largeSafeArea";
  return "highFloors";
}

function randomSurface(rand: () => number, index: number): SurfaceProfile {
  const bias = pickBias(rand);
  const viewingDistances: ViewingDistance[] = ["close", "medium", "far"];

  let width: number;
  let height: number;
  switch (bias) {
    case "tight":
      width = randInt(rand, 80, 360);
      height = randInt(rand, 80, 220);
      break;
    case "ultraWide":
      width = randInt(rand, 1400, 2200);
      height = randInt(rand, 80, 200);
      break;
    case "ultraTall":
      width = randInt(rand, 80, 200);
      height = randInt(rand, 1000, 1400);
      break;
    default:
      width = randInt(rand, 80, 2200);
      height = randInt(rand, 80, 1400);
  }

  const surface: SurfaceProfile = { id: `fuzz-${index}`, width, height };

  const wantSafeArea = bias === "largeSafeArea" || rand() < 0.5;
  if (wantSafeArea) {
    const frac = bias === "largeSafeArea" ? 0.35 : 0.15;
    surface.safeArea = {
      top: randInt(rand, 0, Math.floor(height * frac)),
      bottom: randInt(rand, 0, Math.floor(height * frac)),
      left: randInt(rand, 0, Math.floor(width * frac)),
      right: randInt(rand, 0, Math.floor(width * frac)),
    };
  }

  const wantHighFloors = bias === "highFloors";
  if (wantHighFloors || rand() < 0.6) surface.minTapTarget = randInt(rand, 0, wantHighFloors ? 120 : 72);
  if (wantHighFloors || rand() < 0.6) surface.minTextSize = randInt(rand, 0, wantHighFloors ? 64 : 40);
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
    // sanity: the range (including every stress corner) should exercise both outcomes
    expect(successes).toBeGreaterThan(0);
    expect(explicitFailures).toBeGreaterThan(0);
  });

  it("never throws, even on extreme edges of the fuzzed range", () => {
    const edgeCases: SurfaceProfile[] = [
      { id: "min-both", width: 80, height: 80 },
      { id: "max-both", width: 2200, height: 1400 },
      { id: "min-width-max-height", width: 80, height: 1400 },
      { id: "max-width-min-height", width: 2200, height: 80 },
      { id: "huge-tap-target", width: 400, height: 400, minTapTarget: 500 },
      { id: "huge-text-size", width: 400, height: 400, minTextSize: 300 },
      { id: "invalid-safe-area", width: 400, height: 400, safeArea: { top: 500, right: 0, bottom: 0, left: 0 } },
      { id: "impossible", width: 90, height: 80, minTapTarget: 44, minTextSize: 18 },
    ];
    for (const surface of edgeCases) {
      expect(() => resolveLayout(demoAd, surface)).not.toThrow();
    }
  });
});
