import type { SurfaceProfile } from "./types";

// These four are the required demo presets. Their ids exist only for the
// picker UI / labels / tests — the resolver must never branch on them.

export const mobilePortrait: SurfaceProfile = {
  id: "mobilePortrait",
  width: 320,
  height: 480,
  safeArea: { top: 16, right: 12, bottom: 16, left: 12 },
  minTapTarget: 44,
};

export const mobileLandscape: SurfaceProfile = {
  id: "mobileLandscape",
  width: 480,
  height: 320,
  safeArea: { top: 12, right: 16, bottom: 12, left: 16 },
  minTapTarget: 44,
};

export const broadcastLowerThird: SurfaceProfile = {
  id: "broadcastLowerThird",
  width: 1920,
  height: 250,
  viewingDistance: "far",
  minTextSize: 32,
};

export const retailKiosk: SurfaceProfile = {
  id: "retailKiosk",
  width: 1080,
  height: 1080,
  minTapTarget: 60,
  minTextSize: 20,
  touchOnly: true,
};

/** The fifth canonical checkpoint — tight enough that the compact-content and
 * brand-hide rungs of the degradation ladder are required, not optional. Still
 * a plain SurfaceProfile; the resolver never branches on its id. */
export const constrainedStrip: SurfaceProfile = {
  id: "constrainedStrip",
  width: 510,
  height: 90,
  minTapTarget: 44,
  minTextSize: 12,
};

export const requiredSurfaces: SurfaceProfile[] = [
  mobilePortrait,
  mobileLandscape,
  broadcastLowerThird,
  retailKiosk,
];

/** The five golden checkpoints used by src/checkpoints.ts and the demo gallery. */
export const canonicalDemoSurfaces: SurfaceProfile[] = [...requiredSurfaces, constrainedStrip];

/** Helper for building a custom/unknown surface at runtime (demo controls, live interview 5th surface). */
export function customSurface(input: SurfaceProfile): SurfaceProfile {
  return input;
}
