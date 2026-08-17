// Native verification gallery — renders the five canonical checkpoints (plus
// a couple of unseen stress surfaces) through the real resolveLayout() +
// RenderedSurface, at true 1:1 scale inside a fixed viewport per card. No
// hand-built fake renderer: what you see here is exactly what the resolver
// and DOM renderer produce for these surfaces, the same code path as the
// interactive preview above it.

import { demoAd } from "./spec";
import { resolveLayout } from "./resolver";
import { RenderedSurface } from "./render-dom";
import { CHECKPOINTS } from "./checkpoints";
import type { SurfaceProfile } from "./types";

const STAGE_SIZE = 180;

const STRESS_SURFACES: { label: string; surface: SurfaceProfile }[] = [
  { label: "735×410 — unseen landscape", surface: { id: "unseen-landscape", width: 735, height: 410, minTapTarget: 40 } },
  { label: "90×80 — impossible", surface: { id: "impossible", width: 90, height: 80, minTapTarget: 44, minTextSize: 18 } },
];

function GalleryCard({ label, surface }: { label: string; surface: SurfaceProfile }) {
  const result = resolveLayout(demoAd, surface);
  const fit = Math.min(1, STAGE_SIZE / surface.width, STAGE_SIZE / surface.height);
  return (
    <div className="gallery-card">
      <div className="gallery-card-stage">
        {result.ok ? (
          <div style={{ transform: `scale(${fit})` }}>
            <RenderedSurface spec={demoAd} layout={result.layout} surface={surface} />
          </div>
        ) : (
          <span className="mono-label">no valid layout</span>
        )}
      </div>
      <div className="gallery-card-caption">
        <span>
          {label} — {surface.width}×{surface.height}
        </span>
        <span className="strategy">{result.ok ? result.layout.strategy : result.reason}</span>
      </div>
    </div>
  );
}

export default function CheckpointGallery() {
  return (
    <section className="gallery">
      <div className="panel-head">
        <span className="mono-label">Checkpoint Gallery — native 1:1 verification</span>
      </div>
      <div className="gallery-grid">
        {CHECKPOINTS.map((cp) => (
          <GalleryCard key={cp.id} label={cp.label} surface={cp.surface} />
        ))}
        {STRESS_SURFACES.map((s) => (
          <GalleryCard key={s.surface.id} label={s.label} surface={s.surface} />
        ))}
      </div>
    </section>
  );
}
