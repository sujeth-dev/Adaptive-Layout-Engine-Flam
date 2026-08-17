import { expect, test, type Locator, type Page } from "@playwright/test";

interface InlineBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

async function inlineBoxes(surface: Locator): Promise<InlineBox[]> {
  return surface.locator("[data-element-id]").evaluateAll((elements) =>
    elements.map((element) => {
      const node = element as HTMLElement;
      return {
        id: node.dataset.elementId!,
        left: Number.parseFloat(node.style.left),
        top: Number.parseFloat(node.style.top),
        width: Number.parseFloat(node.style.width),
        height: Number.parseFloat(node.style.height),
      };
    }),
  );
}

async function overflowingContent(surface: Locator) {
  return surface.locator(".el-text, .el-button").evaluateAll((elements) =>
    elements
      .map((element) => {
        const node = element as HTMLElement;
        return {
          id: node.dataset.elementId,
          text: node.textContent,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
        };
      })
      .filter((item) => item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1),
  );
}

async function setRange(page: Page, label: string, value: number) {
  await page.getByLabel(label).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test.beforeEach(async ({ page }) => {
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

test("320×480 renders the Stack checkpoint with real Canvas measurement", async ({ page }, testInfo) => {
  const surface = page.locator(".panel.preview .surface-canvas");
  await expect(surface).toHaveAttribute("data-strategy", "stack");

  const boxes = await inlineBoxes(surface);
  expect([...boxes].sort((a, b) => a.top - b.top).map((box) => box.id)).toEqual(
    expect.arrayContaining(["headline", "product-image", "cta", "price", "logo"]),
  );
  const byId = new Map(boxes.map((box) => [box.id, box]));
  expect(byId.get("cta")!.height).toBeGreaterThanOrEqual(44);
  expect(byId.get("product-image")!.width / byId.get("product-image")!.height).toBeCloseTo(1.3, 1);
  expect(Number(await surface.getAttribute("data-coverage-x"))).toBeGreaterThanOrEqual(0.8);
  expect(await page.evaluate(() => (window as typeof window & { __measureTextCalls?: number }).__measureTextCalls ?? 0)).toBeGreaterThan(0);
  expect(await overflowingContent(surface)).toEqual([]);

  await testInfo.attach("mobile-portrait-stack", {
    body: await surface.screenshot(),
    contentType: "image/png",
  });
});

test("required surfaces resolve to their canonical strategy with no overflow", async ({ page }, testInfo) => {
  const cases = [
    { button: "Mobile Landscape", strategy: "split" },
    { button: "Broadcast Lower-Third", strategy: "band" },
    { button: "Square Kiosk", strategy: "poster" },
    { button: "Constrained Strip", strategy: "band" },
  ];

  for (const item of cases) {
    await page.getByRole("button", { name: new RegExp(item.button.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
    const surface = page.locator(".panel.preview .surface-canvas");
    await expect(surface).toBeVisible();
    await expect(surface).toHaveAttribute("data-strategy", item.strategy);
    expect(await overflowingContent(surface), item.button).toEqual([]);
    await testInfo.attach(item.button.toLowerCase().replaceAll(/[^a-z]+/g, "-"), {
      body: await surface.screenshot(),
      contentType: "image/png",
    });
  }
});

test("live extreme dimension changes re-resolve without clipping", async ({ page }) => {
  await setRange(page, "Surface width", 1920);
  await setRange(page, "Surface height", 120);
  const surface = page.locator(".panel.preview .surface-canvas");
  await expect(surface).toHaveCSS("width", "1920px");
  await expect(surface).toHaveCSS("height", "120px");
  await expect(surface).toHaveAttribute("data-strategy", "band");

  const bounds = await surface.evaluate((node) => {
    const parent = node as HTMLElement;
    const width = Number.parseFloat(parent.style.width);
    const height = Number.parseFloat(parent.style.height);
    return [...parent.querySelectorAll<HTMLElement>("[data-element-id]")].map((element) => ({
      left: Number.parseFloat(element.style.left),
      top: Number.parseFloat(element.style.top),
      right: Number.parseFloat(element.style.left) + Number.parseFloat(element.style.width),
      bottom: Number.parseFloat(element.style.top) + Number.parseFloat(element.style.height),
      width,
      height,
    }));
  });
  expect(bounds.every((box) => box.left >= 0 && box.top >= 0 && box.right <= box.width && box.bottom <= box.height)).toBe(true);
});

test("the CTA's visible label is always its own accessible name", async ({ page }) => {
  await page.getByRole("button", { name: /Constrained Strip/ }).click();

  const button = page.locator(".panel.preview .surface-canvas .el-button");
  const label = await button.textContent();
  expect(label && label.length).toBeGreaterThan(0);
  await expect(button).toHaveAccessibleName(label!);
});
