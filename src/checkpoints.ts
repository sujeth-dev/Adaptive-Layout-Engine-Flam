// The five canonical demo checkpoints. These are golden verification targets
// for tests/checkpoints.test.ts and the CheckpointGallery demo — never an
// input to the resolver. This file must never be imported by an engine file
// (types.ts, measure.ts, strategies.ts, repair.ts, validate.ts, score.ts,
// resolver.ts): the resolver only ever sees a SurfaceProfile, never a
// checkpoint id, so an arbitrary sixth surface goes through the exact same
// pipeline as these five.

import type { SurfaceProfile } from "./types";
import { broadcastLowerThird, constrainedStrip, mobileLandscape, mobilePortrait, retailKiosk } from "./surfaces";

export type CanonicalStrategyId = "stack" | "split" | "band" | "poster";

export interface Checkpoint {
  id: string;
  label: string;
  surface: SurfaceProfile;
  expectedStrategy: CanonicalStrategyId;
  expectedVariant: "full" | "compact";
}

export const CHECKPOINTS: Checkpoint[] = [
  { id: "cp1", label: "320×480 — Mobile Portrait", surface: mobilePortrait, expectedStrategy: "stack", expectedVariant: "full" },
  { id: "cp2", label: "480×320 — Mobile Landscape", surface: mobileLandscape, expectedStrategy: "split", expectedVariant: "full" },
  { id: "cp3", label: "1920×250 — Broadcast Lower-Third", surface: broadcastLowerThird, expectedStrategy: "band", expectedVariant: "full" },
  { id: "cp4", label: "1080×1080 — Square Kiosk", surface: retailKiosk, expectedStrategy: "poster", expectedVariant: "full" },
  { id: "cp5", label: "510×90 — Constrained Strip", surface: constrainedStrip, expectedStrategy: "band", expectedVariant: "full" },
];
