import type { AdSpec } from "./types";

/** Typed identity helper — gives literal-type inference for ad spec authoring. No runtime checks here; see validateAdSpec(). */
export function defineAd(spec: AdSpec): AdSpec {
  return spec;
}

/** The single demo ad. No surface geometry appears anywhere in this spec.
 *
 * Content-variant fields (`shortContent`/`shortLabel`/`icon`/`croppedAspectRatio`) and
 * `merges` are optional degradation-ladder hints, not layout — a spec that omits them
 * degrades purely geometrically (shrink/truncate/drop), exactly as before this field
 * existed. Declaring them here lets this specific ad demonstrate the fuller ladder:
 * headline/price can shorten, the CTA can shorten then collapse to an icon, the hero
 * can switch to a tighter crop, and price can fold into the CTA ("Buy $30") before
 * either is dropped outright. */
export const demoAd: AdSpec = defineAd({
  id: "demo-product-ad",
  elements: [
    {
      id: "headline",
      type: "text",
      role: "primary",
      priority: 1,
      content: "Summer Sale — 40% Off",
      shortContent: "40% Off",
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
      shortLabel: "Shop 🛒",
      icon: "🛒",
    },
    {
      id: "price",
      type: "text",
      role: "secondary",
      priority: 2,
      content: "$29.99",
      shortContent: "$30",
    },
    { id: "logo", type: "image", role: "branding", priority: 3, alt: "Solstice", aspectRatio: 3.4 },
  ],
  merges: [{ sourceIds: ["price"], targetId: "cta", mergedLabel: "Buy $30" }],
});
