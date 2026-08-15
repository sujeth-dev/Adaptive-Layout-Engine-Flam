// DOM renderer. Paints a ResolvedLayout exactly as computed — it never
// inspects surface identity, never chooses a composition, never decides what
// disappears. Every geometric decision already happened in the resolver;
// this file only maps a ResolvedBox + AdElement pair to CSS.

import type { CSSProperties } from "react";
import type { AdElement, AdSpec, ResolvedBox, ResolvedLayout, SurfaceProfile } from "./types";
import { normalizeSurfaceProfile } from "./validate";

interface RenderedSurfaceProps {
  spec: AdSpec;
  layout: ResolvedLayout;
  surface: SurfaceProfile;
}

export function RenderedSurface({ spec, layout, surface }: RenderedSurfaceProps) {
  const normalized = normalizeSurfaceProfile(surface);
  const elementsById = new Map(spec.elements.map((el) => [el.id, el]));
  const truncatedIds = new Set(layout.degradations.filter((d) => d.action === "truncate").map((d) => d.id));

  return (
    <div
      className="surface-canvas"
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
        if (!element) return null;
        return <ElementBox key={box.id} box={box} element={element} truncated={truncatedIds.has(box.id)} />;
      })}
    </div>
  );
}

function ElementBox({ box, element, truncated }: { box: ResolvedBox; element: AdElement; truncated: boolean }) {
  const base: CSSProperties = {
    position: "absolute",
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    boxSizing: "border-box",
  };

  if (element.type === "text") {
    const fontSize = Math.max(8, box.height / 1.35);
    return (
      <div
        className={`el-text el-role-${element.role}`}
        style={{ ...base, fontSize, lineHeight: `${box.height}px` }}
        title={element.content}
      >
        {element.content}
        {truncated ? "…" : ""}
      </div>
    );
  }

  if (element.type === "image" && element.role === "branding") {
    const fontSize = Math.max(8, Math.min(box.width, box.height) * 0.22);
    return (
      <div className="el-brandmark" style={{ ...base, fontSize }} title={element.alt}>
        <span>{element.alt}</span>
      </div>
    );
  }

  if (element.type === "image") {
    return (
      <div className={`el-image el-role-${element.role}`} style={base}>
        <span>{element.alt}</span>
      </div>
    );
  }

  return (
    <button className="el-button" style={{ ...base, fontSize: Math.max(10, box.height * 0.4) }}>
      {element.label}
    </button>
  );
}
