import { useMemo, useState } from "react";
import { demoAd } from "./spec";
import { broadcastLowerThird, mobileLandscape, mobilePortrait, retailKiosk } from "./surfaces";
import { resolveLayout } from "./resolver";
import { RenderedSurface } from "./render-dom";
import type { SafeArea, SurfaceProfile, ViewingDistance } from "./types";
import "./App.css";

// This is UI wiring only — labels/ids here are for the picker, never consumed
// by the resolver as a layout decision.
const constrainedBanner: SurfaceProfile = { id: "constrainedBanner", width: 300, height: 130, minTapTarget: 40 };

const PRESETS: { id: string; label: string; profile: SurfaceProfile }[] = [
  { id: "mobilePortrait", label: "Mobile Portrait", profile: mobilePortrait },
  { id: "mobileLandscape", label: "Mobile Landscape", profile: mobileLandscape },
  { id: "broadcastLowerThird", label: "Broadcast Lower-Third", profile: broadcastLowerThird },
  { id: "retailKiosk", label: "Square Kiosk", profile: retailKiosk },
  { id: "constrainedBanner", label: "Constrained (degradation demo)", profile: constrainedBanner },
];

const PREVIEW_MAX_WIDTH = 560;
const PREVIEW_MAX_HEIGHT = 420;
const SAFE_AREA_SIDES = ["top", "right", "bottom", "left"] as const;

export default function App() {
  const [presetId, setPresetId] = useState("mobilePortrait");
  const [surface, setSurface] = useState<SurfaceProfile>(mobilePortrait);

  const result = useMemo(() => resolveLayout(demoAd, surface), [surface]);

  function applyPreset(id: string) {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(id);
    setSurface(preset.profile);
  }

  function updateField<K extends keyof SurfaceProfile>(key: K, value: SurfaceProfile[K]) {
    setPresetId("custom");
    setSurface((s) => ({ ...s, [key]: value }));
  }

  function updateSafeArea(side: keyof SafeArea, value: number) {
    setPresetId("custom");
    setSurface((s) => ({
      ...s,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0, ...s.safeArea, [side]: value },
    }));
  }

  const scale = Math.min(1, PREVIEW_MAX_WIDTH / surface.width, PREVIEW_MAX_HEIGHT / surface.height);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Adaptive Layout Engine</h1>
        <p>One ad spec, resolved live against whatever surface constraints you give it. No per-surface layout branches.</p>
      </header>

      <div className="app-body">
        <aside className="panel controls">
          <h2>Surface</h2>
          <div className="preset-buttons">
            {PRESETS.map((p) => (
              <button key={p.id} className={presetId === p.id ? "active" : ""} onClick={() => applyPreset(p.id)}>
                {p.label}
              </button>
            ))}
            <button className={presetId === "custom" ? "active" : ""} onClick={() => setPresetId("custom")}>
              Custom / unseen 5th surface
            </button>
          </div>

          <label className="field">
            <span>Width: {surface.width}px</span>
            <input type="range" min={100} max={1920} value={surface.width} onChange={(e) => updateField("width", Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Height: {surface.height}px</span>
            <input type="range" min={80} max={1200} value={surface.height} onChange={(e) => updateField("height", Number(e.target.value))} />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Min tap target (px)</span>
              <input
                type="number"
                min={0}
                value={surface.minTapTarget ?? 0}
                onChange={(e) => updateField("minTapTarget", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Min text size (px)</span>
              <input
                type="number"
                min={0}
                value={surface.minTextSize ?? 0}
                onChange={(e) => updateField("minTextSize", Number(e.target.value))}
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Viewing distance</span>
              <select
                value={surface.viewingDistance ?? "medium"}
                onChange={(e) => updateField("viewingDistance", e.target.value as ViewingDistance)}
              >
                <option value="close">close</option>
                <option value="medium">medium</option>
                <option value="far">far</option>
              </select>
            </label>
            <label className="field checkbox">
              <input type="checkbox" checked={surface.touchOnly ?? false} onChange={(e) => updateField("touchOnly", e.target.checked)} />
              <span>Touch only</span>
            </label>
          </div>

          <h3>Safe area</h3>
          <div className="safe-area-grid">
            {SAFE_AREA_SIDES.map((side) => (
              <label className="field" key={side}>
                <span>{side}</span>
                <input
                  type="number"
                  min={0}
                  value={surface.safeArea?.[side] ?? 0}
                  onChange={(e) => updateSafeArea(side, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
        </aside>

        <main className="panel preview">
          <h2>
            {surface.id} — {surface.width}×{surface.height}
          </h2>
          <div className="preview-stage" style={{ width: surface.width * scale, height: surface.height * scale }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
              {result.ok ? (
                <RenderedSurface spec={demoAd} layout={result.layout} surface={surface} />
              ) : (
                <div className="failure-box" style={{ width: surface.width, height: surface.height }}>
                  No valid layout — see resolver output
                </div>
              )}
            </div>
          </div>
        </main>

        <aside className="panel trace">
          <h2>Resolver output</h2>
          {result.ok ? (
            <>
              <dl>
                <dt>Strategy</dt>
                <dd>{result.layout.strategy}</dd>
                <dt>Score</dt>
                <dd>{result.layout.score.toFixed(3)}</dd>
                <dt>Visible</dt>
                <dd>
                  {result.layout.boxes.length} / {demoAd.elements.length}
                </dd>
              </dl>
              {result.layout.omitted.length > 0 && (
                <>
                  <h3>Omitted</h3>
                  <ul>
                    {result.layout.omitted.map((o) => (
                      <li key={o.id}>
                        {o.id} — {o.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {result.layout.degradations.length > 0 && (
                <>
                  <h3>Degradations</h3>
                  <ul>
                    {result.layout.degradations.map((d) => (
                      <li key={d.id}>
                        {d.action} — {d.id}: {d.detail}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h3>Trace</h3>
              <pre className="trace-log">{result.layout.trace.join("\n")}</pre>
            </>
          ) : (
            <>
              <p className="failure-reason">
                <strong>{result.reason}</strong>: {result.message}
              </p>
              <h3>Trace</h3>
              <pre className="trace-log">{result.details.join("\n")}</pre>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
