import { useMemo, useState } from "react";
import { demoAd } from "./spec";
import { broadcastLowerThird, mobileLandscape, mobilePortrait, retailKiosk } from "./surfaces";
import { resolveLayout } from "./resolver";
import { RenderedSurface } from "./render-dom";
import type { DegradationAction, SafeArea, SurfaceProfile, ViewingDistance } from "./types";
import "./App.css";

// This is UI wiring only — labels/ids here are for the picker, never consumed
// by the resolver as a layout decision. Height tightened from an earlier 130px: once
// gap-compaction and real text measurement made the resolver strictly better at
// fitting content, 300x130 stopped needing any degradation at all — this shorter
// banner still meaningfully demonstrates the ladder (branding drops, price merges
// into the CTA) instead of just succeeding cleanly.
const constrainedBanner: SurfaceProfile = { id: "constrainedBanner", width: 300, height: 100, minTapTarget: 40 };

const PRESETS: { id: string; label: string; profile: SurfaceProfile }[] = [
  { id: "mobilePortrait", label: "Mobile Portrait", profile: mobilePortrait },
  { id: "mobileLandscape", label: "Mobile Landscape", profile: mobileLandscape },
  { id: "broadcastLowerThird", label: "Broadcast Lower-Third", profile: broadcastLowerThird },
  { id: "retailKiosk", label: "Square Kiosk", profile: retailKiosk },
  { id: "constrainedBanner", label: "Constrained (degradation demo)", profile: constrainedBanner },
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
  truncate: "…",
  drop: "✕",
  reposition: "↻",
  shorten: "✂",
  iconify: "◇",
  crop: "⛶",
  merge: "⋈",
  "compact-spacing": "↔",
};

interface Rejection {
  strategy: string;
  reason: string;
}

/** Rejections from the winning attempt only — "what else was tried at the geometry
 * that ultimately worked," not a dump of every rejection across every degradation
 * rung. Pure display-layer parsing of the resolver's own trace strings — resolver.ts
 * is untouched, this just reads the human-readable trace it already produces. */
function lastAttemptRejections(trace: string[]): Rejection[] {
  let start = -1;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i]!.trimStart().startsWith("attempt ")) start = i;
  }
  if (start === -1) return [];
  const out: Rejection[] = [];
  for (let i = start + 1; i < trace.length; i++) {
    const line = trace[i]!.trim();
    if (line.startsWith("winner:")) break;
    const match = line.match(/^(.+?) → rejected: (.+)$/);
    if (match) out.push({ strategy: match[1]!, reason: match[2]! });
  }
  return out;
}

type TraceRowType = "header" | "reject" | "winner" | "plain";
interface TraceRow {
  type: TraceRowType;
  marker: string;
  text: string;
  indent: boolean;
}

function classifyTrace(trace: string[]): TraceRow[] {
  return trace.map((raw) => {
    const text = raw.trim();
    const indent = raw.startsWith("  ");
    if (text.startsWith("attempt ")) return { type: "header", marker: "", text, indent: false };
    if (text.startsWith("winner:")) return { type: "winner", marker: "→", text, indent: false };
    if (text.includes(" → rejected:")) return { type: "reject", marker: "✕", text, indent };
    return { type: "plain", marker: "·", text, indent };
  });
}

export default function App() {
  const [presetId, setPresetId] = useState("mobilePortrait");
  const [surface, setSurface] = useState<SurfaceProfile>(mobilePortrait);
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => resolveLayout(demoAd, surface), [surface]);
  const clipboardSupported = typeof navigator !== "undefined" && !!navigator.clipboard?.writeText;

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

  const rejections = result.ok ? lastAttemptRejections(result.layout.trace) : [];
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
            <input type="range" min={100} max={1920} value={surface.width} onChange={(e) => updateField("width", Number(e.target.value))} />
            <div className="field-row-line" style={{ marginTop: "var(--s3)" }}>
              <span className="mono-label">Height</span>
              <span className="fval tabular">{surface.height}px</span>
            </div>
            <input type="range" min={80} max={1200} value={surface.height} onChange={(e) => updateField("height", Number(e.target.value))} />
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
                  type="number"
                  min={0}
                  value={surface.minTapTarget ?? 0}
                  onChange={(e) => updateField("minTapTarget", Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span className="mono-label">
                  Min text size
                  <span className="tip" tabIndex={0} data-tip="Smallest font size, in px, text is allowed to shrink to before truncation.">
                    °
                  </span>
                </span>
                <input
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
                    </div>
                  </div>
                </div>

                <div className="readout-grid">
                  <div>
                    <p className="mono-label">Rejected ({rejections.length})</p>
                    {rejections.length === 0 ? (
                      <div className="empty-row">No rejected strategies — every candidate this attempt was valid.</div>
                    ) : (
                      rejections.map((r, i) => (
                        <div className="reject-row" key={`${r.strategy}-${i}`}>
                          <span className="strategy">{r.strategy}</span>
                          <span className="reason">{r.reason}</span>
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
                    {classifyTrace(result.layout.trace).map((row, i) => (
                      <div key={i} className={`tl-row ${row.type}${row.indent ? " indent" : ""}`}>
                        {row.marker && <span className="m">{row.marker}</span>}
                        {row.text}
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
                    {classifyTrace(result.details).map((row, i) => (
                      <div key={i} className={`tl-row ${row.type}${row.indent ? " indent" : ""}`}>
                        {row.marker && <span className="m">{row.marker}</span>}
                        {row.text}
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
