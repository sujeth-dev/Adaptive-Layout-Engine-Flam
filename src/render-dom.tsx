// DOM renderer. Paints a ResolvedLayout exactly as computed — it never
// inspects surface identity, never chooses a composition, never decides what
// disappears. Every geometric decision already happened in the resolver;
// this file only maps a ResolvedBox + AdElement pair to CSS, and reads the
// resolver's own degradation records to know which content variant (full,
// shortened, icon-only, cropped, merged) is active — never inferring it
// independently, so rendering can never silently disagree with what the
// resolver actually decided.

import type { CSSProperties } from "react";
import type { AdElement, AdSpec, DegradationRecord, NormalizedSurfaceProfile, ResolvedBox, ResolvedLayout, SurfaceProfile } from "./types";
import { normalizeSurfaceProfile } from "./validate";
import { buttonFontSize } from "./measure";

interface RenderedSurfaceProps {
  spec: AdSpec;
  layout: ResolvedLayout;
  surface: SurfaceProfile;
}

// An element can carry MULTIPLE simultaneous degradation records (e.g. a button
// iconified in one rung, then also shrunk in a later rung) — never assume there's
// only one per id. Look up the specific action category a given render decision
// needs, rather than collapsing all of an element's records into a single value.
function findDegradation(degradations: DegradationRecord[], id: string, actions: DegradationRecord["action"][]): DegradationRecord | undefined {
  return degradations.find((d) => d.id === id && actions.includes(d.action));
}

export function RenderedSurface({ spec, layout, surface }: RenderedSurfaceProps) {
  const normalized = normalizeSurfaceProfile(surface);
  const elementsById = new Map(spec.elements.map((el) => [el.id, el]));

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
        return <ElementBox key={box.id} box={box} element={element} degradations={layout.degradations} surface={normalized} />;
      })}
    </div>
  );
}

function ElementBox({
  box,
  element,
  degradations,
  surface,
}: {
  box: ResolvedBox;
  element: AdElement;
  degradations: DegradationRecord[];
  surface: NormalizedSurfaceProfile;
}) {
  const base: CSSProperties = {
    position: "absolute",
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    boxSizing: "border-box",
  };

  if (element.type === "text") {
    const truncated = !!findDegradation(degradations, box.id, ["truncate"]);
    const shortened = !!findDegradation(degradations, box.id, ["shorten"]);
    const activeContent = shortened && element.shortContent ? element.shortContent : element.content;
    const fontSize = Math.max(8, box.height / 1.35);
    return (
      <div
        className={`el-text el-role-${element.role}`}
        style={{ ...base, fontSize, lineHeight: `${box.height}px` }}
        title={element.content}
      >
        {activeContent}
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
    const cropped = !!findDegradation(degradations, box.id, ["crop"]);
    return (
      <div className={`el-image el-role-${element.role}`} style={base} title={element.alt}>
        <span>
          {element.alt}
          {cropped ? " — cropped" : ""}
        </span>
      </div>
    );
  }

  // button — precedence follows degradation depth, matching exactly what
  // measure.ts's measureButton() used to size the box: icon (if declared) always
  // wins once reached, since it's the deepest content-collapse rung and the box was
  // measured for the icon glyph regardless of any earlier merge; merge is next
  // (content changed but not yet collapsed to icon); then shorten; else the
  // original label. A button can be BOTH merged and later iconified in the same
  // resolve (merge didn't fit on its own, iconify did) — rendering must reflect
  // the box's actual measured content, not just whichever record exists.
  const isIconOnly = !!findDegradation(degradations, box.id, ["iconify"]) && !!element.icon;
  const mergedContent = !isIconOnly ? findDegradation(degradations, box.id, ["merge"])?.mergedContent : undefined;
  const isShortened = !isIconOnly && !mergedContent && !!findDegradation(degradations, box.id, ["shorten"]) && !!element.shortLabel;
  const activeLabel = isIconOnly ? element.icon! : mergedContent ?? (isShortened ? element.shortLabel! : element.label);

  return (
    <button
      className="el-button"
      style={{ ...base, fontSize: buttonFontSize(surface) }}
      aria-label={isIconOnly ? element.label : undefined}
    >
      {activeLabel}
    </button>
  );
}
