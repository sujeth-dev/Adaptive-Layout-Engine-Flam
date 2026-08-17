// Runtime validation + normalization.
//
// Types give us compile-time protection for specs/surfaces authored as TypeScript
// literals. But both can also arrive dynamically (JSON from a CMS, a live 5th
// surface typed in during an interview), so every field gets checked again here.

import type {
  AdSpec,
  AdElement,
  ElementMeasurement,
  LayoutCandidate,
  NormalizedSurfaceProfile,
  Rect,
  SafeArea,
  SurfaceProfile,
  ValidationResult,
} from "./types";
import { measureActiveContentWidth } from "./measure";

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(errors: string[]): ValidationResult<T> {
  return { ok: false, errors };
}

const isPositiveInt = (n: number) => Number.isInteger(n) && n > 0;
const isFiniteNonNegative = (n: number) => Number.isFinite(n) && n >= 0;

// ---------------------------------------------------------------------------
// Ad spec validation
// ---------------------------------------------------------------------------

function validateElement(el: AdElement, errors: string[]): void {
  if (!el.id || typeof el.id !== "string") {
    errors.push(`element has invalid id: ${JSON.stringify(el.id)}`);
  }
  if (!isPositiveInt(el.priority)) {
    errors.push(`element "${el.id}" priority must be a positive integer, got ${el.priority}`);
  }
  switch (el.type) {
    case "text":
      if (!el.content) errors.push(`text element "${el.id}" missing content`);
      break;
    case "image":
      if (!el.alt) errors.push(`image element "${el.id}" missing alt`);
      if (el.aspectRatio !== undefined && !(el.aspectRatio > 0)) {
        errors.push(`image element "${el.id}" aspectRatio must be > 0, got ${el.aspectRatio}`);
      }
      break;
    case "button":
      if (!el.label) errors.push(`button element "${el.id}" missing label`);
      break;
  }
}

export function validateAdSpec(spec: AdSpec): ValidationResult<AdSpec> {
  const errors: string[] = [];

  if (!spec.id) errors.push("adSpec missing id");
  if (!Array.isArray(spec.elements) || spec.elements.length === 0) {
    errors.push("adSpec must contain at least one element");
    return fail(errors);
  }

  const seenIds = new Set<string>();
  for (const el of spec.elements) {
    if (seenIds.has(el.id)) {
      errors.push(`duplicate element id: "${el.id}"`);
    }
    seenIds.add(el.id);
    validateElement(el, errors);
  }

  return errors.length > 0 ? fail(errors) : ok(spec);
}

// ---------------------------------------------------------------------------
// Surface profile validation + normalization
// ---------------------------------------------------------------------------

const DEFAULT_SAFE_AREA: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_MIN_TAP_TARGET = 0;
const DEFAULT_MIN_TEXT_SIZE = 12;
const DEFAULT_VIEWING_DISTANCE = "medium";

export function validateSurfaceProfile(surface: SurfaceProfile): ValidationResult<SurfaceProfile> {
  const errors: string[] = [];

  if (!surface.id) errors.push("surface missing id");
  if (!Number.isFinite(surface.width) || surface.width <= 0) {
    errors.push(`surface "${surface.id}" width must be > 0, got ${surface.width}`);
  }
  if (!Number.isFinite(surface.height) || surface.height <= 0) {
    errors.push(`surface "${surface.id}" height must be > 0, got ${surface.height}`);
  }

  if (surface.safeArea) {
    const { top, right, bottom, left } = surface.safeArea;
    for (const [name, val] of Object.entries({ top, right, bottom, left })) {
      if (!isFiniteNonNegative(val)) {
        errors.push(`surface "${surface.id}" safeArea.${name} must be >= 0, got ${val}`);
      }
    }
    if (Number.isFinite(surface.width) && left + right >= surface.width) {
      errors.push(`surface "${surface.id}" safeArea left+right (${left + right}) leaves no usable width (${surface.width})`);
    }
    if (Number.isFinite(surface.height) && top + bottom >= surface.height) {
      errors.push(`surface "${surface.id}" safeArea top+bottom (${top + bottom}) leaves no usable height (${surface.height})`);
    }
  }

  if (surface.minTapTarget !== undefined && !isFiniteNonNegative(surface.minTapTarget)) {
    errors.push(`surface "${surface.id}" minTapTarget must be >= 0, got ${surface.minTapTarget}`);
  }
  if (surface.minTextSize !== undefined && !isFiniteNonNegative(surface.minTextSize)) {
    errors.push(`surface "${surface.id}" minTextSize must be >= 0, got ${surface.minTextSize}`);
  }

  return errors.length > 0 ? fail(errors) : ok(surface);
}

/** Fills every optional constraint with an explicit default. Assumes the surface already passed validateSurfaceProfile. */
export function normalizeSurfaceProfile(surface: SurfaceProfile): NormalizedSurfaceProfile {
  return {
    id: surface.id,
    width: surface.width,
    height: surface.height,
    safeArea: surface.safeArea ?? { ...DEFAULT_SAFE_AREA },
    minTapTarget: surface.minTapTarget ?? DEFAULT_MIN_TAP_TARGET,
    minTextSize: surface.minTextSize ?? DEFAULT_MIN_TEXT_SIZE,
    viewingDistance: surface.viewingDistance ?? DEFAULT_VIEWING_DISTANCE,
    touchOnly: surface.touchOnly ?? false,
  };
}

// ---------------------------------------------------------------------------
// Candidate (resolved geometry) hard validation.
//
// This is where "never overlap or clip", "respect min text size", and
// "respect tap target" are actually enforced. A candidate that fails any of
// these is rejected outright — never silently repaired.
// ---------------------------------------------------------------------------

const EPS = 1e-6;

export interface CandidateValidation {
  valid: boolean;
  reasons: string[];
}

export function validateCandidate(
  candidate: LayoutCandidate,
  measuredById: Map<string, ElementMeasurement>,
  elementsById: Map<string, AdElement>,
  surface: NormalizedSurfaceProfile,
  rect: Rect,
): CandidateValidation {
  const reasons: string[] = [];

  for (const box of candidate.boxes) {
    if (box.width <= 0 || box.height <= 0) {
      reasons.push(`"${box.id}" has non-positive geometry (${box.width}x${box.height})`);
      continue;
    }

    if (
      box.x < rect.x - EPS ||
      box.y < rect.y - EPS ||
      box.x + box.width > rect.x + rect.width + EPS ||
      box.y + box.height > rect.y + rect.height + EPS
    ) {
      reasons.push(`"${box.id}" falls outside the safe-area bounds`);
    }

    const measurement = measuredById.get(box.id);
    if (measurement) {
      if (box.width < measurement.minWidth - EPS) {
        reasons.push(`"${box.id}" width ${box.width.toFixed(1)}px is below its minimum ${measurement.minWidth.toFixed(1)}px`);
      }
      if (box.height < measurement.minHeight - EPS) {
        reasons.push(`"${box.id}" height ${box.height.toFixed(1)}px is below its minimum ${measurement.minHeight.toFixed(1)}px`);
      }
    }

    const element = elementsById.get(box.id);
    if (element?.type === "button" && surface.minTapTarget > 0) {
      if (box.width < surface.minTapTarget - EPS || box.height < surface.minTapTarget - EPS) {
        reasons.push(
          `"${box.id}" (${box.width.toFixed(1)}x${box.height.toFixed(1)}) violates minTapTarget=${surface.minTapTarget}`,
        );
      }
    }

    // Resolved font floor + genuine fit — no silent renderer ellipsis. Only
    // text/button elements carry a resolved fontSize; anything else skips this.
    if (element && (element.type === "text" || element.type === "button")) {
      const fontSize = box.presentation.fontSize;
      if (fontSize === undefined) {
        reasons.push(`"${box.id}" is missing a resolved fontSize`);
      } else {
        if (fontSize < surface.minTextSize - EPS) {
          reasons.push(`"${box.id}" resolved fontSize ${fontSize.toFixed(1)}px is below minTextSize ${surface.minTextSize}`);
        }
        const activeWidth = measureActiveContentWidth(element, box.presentation.variant, fontSize);
        const horizontalBudget = element.type === "button" ? box.width - 32 : box.width;
        if (activeWidth > horizontalBudget + EPS) {
          reasons.push(`"${box.id}" active "${box.presentation.variant}" content does not fit its resolved box`);
        }
      }
    }

    // Hero aspect/crop rules — geometry may shrink, the image never stretches
    // or squashes: the resolved box's aspect ratio must match whichever
    // declared aspect (original or cropped) is currently active.
    if (element?.type === "image" && element.role === "hero") {
      const useCropped = box.presentation.cropped && element.croppedAspectRatio && element.croppedAspectRatio > 0;
      const expectedAspect = useCropped
        ? element.croppedAspectRatio!
        : element.aspectRatio && element.aspectRatio > 0
          ? element.aspectRatio
          : 1;
      const actualAspect = box.width / box.height;
      if (Math.abs(actualAspect - expectedAspect) / expectedAspect > 0.02) {
        reasons.push(`"${box.id}" aspect ratio ${actualAspect.toFixed(3)} does not match declared ${expectedAspect.toFixed(3)}`);
      }
    }
  }

  for (let i = 0; i < candidate.boxes.length; i++) {
    for (let j = i + 1; j < candidate.boxes.length; j++) {
      const a = candidate.boxes[i]!;
      const b = candidate.boxes[j]!;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX > EPS && overlapY > EPS) {
        // Brand vs. hero/headline is called out by name in the spec, but it's
        // the exact same AABB rule as every other pair — no separate check
        // needed, this generic pairwise pass already forbids it.
        reasons.push(`"${a.id}" overlaps "${b.id}"`);
      }
    }
  }

  return { valid: reasons.length === 0, reasons };
}
