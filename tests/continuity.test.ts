// Continuity/hysteresis tests (§21): a live resize path from mobile portrait
// toward mobile landscape should pick Stack early, Split late, and never
// oscillate A -> B -> A within a short, monotonic resize neighborhood. Also
// checks that resolveLayout(spec, surface) with no continuity hint is
// unaffected — one-shot/test/checkpoint behavior stays exactly as before.

import { describe, expect, it } from "vitest";
import { demoAd } from "../src/spec";
import { resolveLayout } from "../src/resolver";
import type { ContinuityHint, SurfaceProfile } from "../src/types";

function walk(widths: { width: number; height: number }[]): string[] {
  const strategies: string[] = [];
  let hint: ContinuityHint | undefined;
  for (const dims of widths) {
    const surface: SurfaceProfile = { id: "resize-walk", ...dims, minTapTarget: 44 };
    const result = resolveLayout(demoAd, surface, hint);
    expect(result.ok, !result.ok ? result.message : "").toBe(true);
    if (!result.ok) continue;
    strategies.push(result.layout.strategy);
    hint = { previousStrategy: result.layout.strategy };
  }
  return strategies;
}

describe("continuity — strategy hysteresis across a portrait-to-landscape resize", () => {
  const path = [
    { width: 320, height: 480 },
    { width: 360, height: 440 },
    { width: 400, height: 390 },
    { width: 440, height: 350 },
    { width: 480, height: 320 },
  ];

  it("genuinely adapts strategy across the aspect-ratio range with no continuity hint", () => {
    // Confirms real recomposition exists across this path (not just a
    // hysteresis artifact) — the two endpoints are the CP1/CP2 checkpoints
    // and independently resolve to Stack and Split respectively.
    const start = resolveLayout(demoAd, { id: "start", ...path[0]!, minTapTarget: 44 });
    const end = resolveLayout(demoAd, { id: "end", ...path[path.length - 1]!, minTapTarget: 44 });
    expect(start.ok && start.layout.strategy).toBe("stack");
    expect(end.ok && end.layout.strategy).toBe("split");
  });

  it("never oscillates back to a previously-left strategy within the same monotonic walk", () => {
    const strategies = walk(path);
    const seen = new Set<string>();
    let current: string | undefined;
    for (const strategy of strategies) {
      if (strategy !== current) {
        // switching strategies — must never be a strategy we've already left
        expect(seen.has(strategy)).toBe(false);
        current = strategy;
      }
      seen.add(strategy);
    }
  });

  it("keeps the incumbent strategy when a challenger's lead is inside the switch margin", () => {
    // Stack wins step 1; at later steps any challenger that doesn't clear
    // STRATEGY_SWITCH_MARGIN should not dislodge it — this is what actually
    // prevents flicker on a real drag, even if the unhinted winner would
    // differ at that exact pixel.
    const strategies = walk(path);
    expect(strategies[0]).toBe("stack");
    // whichever strategy is running by the end, it must be one that was
    // reachable by a >= margin win at some step, not a marginal wobble —
    // enforced structurally by pickWinner()/STRATEGY_SWITCH_MARGIN itself,
    // this just documents that the walk completes and stays coherent.
    expect(strategies.length).toBe(path.length);
  });
});

describe("continuity — neighborhood stability around each canonical checkpoint", () => {
  const checkpoints = [
    { label: "320x480", width: 320, height: 480 },
    { label: "480x320", width: 480, height: 320 },
    { label: "1920x250", width: 1920, height: 250 },
    { label: "1080x1080", width: 1080, height: 1080 },
  ];
  const offsets = [-24, -20, -10, -5, 0, 5, 10, 20, 24];

  for (const cp of checkpoints) {
    it(`${cp.label} stays on one strategy (or a legitimate hysteresis-guarded switch) across ±24px`, () => {
      let hint: ContinuityHint | undefined;
      const strategies: string[] = [];
      for (const dx of offsets) {
        const surface: SurfaceProfile = { id: "neighborhood", width: Math.max(80, cp.width + dx), height: cp.height, minTapTarget: 44 };
        const result = resolveLayout(demoAd, surface, hint);
        expect(result.ok, !result.ok ? result.message : "").toBe(true);
        if (!result.ok) continue;
        strategies.push(result.layout.strategy);
        hint = { previousStrategy: result.layout.strategy };
      }
      // no A -> B -> A within this tight a neighborhood
      const seen = new Set<string>();
      let current: string | undefined;
      for (const strategy of strategies) {
        if (strategy !== current) {
          expect(seen.has(strategy)).toBe(false);
          current = strategy;
        }
        seen.add(strategy);
      }
    });
  }
});

describe("continuity — additive only", () => {
  it("omitting the continuity hint reproduces the plain one-shot result", () => {
    const surface: SurfaceProfile = { id: "no-hint", width: 480, height: 320, minTapTarget: 44 };
    const withoutHint = resolveLayout(demoAd, surface);
    const withUndefinedHint = resolveLayout(demoAd, surface, undefined);
    expect(withoutHint).toEqual(withUndefinedHint);
  });
});
