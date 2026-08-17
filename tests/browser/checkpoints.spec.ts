// Native 1:1 verification of the five canonical checkpoints via the real
// CheckpointGallery component (src/CheckpointGallery.tsx) — real resolver,
// real DOM renderer, no hand-built fake HTML. Screenshots are supporting
// evidence; the structural assertions are the actual check.

import { expect, test } from "@playwright/test";

const CHECKPOINTS = [
  { label: "320×480", strategy: "stack" },
  { label: "480×320", strategy: "split" },
  { label: "1920×250", strategy: "band" },
  { label: "1080×1080", strategy: "poster" },
  { label: "510×90", strategy: "band" },
];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("gallery renders all five canonical checkpoints with their locked strategy", async ({ page }) => {
  const cards = page.locator(".gallery-card");
  await expect(cards).toHaveCount(7); // five checkpoints + two stress surfaces

  for (const cp of CHECKPOINTS) {
    const card = page.locator(".gallery-card", { hasText: cp.label });
    await expect(card).toBeVisible();
    await expect(card.locator(".strategy")).toHaveText(cp.strategy);
  }
});

test("each checkpoint card renders through the real resolver with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.reload();
  await page.waitForSelector(".gallery-grid");
  expect(errors).toEqual([]);
});

test("checkpoint gallery screenshots", async ({ page }, testInfo) => {
  const gallery = page.locator(".gallery");
  await expect(gallery).toBeVisible();
  await testInfo.attach("checkpoint-gallery", {
    body: await gallery.screenshot(),
    contentType: "image/png",
  });

  for (const cp of CHECKPOINTS) {
    const card = page.locator(".gallery-card", { hasText: cp.label });
    await testInfo.attach(`checkpoint-${cp.label.replace(/[×]/g, "x")}`, {
      body: await card.screenshot(),
      contentType: "image/png",
    });
  }
});
