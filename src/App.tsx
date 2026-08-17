import { useEffect, useMemo, useRef, useState } from "react";
import { demoAd } from "./spec";
import { broadcastLowerThird, constrainedStrip, mobileLandscape, mobilePortrait, retailKiosk } from "./surfaces";
import { resolveLayout } from "./resolver";
import { RenderedSurface } from "./render-dom";
import CheckpointGallery from "./CheckpointGallery";
import type {
  CandidateDiagnostic,
  ContinuityHint,
  DegradationAction,
  ElementRole,
  ResolvedLayout,
  ResolveResult,
  SafeArea,
  SurfaceProfile,
  ViewingDistance,
} from "./types";
import "./App.css";

const PRESETS: { id: string; label: string; profile: SurfaceProfile }[] = [
  { id: "mobilePortrait", label: "Mobile Portrait", profile: mobilePortrait },
  { id: "mobileLandscape", label: "Mobile Landscape", profile: mobileLandscape },
  { id: "broadcastLowerThird", label: "Broadcast Lower-Third", profile: broadcastLowerThird },
  { id: "retailKiosk", label: "Square Kiosk", profile: retailKiosk },
  { id: "constrainedStrip", label: "Constrained Strip", profile: constrainedStrip },
];

// The frame the preview renders inside. Surfaces smaller than the frame get a
// small cosmetic boost (never past the frame edge) so the preview reads as
// dominant instead of a diagram; surfaces that already need to shrink to fit
// are left alone rather than shrunk further.
const PREVIEW_MAX_WIDTH = 780;
const PREVIEW_MAX_HEIGHT = 560;
const PREVIEW_BOOST = 1.08;
const SAFE_AREA_SIDES = ["top", "right", "bottom", "left"] as const;

const DEGRADE_GLYPH: Record<DegradationAction, string> = {
  shrink: "▾",
  drop: "✕",
  hide: "◻",
  compact: "✂",
  crop: "⛶",
  "compact-spacing": "↔",
};

function lastAttemptCandidates(attempts: ResolvedLayout["attempts"]): CandidateDiagnostic[] {
  return attempts.length ? attempts[attempts.length - 1]!.candidates : [];
}

function deriveVariantByRole(layout: ResolvedLayout, elementsById: Map<string, { role: ElementRole }>) {
  const map: Partial<Record<ElementRole, "full" | "compact">> = {};
  for (const box of layout.boxes) {
    const role = elementsById.get(box.id)?.role;
    if (role) map[role] = box.presentation.variant;
  }
  return map;
}

export default function App() {
  const [presetId, setPresetId] = useState("mobilePortrait");
  const [surface, setSurface] = useState<SurfaceProfile>(mobilePortrait);
  const [copied, setCopied] = useState(false);
  const continuityRef = useRef<ContinuityHint | undefined>(undefined);
  const elementsById = useMemo(() => new Map(demoAd.elements.map((el) => [el.id, el])), []);

  const result: ResolveResult = useMemo(() => resolveLayout(demoAd, surface, continuityRef.current), [surface]);
  const clipboardSupported = typeof navigator !== "undefined" && !!navigator.clipboard?.writeText;

  useEffect(() => {
    if (result.ok) {
      continuityRef.current = {
        previousStrategy: result.layout.strategy,
        previousContentVariantByRole: deriveVariantByRole(result.layout, elementsById),
      };
    }
  }, [result, elementsById]);

  function applyPreset(id: string) {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    continuityRef.current = undefined; // a preset jump is not a live drag — no hysteresis carried over
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

  function copyTrace() {
    if (!clipboardSupported) return;
    const text = (result.ok ? result.layout.trace : result.details).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  const fit = Math.min(1, PREVIEW_MAX_WIDTH / surface.width, PREVIEW_MAX_HEIGHT / surface.height);
  const scale = fit === 1 ? Math.min(PREVIEW_BOOST, PREVIEW_MAX_WIDTH / surface.width, PREVIEW_MAX_HEIGHT / surface.height) : fit;

  const candidates = result.ok ? lastAttemptCandidates(result.layout.attempts) : lastAttemptCandidates(result.attempts);
  const scorePct = result.ok ? Math.max(0, Math.min(1, result.layout.score)) * 100 : 0;

  return (
    <div className="app">
      <header className="app-header">
        <div className="lead">
          <p className="kicker">System — Constraint Resolver</p>
          <h1>Adaptive Layout Engine</h1>
          <p className="tagline">One ad spec, resolved live against whatever surface constraints you give it. No per-surface layout branches.</p>
        </div>
        <div className="status-chip">
          <span className={`dot ${result.ok ? "" : "dot-fail"}`} />
          {surface.id} — {result.ok ? "resolved" : "failed"}
        </div>
      </header>

      <CheckpointGallery />

      <div className="app-body">
        <main className="panel preview">
          <div className="panel-head">
            <span className="mono-label">02 — Preview</span>
          </div>
          <div className="preview-caption">
            <div>
              <p className="surface-id">{surface.id}</p>
              <p className="stat tabular">
                {surface.width} <span>×</span> {surface.height}
              </p>
            </div>
            {result.ok && <span className="strategy-pill">{result.layout.strategy}</span>}
          </div>
          <div className="preview-stage" style={{ width: PREVIEW_MAX_WIDTH, height: PREVIEW_MAX_HEIGHT }}>
            <div className="preview-surface" style={{ width: surface.width * scale, height: surface.height * scale }}>
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
          </div>
        </main>

        <aside className="panel controls">
          <div className="panel-head">
            <span className="mono-label">01 — Surface</span>
          </div>

          <div className="preset-list">
            {PRESETS.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={`preset-row ${presetId === p.id ? "selected" : ""}`}
                aria-pressed={presetId === p.id}
                onClick={() => applyPreset(p.id)}
              >
                <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                <span className="lbl">{p.label}</span>
                <span className="dim tabular">
                  {p.profile.width}×{p.profile.height}
                </span>
              </button>
            ))}
            <button
              type="button"
              className={`preset-row custom ${presetId === "custom" ? "selected" : ""}`}
              aria-pressed={presetId === "custom"}
              onClick={() => setPresetId("custom")}
            >
              <span className="idx">C</span>
              <span className="lbl">Custom / unseen 5th</span>
              <span className="dim tabular">—</span>
            </button>
          </div>

          <div className="rail-section field-block">
            <div className="field-row-line">
              <span className="mono-label">Width</span>
              <span className="fval tabular">{surface.width}px</span>
            </div>
            <input aria-label="Surface width" type="range" min={80} max={2200} value={surface.width} onChange={(e) => updateField("width", Number(e.target.value))} />
            <div className="field-row-line" style={{ marginTop: "var(--s3)" }}>
              <span className="mono-label">Height</span>
              <span className="fval tabular">{surface.height}px</span>
            </div>
            <input aria-label="Surface height" type="range" min={80} max={1400} value={surface.height} onChange={(e) => updateField("height", Number(e.target.value))} />
          </div>

          <div className="rail-section">
            <div className="field-row-2">
              <label className="field">
                <span className="mono-label">
                  Min tap target
                  <span className="tip" tabIndex={0} data-tip="Smallest touchable region, in px, a tappable element may resolve to.">
                    °
                  </span>
                </span>
                <input
                  aria-label="Minimum tap target"
                  type="number"
                  min={0}
                  value={surface.minTapTarget ?? 0}
                  onChange={(e) => updateField("minTapTarget", Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span className="mono-label">
                  Min text size
                  <span className="tip" tabIndex={0} data-tip="Smallest font size, in px, text is allowed to resolve to.">
                    °
                  </span>
                </span>
                <input
                  aria-label="Minimum text size"
                  type="number"
                  min={0}
                  value={surface.minTextSize ?? 0}
                  onChange={(e) => updateField("minTextSize", Number(e.target.value))}
                />
              </label>
            </div>

            <div className="field-row-2">
              <label className="field">
                <span className="mono-label">
                  Viewing distance
                  <span className="tip" tabIndex={0} data-tip="Expected reading distance — influences minimum legible text size.">
                    °
                  </span>
                </span>
                <select value={surface.viewingDistance ?? "medium"} onChange={(e) => updateField("viewingDistance", e.target.value as ViewingDistance)}>
                  <option value="close">close</option>
                  <option value="medium">medium</option>
                  <option value="far">far</option>
                </select>
              </label>
              <div className="field toggle-row">
                <span className="mono-label">Touch only</span>
                <span className="switch">
                  <input type="checkbox" checked={surface.touchOnly ?? false} onChange={(e) => updateField("touchOnly", e.target.checked)} />
                  <span className="track" />
                  <span className="knob" />
                </span>
              </div>
            </div>
          </div>

          <div className="rail-section">
            <p className="mono-label safe-area-label">Safe area</p>
            <div className="safe-grid">
              {SAFE_AREA_SIDES.map((side) => (
                <label className="field" key={side}>
                  <span className="mono-label">{side}</span>
                  <input
                    aria-label={`Safe area ${side}`}
                    type="number"
                    min={0}
                    value={surface.safeArea?.[side] ?? 0}
                    onChange={(e) => updateSafeArea(side, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
          </div>
        </aside>

        <section className="panel trace">
          <div className="panel-head">
            <span className="mono-label">03 — Resolver Output</span>
            <div className="panel-head-right">
              <span className="status-live" aria-live="polite">
                <span className={`status-dot ${result.ok ? "" : "status-dot-fail"}`} />
                {result.ok ? "Resolved" : "Failed"}
              </span>
              <button className="icon-btn" type="button" aria-disabled={!clipboardSupported} onClick={clipboardSupported ? copyTrace : undefined}>
                <span className="glyph">{copied ? "✓" : "⧉"}</span> {copied ? "Copied" : "Copy trace"}
              </button>
            </div>
          </div>

          <div className="trace-body">
            {result.ok ? (
              <>
                <div className="trace-head">
                  <div className="score-block">
                    <div>
                      <p className="mono-label">Score</p>
                      <p className="score-num tabular">{result.layout.score.toFixed(3)}</p>
                    </div>
                    <div className="score-meta">
                      <div className="score-bar">
                        <i style={{ width: `${scorePct}%` }} />
                      </div>
                      <p className="mono-label">
                        {result.layout.boxes.length} / {demoAd.elements.length} elements visible
                      </p>
                      <p className="mono-label">
                        Frame {(result.layout.composition.coverageX * 100).toFixed(0)}% × {(result.layout.composition.coverageY * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>
                </div>

                <div className="readout-grid">
                  <div>
                    <p className="mono-label">Winning rung — candidates ({candidates.length})</p>
                    {candidates.length === 0 ? (
                      <div className="empty-row">No candidates recorded.</div>
                    ) : (
                      candidates.map((c, i) => (
                        <div className="reject-row" key={`${c.strategy}-${i}`}>
                          <span className="strategy">{c.strategy}</span>
                          <span className="reason">{c.valid ? `score ${c.score!.toFixed(3)}` : c.rejectionReasons?.[0]}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="side-list">
                    <div>
                      <p className="mono-label">Degradations</p>
                      <div className="row-list">
                        {result.layout.degradations.length === 0 ? (
                          <div className="empty-row">None — resolved at full priority.</div>
                        ) : (
                          result.layout.degradations.map((d) => (
                            <div className="deg-row" key={`${d.id}-${d.action}`}>
                              <span className={`badge ${d.action}`}>{DEGRADE_GLYPH[d.action]}</span>
                              <span className="id">{d.id === "*" ? "surface" : d.id}</span>
                              <span className="detail">{d.detail}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="mono-label">Omitted</p>
                      <div className="row-list">
                        {result.layout.omitted.length === 0 ? (
                          <div className="empty-row">None — all {demoAd.elements.length} elements placed.</div>
                        ) : (
                          result.layout.omitted.map((o) => (
                            <div className="deg-row" key={o.id}>
                              <span className="id">{o.id}</span>
                              <span className="detail">{o.reason}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <details className="trace-disclosure">
                  <summary>
                    <span className="chev">›</span> View full trace
                  </summary>
                  <div className="trace-log">
                    {result.layout.trace.map((line, i) => (
                      <div key={i} className="tl-row">
                        {line}
                      </div>
                    ))}
                  </div>
                </details>
              </>
            ) : (
              <>
                <div className="resolver-failure">
                  <div>
                    <p className="failure-reason">∅ {result.reason}</p>
                    <p className="failure-message">{result.message}</p>
                  </div>
                  <div className="failure-stat">
                    <p className="num tabular">
                      {surface.width}×{surface.height}
                    </p>
                    <p className="lbl">Requested surface</p>
                  </div>
                </div>
                <details className="trace-disclosure">
                  <summary>
                    <span className="chev">›</span> View full trace
                  </summary>
                  <div className="trace-log">
                    {result.details.map((line, i) => (
                      <div key={i} className="tl-row">
                        {line}
                      </div>
                    ))}
                  </div>
                </details>
              </>
            )}
          </div>
        </section>
      </div>

      <footer className="app-footer">
        <p>ADAPTIVE LAYOUT ENGINE — ONE SPEC, RESOLVED PER SURFACE. NO PER-SURFACE BRANCHES.</p>
      </footer>
    </div>
  );
}
