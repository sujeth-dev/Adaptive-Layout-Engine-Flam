import type { AdSpec } from "./types";

/** Typed identity helper — gives literal-type inference for ad spec authoring. No runtime checks here; see validateAdSpec(). */
export function defineAd(spec: AdSpec): AdSpec {
  return spec;
}

/** The single demo ad. No surface geometry appears anywhere in this spec.
 *
 * `compactContent`/`compactLabel`/`croppedAspectRatio` are optional degradation-ladder
 * hints, not layout — an element that omits one just has no rung for that particular
 * compromise. Declaring them here lets this ad demonstrate the full ladder: headline,
 * price, and the CTA can each switch to a shorter compact string, and the hero can
 * switch to a tighter declared crop, before anything is hidden or dropped. */
export const demoAd: AdSpec = defineAd({
  id: "demo-product-ad",
  elements: [
    {
      id: "headline",
      type: "text",
      role: "primary",
      priority: 1,
      content: "Summer Sale — 40% Off",
      compactContent: "40% Off",
    },
    {
      id: "product-image",
      type: "image",
      role: "hero",
      priority: 1,
      alt: "Product shot",
      aspectRatio: 1.3,
      croppedAspectRatio: 1,
    },
    {
      id: "cta",
      type: "button",
      role: "action",
      priority: 2,
      label: "Shop Now",
      compactLabel: "Shop 🛒",
    },
    {
      id: "price",
      type: "text",
      role: "secondary",
      priority: 2,
      content: "$29.99",
      compactContent: "$30",
    },
    { id: "logo", type: "image", role: "branding", priority: 3, alt: "Solstice", aspectRatio: 3.4 },
  ],
});
