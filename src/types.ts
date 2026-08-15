// Core type model for the Adaptive Layout Engine.
// This file has zero dependency on React — the resolver must stay framework-agnostic.

// ---------------------------------------------------------------------------
// Ad spec: content + intent, no geometry.
// ---------------------------------------------------------------------------

export type ElementType = "text" | "image" | "button";

export type ElementRole = "primary" | "hero" | "action" | "secondary" | "branding";

/** 1 = highest priority. Must be a positive integer — enforced at runtime, see validate.ts. */
export type Priority = number;

interface BaseElement {
  id: string;
  role: ElementRole;
  priority: Priority;
}

export interface TextElement extends BaseElement {
  type: "text";
  content: string;
}

export interface ImageElement extends BaseElement {
  type: "image";
  alt: string;
  /** preferred width / height, e.g. 1.5 for a landscape hero shot */
  aspectRatio?: number;
}

export interface ButtonElement extends BaseElement {
  type: "button";
  label: string;
}

export type AdElement = TextElement | ImageElement | ButtonElement;

export interface AdSpec {
  id: string;
  elements: AdElement[];
}

// ---------------------------------------------------------------------------
// Surface profile: geometry + hard constraints, no layout.
// ---------------------------------------------------------------------------

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type ViewingDistance = "close" | "medium" | "far";

/** As authored — optional fields are filled in by normalizeSurfaceProfile(). */
export interface SurfaceProfile {
  id: string;
  width: number;
  height: number;
  safeArea?: SafeArea;
  minTapTarget?: number;
  minTextSize?: number;
  viewingDistance?: ViewingDistance;
  touchOnly?: boolean;
}

/** Every optional constraint resolved to an explicit value. This is what the resolver consumes. */
export interface NormalizedSurfaceProfile {
  id: string;
  width: number;
  height: number;
  safeArea: SafeArea;
  minTapTarget: number;
  minTextSize: number;
  viewingDistance: ViewingDistance;
  touchOnly: boolean;
}

// ---------------------------------------------------------------------------
// Resolved output: pure geometry, fully typed, renderer-ready.
// ---------------------------------------------------------------------------

export interface ResolvedBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OmittedElement {
  id: string;
  reason: string;
}

export type DegradationAction = "shrink" | "truncate" | "reposition" | "drop";

export interface DegradationRecord {
  id: string;
  action: DegradationAction;
  detail: string;
}

export interface ResolvedLayout {
  surfaceId: string;
  strategy: string;
  score: number;
  boxes: ResolvedBox[];
  omitted: OmittedElement[];
  degradations: DegradationRecord[];
  /** Human-readable resolution trace for debugging/demo purposes. */
  trace: string[];
}

export type ResolutionFailureReason =
  | "invalid-spec"
  | "invalid-surface"
  | "no-valid-layout";

export interface ResolutionFailure {
  ok: false;
  reason: ResolutionFailureReason;
  message: string;
  details: string[];
}

export type ResolveResult =
  | { ok: true; layout: ResolvedLayout }
  | ResolutionFailure;

// ---------------------------------------------------------------------------
// Generic validation result, shared by spec/surface validation.
// ---------------------------------------------------------------------------

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };
