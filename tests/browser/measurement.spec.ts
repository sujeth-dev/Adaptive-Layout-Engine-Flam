// Real-browser text measurement verification: confirms the resolver's text
// sizing decisions, made in Node against the conservative fallback estimate
// during tests, hold up against actual Canvas.measureText() in a real
// browser — no active full text silently overflows its resolved box, and
// measureText is genuinely being called (not skipped/cached away entirely).

import { expect, test, type Locator, type Page } from "@playwright/test";

const SURFACES = [
  { button: "Mobile Portrait" },
  { button: "Mobile Landscape" },
  { button: "Broadcast Lower-Third" },
  { button: "Square Kiosk" },
  { button: "Constrained Strip" },
];

async function overflowingText(surface: Locator) {
  return surface.locator(".el-text, .el-button, .el-brandmark").evaluateAll((elements) =>
    elements
      .map((element) => {
        const node = element as HTMLElement;
        return {
          id: node.dataset.elementId ?? node.className,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
        };
      })
      .filter((item) => item.scrollWidth > item.clientWidth + 1),
  );
}

test.beforeEach(async ({ page }: { page: Page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __measureTextCalls?: number };
    state.__measureTextCalls = 0;
    const original = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function (...args) {
      state.__measureTextCalls = (state.__measureTextCalls ?? 0) + 1;
      return original.apply(this, args);
    };
  });
  await page.goto("/");
});

for (const { button } of SURFACES) {
  test(`${button}: real Canvas measurement produces no DOM text overflow`, async ({ page }) => {
    await page.getByRole("button", { name: new RegExp(button.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
    const surface = page.locator(".panel.preview .surface-canvas");
    await expect(surface).toBeVisible();

    const calls = await page.evaluate(() => (window as typeof window & { __measureTextCalls?: number }).__measureTextCalls ?? 0);
    expect(calls).toBeGreaterThan(0);

    expect(await overflowingText(surface), button).toEqual([]);
  });
}
