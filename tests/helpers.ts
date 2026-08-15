// Shared invariant checker used by both the targeted resolver tests and the
// fuzz suite. findInvariantViolations returns a list of plain-English
// problems (empty = clean) so fuzz can keep going across hundreds of random
// surfaces instead of stopping at the first failure.

import { expect } from "vitest";
import { measureElement } from "../src/measure";
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

  const rect = { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
  for (const el of spec.elements) {
    const box = layout.boxes.find((b) => b.id === el.id);
    if (!box) continue; // omitted, checked separately below
    const measurement = measureElement(el, normalized, rect);
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
  }

  const priorityOneIds = spec.elements.filter((e) => e.priority === 1).map((e) => e.id);
  for (const id of priorityOneIds) {
    if (layout.omitted.some((o) => o.id === id)) violations.push(`priority-1 element "${id}" was omitted`);
    if (!layout.boxes.some((b) => b.id === id)) violations.push(`priority-1 element "${id}" missing from boxes`);
  }

  return violations;
}

export function assertInvariants(layout: ResolvedLayout, surface: SurfaceProfile, spec: AdSpec) {
  const violations = findInvariantViolations(layout, surface, spec);
  expect(violations, violations.join("\n")).toEqual([]);
}
