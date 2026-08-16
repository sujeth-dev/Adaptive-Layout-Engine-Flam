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
  /** shorter content variant, tried before the existing truncate-to-ellipsis rung
   * degrades this same element further. Optional — an element without one just goes
   * straight to truncation, exactly like before this field existed. */
  shortContent?: string;
}

export interface ImageElement extends BaseElement {
  type: "image";
  alt: string;
  /** preferred width / height, e.g. 1.5 for a landscape hero shot */
  aspectRatio?: number;
  /** tighter aspect ratio to switch to when heavily constrained — a focal-point
   * crop that keeps the subject framed instead of squeezing the original ratio
   * into a sliver. Optional — an image without one only ever shrinks, as before. */
  croppedAspectRatio?: number;
}

export interface ButtonElement extends BaseElement {
  type: "button";
  label: string;
  /** shorter label, tried before collapsing to icon-only */
  shortLabel?: string;
  /** icon-only glyph; rendering this state keeps `label` as the accessible name */
  icon?: string;
}

export type AdElement = TextElement | ImageElement | ButtonElement;

/** Declarative cross-element merge: when a surface is tight enough that both
 * `sourceIds` and `targetId` are being degraded, try removing `sourceIds` from the
 * pool and swapping `targetId`'s rendered content for `mergedLabel` instead of
 * degrading them independently. Fully generic — the resolver never references
 * specific element ids, only whatever a spec declares here. */
export interface ElementMerge {
  sourceIds: string[];
  targetId: string;
  mergedLabel: string;
}

export interface AdSpec {
  id: string;
  elements: AdElement[];
  merges?: ElementMerge[];
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

/** Axis-aligned rectangle, used for the available layout area and every resolved box. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
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

export type DegradationAction =
  | "shrink"
  | "truncate"
  | "reposition"
  | "drop"
  | "shorten"
  | "iconify"
  | "crop"
  | "merge"
  | "compact-spacing";

export interface DegradationRecord {
  id: string;
  action: DegradationAction;
  detail: string;
  /** action:"merge" only — the new content the target box renders (e.g. "Buy $30") */
  mergedContent?: string;
}

/** Presentation density is a non-destructive candidate choice, never a degradation. */
export type PresentationVariant = "natural" | "frame-fill";

/** Renderer-independent composition diagnostics, normalized to the available rect. */
export interface CompositionMetrics {
  coverageX: number;
  coverageY: number;
  balanceX: number;
  balanceY: number;
  spacingConsistency: number;
}

export interface ResolvedLayout {
  surfaceId: string;
  strategy: string;
  presentation: PresentationVariant;
  composition: CompositionMetrics;
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
// Internal resolver pipeline types (measure → strategies → validate → score).
// Not part of the public spec/output contract, but shared across those stages.
// ---------------------------------------------------------------------------

export interface ElementMeasurement {
  id: string;
  minWidth: number;
  minHeight: number;
  prefWidth: number;
  prefHeight: number;
}

/** "full" = original content, "short" = shortContent/shortLabel, "icon" = icon-only
 * (buttons only). Drives both what measure.ts measures and what render-dom paints —
 * a single source of truth so the two can never disagree on which text is active. */
export type ContentVariant = "full" | "short" | "icon";

export interface MeasuredElement {
  element: AdElement;
  measurement: ElementMeasurement;
  /** true once truncation has been applied by the degradation ladder */
  truncated: boolean;
  /** which content variant is currently active for this element */
  contentVariant: ContentVariant;
  /** true once the image's croppedAspectRatio has been applied by the ladder */
  cropped: boolean;
  /** true once this element's preferred size has been collapsed to its minimum */
  shrunk: boolean;
}

export interface LayoutCandidate {
  strategy: string;
  presentation: PresentationVariant;
  boxes: ResolvedBox[];
}

// ---------------------------------------------------------------------------
// Generic validation result, shared by spec/surface validation.
// ---------------------------------------------------------------------------

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };
