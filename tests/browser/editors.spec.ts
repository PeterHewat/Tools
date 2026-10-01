import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "svg.demos",
      JSON.stringify(["crab", "goldfish", "jellyfish", "octopus", "starfish"])
    )
  );
  // Assert after each test through an automatically registered assertion hook below.
  errorLists.set(page, errors);
});
const errorLists = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => {
  expect(errorLists.get(page)).toEqual([]);
});

test("JSON preserves exact numbers through formatting, conversion, undo and reload", async ({
  page,
}) => {
  await page.goto("/Tools/json/");
  const editor = page.getByRole("textbox", { name: "JSON", exact: true });
  await editor.fill('{"id":9223372036854775807,"rows":[{"name":"one"}]}');
  await page.locator("#format").click();
  await expect(editor).toContainText("9223372036854775807");
  await expect(page.locator("#status")).toContainText("Valid JSON");
  await page.locator('[data-view="yaml"]').click();
  await expect(page.getByRole("textbox", { name: "Converted document" })).toContainText(
    "9223372036854775807"
  );
  await page.locator('[data-view="json"]').click();
  await page.locator("#minify").click();
  await expect(editor).toHaveText('{"id":9223372036854775807,"rows":[{"name":"one"}]}');
  await editor.press("ControlOrMeta+z");
  await expect(editor).toContainText("\n");
  await page.reload();
  await expect(editor).toContainText("9223372036854775807");
});

test("SVG draws, undoes, redoes and restores a rectangle", async ({ page }) => {
  await page.goto("/Tools/svg/");
  await page.locator("#menu-document-btn").click();
  await page.locator("#btn-new-doc").click();
  await page.locator("#menu-document-btn").click();
  await page.locator('[data-tool="rect"]').click();
  const canvas = await page.locator("#viewport-svg").boundingBox();
  if (!canvas) throw new Error("Drawing surface is missing");
  await page.mouse.move(canvas.x + canvas.width * 0.4, canvas.y + canvas.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.55, canvas.y + canvas.height * 0.55, {
    steps: 8,
  });
  await page.mouse.up();
  const shapes = page.locator("#layer-document [data-element-id]:not(.hit-area)");
  await expect(shapes).toHaveCount(1);
  await page.locator("#btn-undo").click();
  await expect(shapes).toHaveCount(0);
  await page.locator("#btn-redo").click();
  await expect(shapes).toHaveCount(1);
  // The panel is closed: visibility alone says nothing about whether IndexedDB finished.
  await expect(page.locator("#doc-dirty")).toHaveClass(/hidden/);
  await page.reload();
  await expect(shapes).toHaveCount(1);
});

test("SVG loads source on demand and source edits reach the drawing", async ({ page }) => {
  const sourceRequests: string[] = [];
  page.on("request", (request) => {
    if (/svg-source-editor-.*\.js/.test(request.url())) sourceRequests.push(request.url());
  });
  await page.goto("/Tools/svg/");
  await expect(page.locator("#viewport-svg")).toBeVisible();
  expect(sourceRequests).toHaveLength(0);
  await page.locator("#menu-document-btn").click();
  const source = page.getByRole("textbox", { name: "SVG source (editable)" });
  await expect(source).toBeVisible();
  expect(sourceRequests).toHaveLength(1);
  await source.fill(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect x="10" y="20" width="30" height="40"/></svg>'
  );
  await expect(page.locator("#layer-document rect[data-element-id]:not(.hit-area)")).toHaveCount(1);
  await expect(page.locator("#svg-error")).toBeHidden();
  await page.locator("#menu-document-btn").click();
  await page.locator("#menu-document-btn").click();
  await expect(source).toContainText('width="30"');
});

test.describe("phone drawing", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("a finger draws a rectangle and two fingers zoom", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Native touch sequences use Chromium's input protocol.");
    await page.goto("/Tools/svg/");
    await page.locator('[data-tool="rect"]').click();
    const canvas = await page.locator("#viewport-svg").boundingBox();
    if (!canvas) throw new Error("Drawing surface is missing");
    const session = await context.newCDPSession(page);
    const a = { x: canvas.x + canvas.width * 0.3, y: canvas.y + canvas.height * 0.3 };
    const b = { x: canvas.x + canvas.width * 0.6, y: canvas.y + canvas.height * 0.5 };
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...a, id: 1 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...b, id: 1 }],
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator("#layer-document rect[data-element-id]:not(.hit-area)")).toHaveCount(
      1
    );
    const zoom = await page.locator("#btn-zoom-level").textContent();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { ...a, id: 1 },
        { ...b, id: 2 },
      ],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: a.x - 20, y: a.y, id: 1 },
        { x: b.x + 20, y: b.y, id: 2 },
      ],
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator("#btn-zoom-level")).not.toHaveText(zoom ?? "");
    await session.detach();
  });
});

test("header menus open by keyboard and Escape returns focus", async ({ page }) => {
  await page.goto("/Tools/json/");
  const button = page.getByRole("button", { name: "Settings", exact: true });
  await button.focus();
  await button.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
});

for (const slug of ["json", "svg"]) {
  test(`${slug} header fits each responsive level, with theme and Help visible`, async ({
    page,
  }) => {
    await page.goto(`/Tools/${slug}/`);
    for (const width of [1440, 730, 665, 645, 590, 475, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(
        page.locator(slug === "json" ? "#theme-toggle" : "[data-theme-toggle]")
      ).toBeVisible();
      await expect(page.locator(slug === "json" ? "#help-btn" : "#btn-help")).toBeVisible();
      const fits = await page.locator("header").evaluate((header) => {
        const r = header.getBoundingClientRect();
        const controls = [...header.querySelectorAll("button, a, select")].filter(
          (el) => el.getBoundingClientRect().width && getComputedStyle(el).visibility !== "hidden"
        );
        return (
          header.scrollWidth <= header.clientWidth &&
          controls.every((el) => {
            const box = el.getBoundingClientRect();
            return (
              box.left >= r.left &&
              box.right <= r.right + 1 &&
              box.top >= r.top &&
              box.bottom <= r.bottom + 1
            );
          })
        );
      });
      expect(fits, `${slug} header at ${width}px`).toBe(true);
    }
  });
  test(`${slug} has no automated WCAG A/AA violations in either theme`, async ({ page }) => {
    await page.goto(`/Tools/${slug}/`);
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        scan.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))
      ).toEqual([]);
    }
  });
}

test("all tools work offline after a visit and a new deploy replaces the cache", async ({
  page,
  context,
  request,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Service-worker lifecycle covered in Chromium; editing/layout runs in both engines."
  );
  await page.goto("/Tools/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        })
      );
  });
  const oldCaches = await page.evaluate(() => caches.keys());
  expect(oldCaches).toHaveLength(1);
  await context.setOffline(true);
  await page.goto("/Tools/json/");
  await expect(page.getByRole("textbox", { name: "JSON", exact: true })).toBeVisible();
  await page.goto("/Tools/svg/");
  await expect(page.locator("#viewport-svg")).toBeVisible();
  await page.locator("#menu-document-btn").click();
  await expect(page.getByRole("textbox", { name: "SVG source (editable)" })).toBeVisible();
  await context.setOffline(false);
  await request.post("/__test/deploy");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  await expect.poll(async () => page.evaluate(() => caches.keys())).not.toEqual(oldCaches);
  await expect.poll(async () => page.evaluate(() => caches.keys())).toHaveLength(1);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#updated-build")).toHaveCount(1);
  await expect(page.locator("#viewport-svg")).toBeVisible();
});
