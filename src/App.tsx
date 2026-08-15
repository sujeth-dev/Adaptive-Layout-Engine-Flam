import { demoAd } from "./spec";
import { requiredSurfaces } from "./surfaces";

// Placeholder shell for Phase 1. The resolver + real renderer land in Phase 2/3;
// this just proves the foundation types/spec/surfaces wire up into a buildable app.
export default function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Adaptive Layout Engine</h1>
      <p>Foundation phase — resolver and renderer not implemented yet.</p>
      <p>Ad spec: {demoAd.id} ({demoAd.elements.length} elements)</p>
      <p>Surfaces loaded: {requiredSurfaces.map((s) => s.id).join(", ")}</p>
    </main>
  );
}
