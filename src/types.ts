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
  /** shorter content variant, active once this element degrades to "compact".
   * Optional — an element without one has no compact rung and either stays full
   * or, if it can never fit, causes the layout to fail rather than being silently
   * truncated. */
  compactContent?: string;
}

export interface ImageElement extends BaseElement {
  type: "image";
  alt: string;
  /** preferred width / height, e.g. 1.5 for a landscape hero shot */
  aspectRatio?: number;
  /** tighter aspect ratio to switch to when heavily constrained — a declared
   * focal-point crop that keeps the subject framed instead of squeezing or
   * stretching the original ratio. Optional — an image without one only shrinks. */
  croppedAspectRatio?: number;
}

export interface ButtonElement extends BaseElement {
  type: "button";
  label: string;
  /** shorter label, active once this element degrades to "compact" */
  compactLabel?: string;
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
// Resolved output: pure geometry + presentation truth, fully typed, renderer-ready.
// ---------------------------------------------------------------------------

/** "full" = original content, "compact" = compactContent/compactLabel. Drives both
 * what measure.ts measures and what render-dom paints — a single source of truth
 * so the two can never disagree on which text is active. */
export type ContentVariant = "full" | "compact";

/** The renderer's entire view of "what should this element look like right now" —
 * read directly off the resolved box, never inferred by scanning degradation records. */
export interface ElementPresentation {
  variant: ContentVariant;
  visible: boolean;
  cropped: boolean;
  fontSize?: number;
}

export interface ResolvedBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  presentation: ElementPresentation;
}

export interface OmittedElement {
  id: string;
  reason: string;
}

export type DegradationAction =
  | "compact-spacing"
  | "compact"
  | "hide"
  | "shrink"
  | "crop"
  | "drop";

export interface DegradationRecord {
  id: string;
  action: DegradationAction;
  detail: string;
}

/** Renderer-independent composition diagnostics, normalized to the available rect. */
export interface CompositionMetrics {
  coverageX: number;
  coverageY: number;
  balanceX: number;
  balanceY: number;
  spacingConsistency: number;
}

/** One scored candidate produced during a resolution attempt — the typed form of
 * what used to only exist as a trace string, so the UI can render it directly. */
export interface CandidateDiagnostic {
  strategy: string;
  valid: boolean;
  score?: number;
  rejectionReasons?: string[];
}

/** One rung of the resolution ladder: every strategy tried at that rung, and
 * which (if any) won. */
export interface ResolutionAttempt {
  label: string;
  candidates: CandidateDiagnostic[];
  winnerStrategy?: string;
}

export interface ResolvedLayout {
  surfaceId: string;
  strategy: string;
  composition: CompositionMetrics;
  score: number;
  boxes: ResolvedBox[];
  omitted: OmittedElement[];
  degradations: DegradationRecord[];
  /** Every rung tried, in order, with typed per-candidate diagnostics. */
  attempts: ResolutionAttempt[];
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
  attempts: ResolutionAttempt[];
}

export type ResolveResult =
  | { ok: true; layout: ResolvedLayout }
  | ResolutionFailure;

// ---------------------------------------------------------------------------
// Continuity: optional hint so a live resize doesn't oscillate between two
// near-tied strategies or flicker content variants in and out. Purely additive —
// resolveLayout(spec, surface) without a hint behaves exactly as before.
// ---------------------------------------------------------------------------

export interface ContinuityHint {
  previousStrategy: string;
  previousContentVariantByRole?: Partial<Record<ElementRole, ContentVariant>>;
}

// ---------------------------------------------------------------------------
// Internal resolver pipeline types (measure → strategies → repair → validate → score).
// Not part of the public spec/output contract, but shared across those stages.
// ---------------------------------------------------------------------------

export interface ElementMeasurement {
  id: string;
  minWidth: number;
  minHeight: number;
  prefWidth: number;
  prefHeight: number;
}

export interface MeasuredElement {
  element: AdElement;
  measurement: ElementMeasurement;
  /** which content variant is currently active for this element */
  contentVariant: ContentVariant;
  /** true once the image's croppedAspectRatio has been applied by the ladder */
  cropped: boolean;
  /** true once this element's preferred size has been collapsed to its minimum */
  shrunk: boolean;
}

export interface LayoutCandidate {
  strategy: string;
  boxes: ResolvedBox[];
}

// ---------------------------------------------------------------------------
// Generic validation result, shared by spec/surface validation.
// ---------------------------------------------------------------------------

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };
