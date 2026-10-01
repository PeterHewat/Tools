import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHmac, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import jsQR from "jsqr";
import { findApp } from "../../packages/catalog/src/index.js";

test("JWT verifies a known signature, rejects a mismatch and clears stale results", async ({
  page,
}) => {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
  const payload = Buffer.from(
    '{"sub":"browser test","id":9223372036854775807,"exp":1,"nbf":4102444800}'
  ).toString("base64url");
  const input = `${header}.${payload}`;
  const signature = createHmac("sha256", "test key").update(input).digest("base64url");
  await page.goto("/Tools/jwt/");
  await page.locator("#token").fill(`${input}.${signature}`);
  await expect(page.getByRole("textbox", { name: "Decoded JWT payload" })).toContainText(
    "browser test"
  );
  await expect(page.locator("#claims")).toContainText("Expired");
  await expect(page.getByRole("textbox", { name: "Decoded JWT payload" })).toContainText(
    "9223372036854775807"
  );
  await expect(page.locator("#claims")).toContainText("Not valid for");
  await page.locator("#key").fill("test key");
  await page.locator("#verify").click();
  await expect(page.locator("#verify-status")).toContainText("Signature matches");
  await page.locator("#key").fill("wrong");
  await expect(page.locator("#verify-status")).toHaveText("Signature not verified.");
  await page.locator("#verify").click();
  await expect(page.locator("#verify-status")).toContainText("does not match");
  await page.locator("#algorithm").selectOption("HS512");
  await page.locator("#verify").click();
  await expect(page.locator("#verify-status")).toContainText("does not match the token header");
  await page.locator("#token").fill("invalid");
  await expect(page.getByRole("textbox", { name: "Decoded JWT payload" })).toBeEmpty();
  await expect(page.locator("#verify")).toBeDisabled();
  await expect(page.locator("#decode-status")).toHaveAttribute("data-error", "true");
  await page.reload();
  await expect(page.locator("#token")).toBeEmpty();
  await expect(page.locator("#key")).toBeEmpty();
});

test("Codec converts from either pane and keeps binary errors explicit", async ({ page }) => {
  await page.goto("/Tools/codec/");
  await page.locator("#left").fill("Hello 🌍\n");
  await page.locator("#left-convert").click();
  await expect(page.locator("#right")).toHaveValue(Buffer.from("Hello 🌍\n").toString("base64"));
  await page.locator("#left").fill("");
  await page.locator("#right-convert").click();
  await expect(page.locator("#left")).toHaveValue("Hello 🌍\n");
  await expect(page.locator("#left-bytes")).toContainText("f0 9f 8c 8d 0a");
  await page.locator("#left-format").selectOption("hex");
  await page.locator("#left").fill("ff00");
  await page.locator("#right-format").selectOption("text");
  await page.locator("#left-convert").click();
  await expect(page.locator("#status")).toContainText("not valid UTF-8");
  await page.locator("#right-format").selectOption("base64");
  await page.locator("#left-convert").click();
  await expect(page.locator("#right")).toHaveValue("/wA=");
  await page.locator("#clear").click();
  await expect(page.locator("#left")).toBeEmpty();
  await expect(page.locator("#right")).toBeEmpty();
});

test("Digests hashes exact text, binary files and HMAC, invalidating on edits", async ({
  page,
}) => {
  await page.goto("/Tools/digests/");
  await expect(page.locator("#file-field")).toBeHidden();
  await expect(page.locator("#key-fields")).toBeHidden();
  await page.locator("#text").fill("abc\n");
  await page.locator("#hash").click();
  await expect(page.locator("#hex")).toHaveText(createHash("sha256").update("abc\n").digest("hex"));
  await page.locator("#text").fill("abc");
  await expect(page.locator("#hex")).toBeEmpty();
  await expect(page.locator("#copy-hex")).toBeDisabled();
  await page.locator("#hmac").check();
  await page.locator("#key").fill("test key");
  await page.locator("#hash").click();
  await expect(page.locator("#hex")).toHaveText(
    createHmac("sha256", "test key").update("abc").digest("hex")
  );
  await page.locator("#key").fill("");
  await page.locator("#hash").click();
  await expect(page.locator("#status")).toContainText("non-empty");
  await page.locator("#hmac").uncheck();
  await page.locator("#source").selectOption("file");
  await expect(page.locator("#text-field")).toBeHidden();
  const bytes = Buffer.from([0, 255, 13, 10]);
  await page
    .locator("#file")
    .setInputFiles({ name: "binary.dat", mimeType: "application/octet-stream", buffer: bytes });
  await page.locator("#hash").click();
  await expect(page.locator("#hex")).toHaveText(createHash("sha256").update(bytes).digest("hex"));
  await page.locator("#algorithm").selectOption("SHA-1");
  await expect(page.locator("#legacy")).toBeVisible();
  await page.locator("#clear").click();
  await expect(page.locator("#hex")).toBeEmpty();
});

test("Codes exports SVG and an independently decodable PNG with Wi-Fi content", async ({
  page,
}) => {
  await page.goto("/Tools/codes/");
  await page.locator("#content").fill("https://example.com/🌍");
  await expect(page.locator("#preview svg")).toBeVisible();
  const svgDownload = page.waitForEvent("download");
  await page.locator("#save-svg").click();
  const svg = await readFile((await (await svgDownload).path())!, "utf8");
  expect(svg).toContain('shape-rendering="crispEdges"');
  expect(svg).not.toContain("example.com");
  await page.locator("#preset").selectOption("wifi");
  await expect(page.locator("#content-field")).toBeHidden();
  await page.locator("#ssid").fill("office;guest");
  await page.locator("#password").fill("test-password");
  await expect(page.locator("#encoded")).toHaveText(
    "WIFI:T:WPA;S:office\\;guest;P:test-password;H:false;;"
  );
  const pngDownload = page.waitForEvent("download");
  await page.locator("#save-png").click();
  const png = await readFile((await (await pngDownload).path())!);
  // The browser decodes the actual exported PNG; jsQR checks the exported pixels independently.
  const pixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return {
      width: image.width,
      height: image.height,
      data: Array.from(context.getImageData(0, 0, image.width, image.height).data),
    };
  }, png.toString("base64"));
  expect(jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)?.data).toBe(
    "WIFI:T:WPA;S:office\\;guest;P:test-password;H:false;;"
  );
  await page.locator("#margin").fill("3");
  await expect(page.locator("#status")).toContainText("Margin must");
  await expect(page.locator("#save-svg")).toBeDisabled();
  await expect(page.locator("#preview svg")).toHaveCount(0);
});

for (const slug of ["jwt", "codec", "codes", "digests"]) {
  test(`${slug} fits narrow headers, shares theme and has accessible controls`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/Tools/${slug}/`);
    const headerWidth = await page.locator("header").evaluate((header) => {
      const style = getComputedStyle(header);
      const children = [...header.children];
      return Math.ceil(
        children.reduce((sum, child) => {
          const css = getComputedStyle(child);
          return (
            sum +
            child.getBoundingClientRect().width +
            (child.classList.contains("ui-header-end") ? 0 : parseFloat(css.marginLeft)) +
            parseFloat(css.marginRight)
          );
        }, 0) +
          parseFloat(style.columnGap) * (children.length - 1) +
          parseFloat(style.paddingLeft) +
          parseFloat(style.paddingRight)
      );
    });
    await writeFile(`test-results/${slug}-header.json`, JSON.stringify({ width: headerWidth }));
    expect(findApp(slug)?.compactHeader).toBeGreaterThanOrEqual(headerWidth);
    const violations = (await new AxeBuilder({ page }).analyze()).violations;
    expect(violations).toEqual([]);
    for (const width of [1280, 480, 420, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect(await page.locator("header").evaluate((el) => el.getBoundingClientRect().height)).toBe(
        48
      );
      await expect(page.locator("#theme-toggle")).toBeVisible();
      await expect(page.locator("#theme-toggle")).toHaveCSS("width", "34px");
      await expect(page.locator("#theme-toggle")).toHaveCSS("height", "34px");
      await expect(page.locator("#help-toggle")).toBeVisible();
    }
    await page.locator("#theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
    await page.locator("#help-toggle").click();
    await expect(page.locator("#help")).toBeVisible();
    await page.locator("#help-close").click();
    await expect(page.locator("#help")).toBeHidden();
    expect(errors).toEqual([]);
    await page.setViewportSize({ width: findApp(slug)!.compactHeader!, height: 900 });
    await expect(page.locator(".ui-app-name")).toHaveCSS("position", "absolute");
    expect(await page.locator("header").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({ path: `test-results/${slug}-phone.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    if (slug === "jwt" || slug === "codec") await page.locator("#sample").click();
    if (slug === "codes") {
      await page.locator("#content").fill("https://example.com/");
      await expect(page.locator("#preview svg")).toBeVisible();
    }
    if (slug === "digests") {
      await page.locator("#text").fill("Hello, world!");
      await page.locator("#hash").click();
      await expect(page.locator("#hex")).not.toBeEmpty();
    }
    await page.screenshot({ path: `test-results/${slug}-desktop.png`, fullPage: true });
  });
}

test("catalog links, install shortcuts and offline cache contain all four tools", async ({
  page,
  context,
}) => {
  await page.goto("/Tools/");
  for (const slug of ["jwt", "codec", "codes", "digests"])
    await expect(page.locator(`a[href="/Tools/${slug}/"]`)).toBeVisible();
  const manifest = await (await page.request.get("/Tools/manifest.webmanifest")).json();
  for (const slug of ["jwt", "codec", "codes", "digests"])
    expect(
      manifest.shortcuts.some((shortcut: { url: string }) => shortcut.url === `${slug}/`)
    ).toBe(true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await new Promise<void>((resolve) => {
      if (navigator.serviceWorker.controller) resolve();
      else
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        });
    });
  });
  await context.setOffline(true);
  for (const slug of ["jwt", "codec", "codes", "digests"]) {
    await page.goto(`/Tools/${slug}/`);
    await expect(page.locator("main h1")).toBeVisible();
  }
});
