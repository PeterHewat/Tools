import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHmac, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import jsQR from "jsqr";
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";
import { findApp } from "../../packages/catalog/src/index.js";

test("JWT decodes, verifies live, reads claims and decodes broken segments independently", async ({
  page,
}) => {
  await page.goto("/Tools/jwt/");
  const token = page.getByRole("textbox", { name: "JSON Web Token", exact: true });
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  for (const segment of ["header", "payload", "signature"])
    await expect(page.locator("#token .jwt-" + segment).first()).toBeVisible();
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
  const payload = Buffer.from(
    '{"sub":"browser test","id":9223372036854775807,"exp":1,"nbf":4102444800}'
  ).toString("base64url");
  const input = header + "." + payload;
  const signature = createHmac("sha256", "test key").update(input).digest("base64url");
  await token.fill(input + "." + signature);
  await expect(page.locator("#signature-state")).toHaveText("Invalid signature");
  await page.locator("#secret").fill("test key");
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  await expect(page.locator("#secret-check")).toHaveText(
    "Too short to sign HS256: 8 of 32 bytes. It can still verify."
  );
  await expect(page.getByRole("textbox", { name: "Decoded JWT payload" })).toContainText(
    "9223372036854775807"
  );
  await expect(page.locator("#time-state")).toContainText("Not valid for");
  // What the claims mean sits beside them, outside the JSON itself.
  const notes = page.locator("#payload-editor .cm-note");
  await expect(notes.filter({ hasText: "Subject" })).toBeVisible();
  await expect(notes.filter({ hasText: "Expiration time" })).toContainText("expired");
  await expect(notes.filter({ hasText: "Expiration time" })).toHaveClass(/cm-note-warn/);
  await expect(page.locator("#header-editor .cm-note").first()).toHaveText(
    "Algorithm: HMAC with SHA-256"
  );
  await page.locator("#secret").fill("wrong");
  await expect(page.locator("#signature-state")).toHaveText("Invalid signature");
  const whitespaceSecret = " ".repeat(32);
  const whitespaceSignature = createHmac("sha256", whitespaceSecret)
    .update(input)
    .digest("base64url");
  await token.fill(input + "." + whitespaceSignature);
  await page.locator("#secret").fill(whitespaceSecret);
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  await token.fill(header + "." + Buffer.from('{"broken":').toString("base64url") + ".!!");
  await expect(page.locator("#token-state")).toHaveText("Invalid JWT");
  await expect(page.getByRole("textbox", { name: "Decoded JWT header" })).toContainText("HS256");
  await expect(page.getByRole("textbox", { name: "Decoded JWT payload" })).toContainText(
    '{"broken":'
  );
  await expect(page.locator("#payload-status")).toHaveAttribute("data-error", "true");
  // An empty token shows its placeholder, which is all the text box then holds.
  await page.locator("#token-clear").click();
  await expect(page.locator("#token .cm-placeholder")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Decoded JWT header" })).toBeEmpty();
  await page.reload();
  await expect(page.locator("#token .cm-placeholder")).toBeVisible();
  await expect(page.locator("#token-status")).toContainText("Paste a token");
  // A payload typed into the empty page starts a new token, with a default header.
  await page.locator("#secret").fill("a-secret-of-at-least-thirty-two-bytes");
  await page.getByRole("textbox", { name: "Decoded JWT payload" }).fill('{"sub":"new"}');
  await expect(page.getByRole("textbox", { name: "Decoded JWT header" })).toContainText(
    '"typ": "JWT"'
  );
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
});

test("JWT signs edited JSON again and follows the algorithm through every signing family", async ({
  page,
}) => {
  await page.goto("/Tools/jwt/");
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  const token = page.getByRole("textbox", { name: "JSON Web Token", exact: true });
  await page
    .getByRole("textbox", { name: "Decoded JWT payload" })
    .fill('{"id":9223372036854775807,"name":"encoded"}');
  await expect(token).toContainText(
    Buffer.from('{"id":9223372036854775807,"name":"encoded"}').toString("base64url")
  );
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  const [input, signature] = (await token.innerText()).trim().split(/\.(?=[^.]*$)/);
  expect(
    createHmac("sha256", "a-public-example-secret-at-least-32-bytes")
      .update(input)
      .digest("base64url")
  ).toBe(signature);
  for (const algorithm of [
    "HS384",
    "HS512",
    "RS256",
    "RS384",
    "RS512",
    "PS256",
    "PS384",
    "PS512",
    "ES256",
    "ES384",
    "ES512",
    "EdDSA",
    "HS256",
  ]) {
    await page.locator("#algorithm").selectOption(algorithm);
    await expect(page.getByRole("textbox", { name: "Decoded JWT header" })).toContainText(
      `"alg": "${algorithm}"`
    );
    await expect(page.locator("#signature-state")).toHaveText("Signature verified");
    if (algorithm.startsWith("HS"))
      await expect(page.locator("#secret-check")).toHaveText("Valid secret");
    else {
      await expect(page.locator("#public-key")).toHaveValue(/BEGIN PUBLIC KEY/);
      await expect(page.locator("#public-check")).toHaveText("Valid public key");
      await expect(page.locator("#private-check")).toHaveText("Valid private key");
    }
  }
  // Another encoding writes the same secret differently: it still verifies.
  const text = await page.locator("#secret").inputValue();
  await page.locator("#secret-format").selectOption("hex");
  await expect(page.locator("#secret")).toHaveValue(Buffer.from(text).toString("hex"));
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  await page.locator("#secret-format").selectOption("text");
  await page.locator("#secret").fill("short");
  await page.getByRole("textbox", { name: "Decoded JWT payload" }).fill('{"changed":true}');
  await expect(page.locator("#key-status")).toContainText("Not signed");
  await expect(page.locator("#signature-state")).toHaveText("Invalid signature");
  await page.locator("#generate-key").click();
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  await page.locator("#algorithm").selectOption("ES256");
  // Signed with the new pair before its keys are edited, not merely still verified from before.
  await expect(token).toContainText(
    Buffer.from('{"alg":"ES256","typ":"JWT"}').toString("base64url")
  );
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  await page.locator("#private-key").fill(await page.locator("#public-key").inputValue());
  await expect(page.locator("#private-check")).toHaveText(
    "This is a public key: signing needs the private one"
  );
  await page.locator("#private-key").fill("");
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  // Typed, not filled: Firefox's fill can miss text beside the notes CodeMirror draws.
  await page.getByRole("textbox", { name: "Decoded JWT header" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type('{"alg":"none"}');
  // Unsigned: an empty signature, still a valid JWT, with no key to show.
  await expect(page.locator("#signature-state")).toHaveText("Unsigned token");
  await expect(page.locator("#token-state")).toHaveText("Valid JWT");
  await expect(page.getByRole("textbox", { name: "JSON Web Token", exact: true })).toHaveText(
    /\.$/
  );
  await expect(page.locator("#secret-fields")).toBeHidden();
  await expect(page.locator("#generate-key")).toBeHidden();
});

test("JWT cleans pasted tokens, keeps unreadable headers, and guards keys and encodings", async ({
  page,
}) => {
  await page.goto("/Tools/jwt/");
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  const token = page.getByRole("textbox", { name: "JSON Web Token", exact: true });
  const sample = (await token.innerText()).trim();
  // Pasted from a request, wrapped by a log: still the same token.
  await token.fill("Bearer " + sample.slice(0, 40) + "\n  " + sample.slice(40));
  await expect(token).toHaveText(sample);
  await expect(page.locator("#token-status")).toHaveText(
    'Removed the "Bearer " prefix and spaces and line breaks.'
  );
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  // A header that cannot be read is not replaced by a default one when the payload is edited.
  const broken = "e30!." + sample.split(".")[1] + ".c2ln";
  await token.fill(broken);
  await page.getByRole("textbox", { name: "Decoded JWT payload" }).fill('{"sub":"edited"}');
  await expect(page.locator("#header-status")).toContainText("could not be read");
  await expect(token).toHaveText(broken);
  // A Base64 secret pasted while UTF-8 was chosen: rewritten, with the other reading offered.
  await token.fill(sample);
  const base64 = Buffer.from("a-public-example-secret-at-least-32-bytes").toString("base64");
  await page.locator("#secret").fill(base64);
  await expect(page.locator("#signature-state")).toHaveText("Invalid signature");
  await page.locator("#secret-format").selectOption("base64");
  await expect(page.locator("#secret")).toHaveValue(Buffer.from(base64).toString("base64"));
  await page.getByRole("button", { name: "Read it as Base64 instead" }).click();
  await expect(page.locator("#secret")).toHaveValue(base64);
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  await expect(page.locator("#secret-hint")).toBeHidden();
  // A private key in the field for sharing is flagged, though it verifies.
  await page.locator("#algorithm").selectOption("ES256");
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  await page.locator("#public-key").fill(await page.locator("#private-key").inputValue());
  await expect(page.locator("#public-check")).toHaveText(
    "This is the private key: keep it below, and share only the public one"
  );
  await expect(page.locator("#public-check")).toHaveAttribute("data-state", "warn");
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
});

test("Codec rewrites every format live from whichever field is edited", async ({
  page,
  context,
}) => {
  await page.goto("/Tools/codec/");
  const field = (format: string) => page.locator(`#${format} .cm-content`);
  const fill = async (format: string, value: string) => {
    await field(format).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(value);
  };
  await expect(field("base64")).toHaveText("SGVsbG8sIPCfjI0hCg==");
  await fill("text", "Hello 🌍");
  await expect(field("base64")).toHaveText(Buffer.from("Hello 🌍").toString("base64"));
  await expect(field("url")).toHaveText("Hello%20%F0%9F%8C%8D");
  await expect(field("hex")).toHaveText("48 65 6c 6c 6f 20 f0 9f 8c 8d");
  await expect(page.locator("#count")).toHaveText("10 bytes");
  await fill("base64", Buffer.from("Changed").toString("base64"));
  await expect(field("text")).toHaveText("Changed");
  await expect(field("base64url")).toHaveText("Q2hhbmdlZA");
  // Half-typed hex: the error beside its name, the others kept and dimmed.
  await fill("hex", "ff0");
  await expect(page.locator("#hex-note")).toContainText("complete pairs");
  await expect(page.locator("#text-card")).toHaveAttribute("data-stale", "");
  await expect(field("text")).toHaveText("Changed");
  await page.keyboard.insertText("0");
  await expect(page.locator("#text-card")).not.toHaveAttribute("data-stale");
  await expect(page.locator("#text-note")).toContainText("Not valid UTF-8");
  await expect(field("text")).toHaveText("");
  await expect(page.locator("#text-copy")).toBeDisabled();
  await expect(field("url")).toHaveText("%FF%00");
  await expect(field("base64")).toHaveText("/wA=");
  await fill("url", "a+b%20c");
  await expect(field("text")).toHaveText("a+b c");
  // Invisible characters are drawn, and a Windows line break stays two bytes.
  await page.locator("#examples").selectOption({ label: "Invisible characters" });
  const invisible = "ef bb bf 6c 69 6e 65 20 31 0d 0a 6c 69 6e 65 20 32 09 00";
  await expect(field("hex")).toHaveText(invisible);
  await expect(page.locator("#text .cm-specialChar")).toHaveText(["U+FEFF", "\u240d", "\u2400"]);
  // The draft survives a reload; a new tab starts from the first example.
  await page.reload();
  await expect(field("hex")).toHaveText(invisible);
  const fresh = await context.newPage();
  await fresh.goto("/Tools/codec/");
  await expect(fresh.locator("#base64 .cm-content")).toHaveText("SGVsbG8sIPCfjI0hCg==");
  await fresh.close();
  await page.locator("#clear").click();
  for (const format of ["text", "url", "base64", "base64url", "hex"])
    await expect(field(format)).toHaveText("");
  await expect(page.locator("#count")).toHaveText("0 bytes");
});

test("Digests computes live text/file/HMAC and compares exact outputs", async ({ page }) => {
  await page.goto("/Tools/digests/");
  await page.locator("#text").fill("abc\n");
  await expect(page.locator("#hex")).toHaveText(createHash("sha256").update("abc\n").digest("hex"));
  await page.locator("#text").fill("abc");
  const expected = createHash("sha256").update("abc").digest("hex");
  await expect(page.locator("#hex")).toHaveText(expected);
  await page.locator("#expected").fill(expected.toUpperCase());
  await expect(page.locator("#compare-status")).toHaveText("Digest matches.");
  const geometry = await page.locator("#base64").boundingBox();
  await page.locator("#algorithm").selectOption("SHA-512");
  await expect(page.locator("#hex")).toHaveText(createHash("sha512").update("abc").digest("hex"));
  expect(await page.locator("#base64").boundingBox()).toEqual(geometry);
  await page.locator("#algorithm").selectOption("SHA-256");
  await page.locator("#hmac").check();
  await page.locator("#key").fill("test key");
  await expect(page.locator("#hex")).toHaveText(
    createHmac("sha256", "test key").update("abc").digest("hex")
  );
  await expect(page.locator("#compare-status")).toHaveText("Digest does not match.");
  await page.locator("#key").fill("");
  await expect(page.locator("#status")).toContainText("non-empty");
  await expect(page.locator("#copy-hex")).toBeDisabled();
  expect(await page.locator("#base64").boundingBox()).toEqual(geometry);
  await page.locator("#hmac").uncheck();
  await page.locator("#source").selectOption("file");
  const bytes = Buffer.from([0, 255, 13, 10]);
  await page
    .locator("#file")
    .setInputFiles({ name: "binary.dat", mimeType: "application/octet-stream", buffer: bytes });
  await expect(page.locator("#hex")).toHaveText(createHash("sha256").update(bytes).digest("hex"));
  await page.reload();
  await expect(page.locator("#file-name")).toContainText("binary.dat");
  await expect(page.locator("#status")).toContainText("Reselect");
  await expect(page.locator("#hex")).toBeEmpty();
  await page.locator("#clear").click();
  await expect(page.locator("#hex")).toHaveText(createHash("sha256").update("").digest("hex"));
});

test("Codes keeps preview geometry stable and exports exact-size independently scannable QR and barcodes", async ({
  page,
}) => {
  await page.goto("/Tools/codes/");
  await expect(page.locator("#preview svg")).toBeVisible();
  const before = await page.locator("#preview").boundingBox();
  await page.locator("#content").fill("https://example.com/🌍");
  await expect(page.locator("#status")).toContainText("export 512");
  expect(await page.locator("#preview").boundingBox()).toEqual(before);
  await page.locator("#resolution").fill("768");
  await expect(page.locator("#status")).toContainText("768 × 768");
  const svgDownload = page.waitForEvent("download");
  await page.locator("#save-svg").click();
  const svg = await readFile((await (await svgDownload).path())!, "utf8");
  expect(svg).toContain('width="768" height="768"');
  await page.locator("#preset").selectOption("wifi");
  await page.locator("#ssid").fill("office;guest");
  await page.locator("#password").fill("test-password");
  const wifi = "WIFI:T:WPA;S:office\\;guest;P:test-password;H:false;;";
  await expect(page.locator("#encoded")).toHaveText(wifi);
  async function pixels() {
    const downloaded = page.waitForEvent("download");
    await page.locator("#save-png").click();
    const png = await readFile((await (await downloaded).path())!);
    return page.evaluate(async (base64) => {
      const image = new Image();
      image.src = "data:image/png;base64," + base64;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      return {
        width: image.width,
        height: image.height,
        data: Array.from(ctx.getImageData(0, 0, image.width, image.height).data),
      };
    }, png.toString("base64"));
  }
  const qr = await pixels();
  expect(qr.width).toBe(768);
  expect(jsQR(new Uint8ClampedArray(qr.data), qr.width, qr.height)?.data).toBe(wifi);
  await page.locator("#qr-options summary").click();
  await page.locator("#margin").fill("3");
  await expect(page.locator("#status")).toContainText("Margin must");
  await expect(page.locator("#save-svg")).toBeDisabled();
  expect(await page.locator("#preview").boundingBox()).toEqual(before);
  for (const [kind, content, expected, format] of [
    ["code128", "TOOLS-2026", "TOOLS-2026", BarcodeFormat.CODE_128],
    ["ean13", "400638133393", "4006381333931", BarcodeFormat.EAN_13],
    ["upca", "03600029145", "036000291452", BarcodeFormat.UPC_A],
  ] as const) {
    await page.locator("#kind").selectOption(kind);
    await page.locator("#content").fill(content);
    await expect(page.locator("#encoded")).toHaveText(expected);
    const image = await pixels();
    const gray = new Uint8ClampedArray(image.width * image.height);
    for (let i = 0; i < gray.length; i++) gray[i] = image.data[i * 4];
    const reader = new MultiFormatReader();
    expect(
      reader
        .decode(
          new BinaryBitmap(
            new HybridBinarizer(new RGBLuminanceSource(gray, image.width, image.height))
          ),
          new Map([[DecodeHintType.POSSIBLE_FORMATS, [format]]])
        )
        .getText()
    ).toBe(expected);
  }
});

for (const [slug, field, value] of [
  ["codes", "#content", "remember codes"],
  ["digests", "#text", "remember digests"],
  ["jwt", "#secret", "remember jwt"],
] as const) {
  test(
    slug + " draft survives reload but a fresh tab starts independently",
    async ({ page, context }) => {
      await page.goto("/Tools/" + slug + "/");
      if (slug === "jwt")
        await expect(page.locator("#signature-state")).toHaveText("Signature verified");
      await page.locator(field).fill(value);
      await page.reload();
      await expect(page.locator(field)).toHaveValue(value);
      const fresh = await context.newPage();
      await fresh.goto("/Tools/" + slug + "/");
      await expect(fresh.locator(field)).not.toHaveValue(value);
      await fresh.close();
    }
  );
}
test("incompatible drafts fail closed without overwriting saved data", async ({ page }) => {
  await page.goto("/Tools/codec/");
  const saved = JSON.stringify({ version: 999, value: { left: "old version" } });
  await page.evaluate((value) => sessionStorage.setItem("tools.codec.draft", value), saved);
  await page.reload();
  await expect(page.locator("#status")).toContainText("Clear this app's session storage");
  await page.locator("#text .cm-content").click();
  await page.keyboard.insertText("do not overwrite");
  await expect(page.locator("#base64 .cm-content")).toHaveText(
    Buffer.from("do not overwrite").toString("base64")
  );
  expect(await page.evaluate(() => sessionStorage.getItem("tools.codec.draft"))).toBe(saved);
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
            // The name in full takes only the room to spare: cut short, it needs none.
            (child.matches(".ui-app-title") ? 0 : child.getBoundingClientRect().width) +
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
    await expect(page.locator("#help")).toContainText(findApp(slug)!.name + " is part of a set");
    await expect(page.locator("#help-close")).toHaveCount(0);
    await page.locator("#help-toggle").click();
    await expect(page.locator("#help")).toBeHidden();
    expect(errors).toEqual([]);
    const compactHome = findApp(slug)!.compactHome;
    if (compactHome) {
      await page.setViewportSize({ width: compactHome + 1, height: 900 });
      await expect(page.locator(".ui-home-label")).not.toHaveCSS("position", "absolute");
      await page.setViewportSize({ width: compactHome, height: 900 });
      await expect(page.locator(".ui-home-label")).toHaveCSS("position", "absolute");
      await expect(page.locator(".ui-app-name")).not.toHaveCSS("position", "absolute");
      expect(await page.locator("header").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(
        true
      );
    }
    await page.setViewportSize({ width: findApp(slug)!.compactHeader!, height: 900 });
    await expect(page.locator(".ui-app-name")).toHaveCSS("position", "absolute");
    expect(await page.locator("header").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({ path: `test-results/${slug}-phone.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    if (slug === "codes") {
      await page.locator("#content").fill("https://example.com/");
      await expect(page.locator("#preview svg")).toBeVisible();
    }
    if (slug === "digests") {
      await page.locator("#text").fill("Hello, world!");
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.locator(".grid").boundingBox())!.width).toBeGreaterThan(1300);
  await page.screenshot({ path: "test-results/home-desktop.png", fullPage: true });
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
    await expect(page.locator(".ui-app-name")).toHaveText(findApp(slug)!.name);
    await expect(page.locator("main")).toBeVisible();
  }
});
