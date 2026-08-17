// DOM renderer. Paints a ResolvedLayout exactly as computed — it never
// inspects surface identity, never chooses a composition, never decides what
// disappears. Every geometric AND presentation decision already happened in
// the resolver; this file reads `box.presentation` (variant/visible/cropped/
// fontSize) directly off each ResolvedBox. It never scans degradation
// records to infer what's active — that would let rendering silently
// disagree with what the resolver actually decided.

import type { CSSProperties } from "react";
import type { AdElement, AdSpec, ResolvedBox, ResolvedLayout, SurfaceProfile } from "./types";
import { normalizeSurfaceProfile } from "./validate";
import { activeContentFor } from "./measure";

interface RenderedSurfaceProps {
  spec: AdSpec;
  layout: ResolvedLayout;
  surface: SurfaceProfile;
}

export function RenderedSurface({ spec, layout, surface }: RenderedSurfaceProps) {
  const normalized = normalizeSurfaceProfile(surface);
  const elementsById = new Map(spec.elements.map((el) => [el.id, el]));

  return (
    <div
      className="surface-canvas"
      data-surface-id={layout.surfaceId}
      data-strategy={layout.strategy}
      data-coverage-x={layout.composition.coverageX}
      data-coverage-y={layout.composition.coverageY}
      data-balance-x={layout.composition.balanceX}
      data-balance-y={layout.composition.balanceY}
      style={{
        width: normalized.width,
        height: normalized.height,
      }}
    >
      <div
        className="safe-area-outline"
        style={{
          left: normalized.safeArea.left,
          top: normalized.safeArea.top,
          right: normalized.safeArea.right,
          bottom: normalized.safeArea.bottom,
        }}
      />
      {layout.boxes.map((box) => {
        const element = elementsById.get(box.id);
        if (!element || !box.presentation.visible) return null;
        return <ElementBox key={box.id} box={box} element={element} />;
      })}
    </div>
  );
}

function ElementBox({ box, element }: { box: ResolvedBox; element: AdElement }) {
  const base: CSSProperties = {
    position: "absolute",
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    boxSizing: "border-box",
  };
  const { variant, cropped, fontSize } = box.presentation;

  if (element.type === "text") {
    const activeContent = activeContentFor(element, variant);
    return (
      <div
        className={`el-text el-role-${element.role}`}
        data-element-id={element.id}
        data-role={element.role}
        style={{ ...base, fontSize, lineHeight: `${box.height}px` }}
        title={element.content}
      >
        {activeContent}
      </div>
    );
  }

  if (element.type === "image" && element.role === "branding") {
    return (
      <div className="el-brandmark" data-element-id={element.id} data-role={element.role} style={{ ...base, fontSize }} title={element.alt}>
        <span>{element.alt}</span>
      </div>
    );
  }

  if (element.type === "image") {
    return (
      <div className={`el-image el-role-${element.role}`} data-element-id={element.id} data-role={element.role} style={base} title={element.alt}>
        <span>
          {element.alt}
          {cropped ? " — cropped" : ""}
        </span>
      </div>
    );
  }

  // button — the visible label is always its own accessible name now that
  // there's no icon-only collapse state to compensate for.
  const activeLabel = activeContentFor(element, variant);
  return (
    <button className="el-button" data-element-id={element.id} data-role={element.role} style={{ ...base, fontSize }}>
      {activeLabel}
    </button>
  );
}
