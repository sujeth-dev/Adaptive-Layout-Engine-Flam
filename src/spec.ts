import type { AdSpec } from "./types";

/** Typed identity helper — gives literal-type inference for ad spec authoring. No runtime checks here; see validateAdSpec(). */
export function defineAd(spec: AdSpec): AdSpec {
  return spec;
}

/** The single demo ad. No surface geometry appears anywhere in this spec. */
export const demoAd: AdSpec = defineAd({
  id: "demo-product-ad",
  elements: [
    { id: "headline", type: "text", role: "primary", priority: 1, content: "Summer Sale — 40% Off" },
    { id: "product-image", type: "image", role: "hero", priority: 1, alt: "Product shot", aspectRatio: 1.3 },
    { id: "cta", type: "button", role: "action", priority: 2, label: "Shop Now" },
    { id: "price", type: "text", role: "secondary", priority: 2, content: "$29.99" },
    { id: "logo", type: "image", role: "branding", priority: 3, alt: "Solstice", aspectRatio: 3.4 },
  ],
});
