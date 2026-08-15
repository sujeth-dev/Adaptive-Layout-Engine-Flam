import { describe, expect, it } from "vitest";
import { demoAd } from "../src/spec";
import { requiredSurfaces, mobilePortrait } from "../src/surfaces";
import {
  normalizeSurfaceProfile,
  validateAdSpec,
  validateSurfaceProfile,
} from "../src/validate";
import type { AdSpec, SurfaceProfile } from "../src/types";

describe("validateAdSpec", () => {
  it("accepts the demo ad", () => {
    const result = validateAdSpec(demoAd);
    expect(result.ok).toBe(true);
  });

  it("rejects an empty elements array", () => {
    const spec: AdSpec = { id: "empty", elements: [] };
    const result = validateAdSpec(spec);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate element ids", () => {
    const spec: AdSpec = {
      id: "dup",
      elements: [
        { id: "a", type: "text", role: "primary", priority: 1, content: "x" },
        { id: "a", type: "text", role: "secondary", priority: 2, content: "y" },
      ],
    };
    const result = validateAdSpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/duplicate/i);
  });

  it("rejects non-positive-integer priority", () => {
    const spec: AdSpec = {
      id: "bad-priority",
      elements: [
        { id: "a", type: "text", role: "primary", priority: 0, content: "x" },
      ],
    };
    const result = validateAdSpec(spec);
    expect(result.ok).toBe(false);
  });

  it("rejects a fractional priority", () => {
    const spec: AdSpec = {
      id: "bad-priority-2",
      elements: [
        { id: "a", type: "text", role: "primary", priority: 1.5, content: "x" },
      ],
    };
    const result = validateAdSpec(spec);
    expect(result.ok).toBe(false);
  });

  it("rejects a text element with no content", () => {
    const spec: AdSpec = {
      id: "bad-text",
      elements: [
        { id: "a", type: "text", role: "primary", priority: 1, content: "" },
      ],
    };
    const result = validateAdSpec(spec);
    expect(result.ok).toBe(false);
  });
});

describe("validateSurfaceProfile", () => {
  it("accepts all four required surfaces", () => {
    for (const surface of requiredSurfaces) {
      const result = validateSurfaceProfile(surface);
      expect(result.ok, `${surface.id}: ${!result.ok ? result.errors.join(", ") : ""}`).toBe(true);
    }
  });

  it("rejects non-positive width", () => {
    const surface: SurfaceProfile = { id: "bad", width: 0, height: 100 };
    const result = validateSurfaceProfile(surface);
    expect(result.ok).toBe(false);
  });

  it("rejects non-positive height", () => {
    const surface: SurfaceProfile = { id: "bad", width: 100, height: -10 };
    const result = validateSurfaceProfile(surface);
    expect(result.ok).toBe(false);
  });

  it("rejects negative safe area values", () => {
    const surface: SurfaceProfile = {
      id: "bad",
      width: 400,
      height: 400,
      safeArea: { top: -1, right: 0, bottom: 0, left: 0 },
    };
    const result = validateSurfaceProfile(surface);
    expect(result.ok).toBe(false);
  });

  it("rejects a safe area larger than the surface", () => {
    const surface: SurfaceProfile = {
      id: "bad",
      width: 100,
      height: 100,
      safeArea: { top: 0, right: 60, bottom: 0, left: 60 },
    };
    const result = validateSurfaceProfile(surface);
    expect(result.ok).toBe(false);
  });

  it("rejects a negative minTapTarget", () => {
    const surface: SurfaceProfile = { id: "bad", width: 100, height: 100, minTapTarget: -5 };
    const result = validateSurfaceProfile(surface);
    expect(result.ok).toBe(false);
  });
});

describe("normalizeSurfaceProfile", () => {
  it("fills in defaults for a minimal surface", () => {
    const normalized = normalizeSurfaceProfile({ id: "minimal", width: 500, height: 500 });
    expect(normalized.safeArea).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(normalized.minTapTarget).toBe(0);
    expect(normalized.minTextSize).toBe(12);
    expect(normalized.viewingDistance).toBe("medium");
    expect(normalized.touchOnly).toBe(false);
  });

  it("preserves explicit values instead of overwriting with defaults", () => {
    const normalized = normalizeSurfaceProfile(mobilePortrait);
    expect(normalized.minTapTarget).toBe(44);
    expect(normalized.safeArea).toEqual({ top: 16, right: 12, bottom: 16, left: 12 });
  });
});
