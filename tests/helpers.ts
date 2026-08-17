// Shared invariant checker used by targeted resolver tests, checkpoint tests,
// and the fuzz suite. findInvariantViolations returns a list of plain-English
// problems (empty = clean) so fuzz can keep going across hundreds of random
// surfaces instead of stopping at the first failure.

import { expect } from "vitest";
import { measureActiveContentWidth, measureElement } from "../src/measure";
import { evaluateComposition } from "../src/score";
import { normalizeSurfaceProfile } from "../src/validate";
import type { AdSpec, ResolvedLayout, SurfaceProfile } from "../src/types";

export function findInvariantViolations(layout: ResolvedLayout, surface: SurfaceProfile, spec: AdSpec): string[] {
  const violations: string[] = [];
  const normalized = normalizeSurfaceProfile(surface);
  const bounds = {
    left: normalized.safeArea.left,
    top: normalized.safeArea.top,
    right: normalized.width - normalized.safeArea.right,
    bottom: normalized.height - normalized.safeArea.bottom,
  };
  const rect = { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };

  for (const box of layout.boxes) {
    if (box.width <= 0 || box.height <= 0) {
      violations.push(`${box.id}: non-positive geometry (${box.width}x${box.height})`);
    }
    if (
      box.x < bounds.left - 0.01 ||
      box.y < bounds.top - 0.01 ||
      box.x + box.width > bounds.right + 0.01 ||
      box.y + box.height > bounds.bottom + 0.01
    ) {
      violations.push(`${box.id}: falls outside safe-area bounds`);
    }
  }

  for (let i = 0; i < layout.boxes.length; i++) {
    for (let j = i + 1; j < layout.boxes.length; j++) {
      const a = layout.boxes[i]!;
      const b = layout.boxes[j]!;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX > 0.01 && overlapY > 0.01) {
        violations.push(`${a.id} overlaps ${b.id}`);
      }
    }
  }

  const recomputedComposition = evaluateComposition(
    { strategy: layout.strategy, presentation: layout.presentation, boxes: layout.boxes },
    rect,
  );
  for (const key of ["coverageX", "coverageY", "balanceX", "balanceY", "spacingConsistency"] as const) {
    if (Math.abs(layout.composition[key] - recomputedComposition[key]) > 0.000001) {
      violations.push(`composition.${key} does not match resolved geometry`);
    }
    if (!Number.isFinite(layout.composition[key]) || layout.composition[key] < 0 || layout.composition[key] > 1) {
      violations.push(`composition.${key} must be normalized, got ${layout.composition[key]}`);
    }
  }

  const elementsById = new Map(spec.elements.map((el) => [el.id, el]));
  const brandBox = layout.boxes.find((b) => elementsById.get(b.id)?.role === "branding");
  const heroBox = layout.boxes.find((b) => elementsById.get(b.id)?.role === "hero");
  const headlineBox = layout.boxes.find((b) => elementsById.get(b.id)?.role === "primary");
  function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return overlapX > 0.01 && overlapY > 0.01;
  }
  if (brandBox && heroBox && overlaps(brandBox, heroBox)) violations.push(`brand overlaps hero`);
  if (brandBox && headlineBox && overlaps(brandBox, headlineBox)) violations.push(`brand overlaps headline`);

  for (const el of spec.elements) {
    const box = layout.boxes.find((b) => b.id === el.id);
    if (!box) continue; // omitted/hidden/dropped, checked separately below

    const variant = box.presentation.variant;
    const cropped = box.presentation.cropped;
    const measurement = measureElement(el, normalized, rect, variant, cropped);

    if (box.width < measurement.minWidth - 0.5) {
      violations.push(`${el.id}: width ${box.width.toFixed(1)} below floor ${measurement.minWidth.toFixed(1)}`);
    }
    if (box.height < measurement.minHeight - 0.5) {
      violations.push(`${el.id}: height ${box.height.toFixed(1)} below floor ${measurement.minHeight.toFixed(1)}`);
    }
    if (el.type === "button" && normalized.minTapTarget > 0) {
      if (box.width < normalized.minTapTarget - 0.5 || box.height < normalized.minTapTarget - 0.5) {
        violations.push(`${el.id}: violates minTapTarget=${normalized.minTapTarget}`);
      }
    }

    // Resolved font floor + genuine fit: text/button elements must carry a resolved
    // fontSize at or above the surface's floor, and their active content must
    // actually fit the box at that exact font size — no silent renderer ellipsis.
    if (el.type === "text" || el.type === "button") {
      const fontSize = box.presentation.fontSize;
      if (fontSize === undefined) {
        violations.push(`${el.id}: missing resolved fontSize`);
      } else {
        if (fontSize < normalized.minTextSize - 0.01) {
          violations.push(`${el.id}: resolved fontSize ${fontSize.toFixed(1)} below minTextSize ${normalized.minTextSize}`);
        }
        const activeWidth = measureActiveContentWidth(el, variant, fontSize);
        const horizontalBudget = el.type === "button" ? box.width - 32 : box.width;
        if (activeWidth > horizontalBudget + 1) {
          violations.push(`${el.id}: active "${variant}" content (${activeWidth.toFixed(1)}px) does not fit its box (${horizontalBudget.toFixed(1)}px)`);
        }
      }
    }

    // Hero aspect/crop validity: the resolved box's aspect ratio must match the
    // declared aspect for whichever state (original/cropped) is presently active —
    // geometry may change, but the hero is never stretched or squashed. Branding
    // is intentionally NOT aspect-locked — it's sized as a compact wordmark box,
    // not a strictly proportional image (matches validate.ts's hard check scope).
    if (el.type === "image" && el.role === "hero") {
      const useCropped = cropped && el.croppedAspectRatio && el.croppedAspectRatio > 0;
      const expectedAspect = useCropped ? el.croppedAspectRatio! : el.aspectRatio && el.aspectRatio > 0 ? el.aspectRatio : 1;
      const actualAspect = box.width / box.height;
      if (Math.abs(actualAspect - expectedAspect) / expectedAspect > 0.02) {
        violations.push(`${el.id}: aspect ratio ${actualAspect.toFixed(3)} does not match declared ${expectedAspect.toFixed(3)}`);
      }
    }
  }

  const priorityOneIds = spec.elements.filter((e) => e.priority === 1).map((e) => e.id);
  for (const id of priorityOneIds) {
    if (layout.omitted.some((o) => o.id === id)) violations.push(`priority-1 element "${id}" was omitted`);
    if (!layout.boxes.some((b) => b.id === id)) violations.push(`priority-1 element "${id}" missing from boxes`);
  }

  const ctaSpec = spec.elements.find((e) => e.role === "action");
  if (ctaSpec) {
    if (layout.omitted.some((o) => o.id === ctaSpec.id)) violations.push(`CTA "${ctaSpec.id}" was omitted — CTA must never drop`);
  }

  return violations;
}

export function assertInvariants(layout: ResolvedLayout, surface: SurfaceProfile, spec: AdSpec) {
  const violations = findInvariantViolations(layout, surface, spec);
  expect(violations, violations.join("\n")).toEqual([]);
}
