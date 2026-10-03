import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
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
  QRCodeReader,
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
  await expect(page.getByRole("button", { name: "Clear token" })).toHaveCount(0);
  await token.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
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

for (const edit of ["key", "algorithm"] as const) {
  test(`JWT discards pending key generation after editing the ${edit}`, async ({ page }) => {
    await page.goto("/Tools/jwt/");
    await page.locator("#algorithm").selectOption("RS256");
    await expect(page.locator("#private-key")).toHaveValue(/BEGIN PRIVATE KEY/);
    await expect(page.locator("#signature-state")).toHaveText("Signature verified");
    await page.evaluate(() => {
      const original = crypto.subtle.generateKey.bind(crypto.subtle);
      crypto.subtle.generateKey = (async (...args: Parameters<SubtleCrypto["generateKey"]>) => {
        crypto.subtle.generateKey = original;
        document.documentElement.dataset.generating = "true";
        await new Promise<void>((resolve) => {
          document.addEventListener("test-release-generation", () => resolve(), { once: true });
        });
        return original(...args);
      }) as SubtleCrypto["generateKey"];
    });
    await page.locator("#generate-key").click();
    await expect(page.locator("html")).toHaveAttribute("data-generating", "true");
    if (edit === "key") await page.locator("#private-key").fill("newly pasted key");
    else {
      await page.locator("#algorithm").selectOption("ES256");
      await expect(
        page.getByRole("textbox", { name: "JSON Web Token", exact: true })
      ).toContainText(Buffer.from('{"alg":"ES256","typ":"JWT"}').toString("base64url"));
      await expect(page.locator("#private-check")).toHaveText("Valid private key");
      await expect(page.locator("#signature-state")).toHaveText("Signature verified");
    }
    const key = await page.locator("#private-key").inputValue();
    const token = await page
      .getByRole("textbox", { name: "JSON Web Token", exact: true })
      .innerText();
    await page.evaluate(() => document.dispatchEvent(new Event("test-release-generation")));
    await expect(page.locator("#generate-key")).toBeEnabled();
    await expect(page.locator("#private-key")).toHaveValue(key);
    await expect(page.getByRole("textbox", { name: "JSON Web Token", exact: true })).toHaveText(
      token
    );
  });
}

test("JWT says why a key could not be made, and the token still follows its edits", async ({
  page,
}) => {
  await page.goto("/Tools/jwt/");
  await expect(page.locator("#signature-state")).toHaveText("Signature verified");
  await page.evaluate(() => {
    crypto.subtle.generateKey = (() =>
      Promise.reject(new Error("No keys here."))) as SubtleCrypto["generateKey"];
  });
  const token = page.getByRole("textbox", { name: "JSON Web Token", exact: true });
  // An algorithm with no key: the key fails, the header and token follow the algorithm anyway.
  await page.locator("#algorithm").selectOption("EdDSA");
  await expect(page.locator("#key-status")).toHaveText("No keys here.");
  await expect(token).toContainText(
    Buffer.from('{"alg":"EdDSA","typ":"JWT"}').toString("base64url")
  );
  await expect(page.locator("#generate-key")).toBeEnabled();
  // A key that fails right after an edit leaves that edit's rebuild in place.
  await page.getByRole("textbox", { name: "Decoded JWT payload" }).fill('{"sub":"edited"}');
  await page.locator("#generate-key").click();
  await expect(token).toContainText(Buffer.from('{"sub":"edited"}').toString("base64url"));
  await expect(page.locator("#key-status")).toHaveText("No keys here.");
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
    if (value) await page.keyboard.insertText(value);
    else await page.keyboard.press("Backspace");
  };
  const sample = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("tools.codec.draft")!).value.value as string
  );
  expect(sample).toContain("中文");
  expect(sample).toContain("\u0301");
  expect(sample).toContain("\u200b");
  await expect(field("base64")).toHaveText(Buffer.from(sample).toString("base64"));
  await expect(page.locator("#hex-card .ui-row #count")).toHaveText(
    Buffer.byteLength(sample) + " bytes"
  );
  await expect(page.getByRole("button", { name: "Clear all" })).toHaveCount(0);
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
  await fill("hex", "ef bb bf 6c 69 6e 65 20 31 0d 0a 6c 69 6e 65 20 32 09 00");
  const invisible = "ef bb bf 6c 69 6e 65 20 31 0d 0a 6c 69 6e 65 20 32 09 00";
  await expect(field("hex")).toHaveText(invisible);
  await expect(page.locator("#text .cm-specialChar")).toHaveText(["U+FEFF", "\u240d", "\u2400"]);
  // The draft survives a reload; a new tab starts from the default example.
  await page.reload();
  await expect(field("hex")).toHaveText(invisible);
  const fresh = await context.newPage();
  await fresh.goto("/Tools/codec/");
  await expect(fresh.locator("#base64 .cm-content")).toHaveText(
    Buffer.from(sample).toString("base64")
  );
  await fresh.close();
  await fill("text", "");
  for (const format of ["text", "url", "base64", "base64url", "hex"])
    await expect(field(format)).toHaveText("");
  await expect(page.locator("#count")).toHaveText("0 bytes");
});

test("Digests hashes text and files with every SHA, HMAC, and names the digest that matches", async ({
  page,
}) => {
  await page.goto("/Tools/digests/");
  // A new tab starts on the example sentence.
  const fox = "The quick brown fox jumps over the lazy dog";
  await expect(page.locator("#sha-256")).toHaveText(createHash("sha256").update(fox).digest("hex"));
  await expect(page.locator("#status")).toHaveText("43 B");
  const text = page.locator("#text .cm-content");
  await text.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("abc\n");
  await expect(page.locator("#sha-256")).toHaveText(
    createHash("sha256").update("abc\n").digest("hex")
  );
  await page.keyboard.press("Backspace");
  for (const [name, node] of [
    ["sha-256", "sha256"],
    ["sha-384", "sha384"],
    ["sha-512", "sha512"],
    ["sha-1", "sha1"],
  ])
    await expect(page.locator("#" + name)).toHaveText(createHash(node).update("abc").digest("hex"));
  const lines = await page
    .locator("#sha-1-item")
    .evaluate((e: HTMLElement) => [e.offsetTop, e.offsetHeight]);
  await page
    .locator("#expected")
    .fill(createHash("sha384").update("abc").digest("hex").toUpperCase());
  await expect(page.locator("#compare-status")).toHaveText("Matches SHA-384.");
  await expect(page.locator("#sha-384-item")).toHaveAttribute("data-match", "");
  await expect(page.locator("#sha-384-note")).toHaveText("Matches.");
  await page.locator('[data-encoding="base64"]').click();
  await expect(page.locator("#sha-256")).toHaveText(
    createHash("sha256").update("abc").digest("base64")
  );
  await expect(page.locator("#sha-384-item")).toHaveAttribute("data-match", "");
  expect(
    await page.locator("#sha-1-item").evaluate((e: HTMLElement) => [e.offsetTop, e.offsetHeight])
  ).toEqual(lines);
  await page.locator('[data-encoding="hex"]').click();
  await page.locator("#hmac").click();
  await expect(page.locator("#hmac")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#status")).toContainText("non-empty");
  await expect(page.locator("#sha-256-title")).toHaveText("HMAC-SHA-256");
  await expect(page.locator("#sha-256-copy")).toBeDisabled();
  await page.locator("#key").fill("test key");
  await expect(page.locator("#sha-256")).toHaveText(
    createHmac("sha256", "test key").update("abc").digest("hex")
  );
  await expect(page.locator("#sha-512")).toHaveText(
    createHmac("sha512", "test key").update("abc").digest("hex")
  );
  await expect(page.locator("#compare-status")).toHaveText("Matches none of these digests.");
  await page.locator("#hmac").click();
  await expect(page.locator("#hmac")).toHaveAttribute("aria-checked", "false");
  const bytes = Buffer.from([0, 255, 13, 10]);
  await page
    .locator("#file")
    .setInputFiles({ name: "binary.dat", mimeType: "application/octet-stream", buffer: bytes });
  await expect(page.locator('[data-source="file"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sha-256")).toHaveText(
    createHash("sha256").update(bytes).digest("hex")
  );
  await expect(page.locator("#status")).toHaveText("4 B");
  await page.reload();
  await expect(page.locator("#file-name")).toContainText("binary.dat");
  await expect(page.locator("#status")).toContainText("Choose the file again");
  await expect(page.locator("#sha-256")).toBeEmpty();
  await page.locator('[data-source="text"]').click();
  await expect(page.locator("#sha-256")).toHaveText(
    createHash("sha256").update("abc").digest("hex")
  );
  await page.locator("#clear").click();
  await expect(page.locator("#sha-256")).toHaveText(createHash("sha256").update("").digest("hex"));
});

/** Sets a colour through its swatch and the shared picker: hex, then opacity in percent. */
async function pickColour(page: Page, id: string, hex: string, opacity?: number) {
  await page.locator(`#${id}-swatch`).click();
  const picker = page.locator(".color-popover");
  await expect(picker).toBeVisible();
  await picker.locator(".cp-hex").fill(hex);
  await picker.locator(".cp-hex").press("Enter");
  if (opacity !== undefined) {
    await picker.locator(".cp-alpha-num").fill(String(opacity));
    await picker.locator(".cp-alpha-num").press("Enter");
  }
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
}

/** Reads the pixels of a downloaded PNG in the page. */
async function downloadedPixels(page: Page, button = "#save-png") {
  const downloaded = page.waitForEvent("download");
  await page.locator(button).click();
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
/**
 * What a QR code in the image says, read by jsQR or, if it cannot, by ZXing, which reads styled
 * codes (dots, round corners) as phone scanners do. Transparent pixels count as white.
 */
function scanQr(image: { width: number; height: number; data: number[] }): string | undefined {
  const found = jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data;
  if (found) return found;
  const gray = new Uint8ClampedArray(image.width * image.height);
  for (let i = 0; i < gray.length; i++) {
    const alpha = image.data[i * 4 + 3] / 255;
    gray[i] = image.data[i * 4] * alpha + 255 * (1 - alpha);
  }
  try {
    return new QRCodeReader()
      .decode(
        new BinaryBitmap(
          new HybridBinarizer(new RGBLuminanceSource(gray, image.width, image.height))
        ),
        new Map([[DecodeHintType.TRY_HARDER, true]])
      )
      .getText();
  } catch {
    return undefined;
  }
}

test("Codes makes each kind of content, keeps the preview in place and exports scannable codes", async ({
  page,
}) => {
  await page.goto("/Tools/codes/");
  await page.locator("#reset-design").click();
  await expect(page.locator("#preview > svg")).toBeVisible();
  const before = await page.locator("#preview").boundingBox();
  await page.locator("#link-url").fill("example.com/🌍");
  await expect(page.locator("#encoded")).toHaveText("https://example.com/🌍");
  await expect(page.locator("#status")).toContainText("1023 × 1023");
  expect(await page.locator("#preview").boundingBox()).toEqual(before);
  await page.locator("#size").selectOption("s");
  await expect(page.locator("#status")).toContainText("528 × 528");
  await expect(page.locator("#size option:checked")).toHaveText("S · 528 px");
  const svgDownload = page.waitForEvent("download");
  await page.locator("#save-svg").click();
  const svg = await readFile((await (await svgDownload).path())!, "utf8");
  expect(svg).toContain('width="528" height="528" viewBox="0 0 33 33"');
  expect(svg).not.toMatch(/\d\.\d/);
  const plain = await downloadedPixels(page);
  expect(plain.width).toBe(528);
  expect(scanQr(plain)).toBe("https://example.com/🌍");

  const fill = async (type: string, values: Record<string, string>, encoded: string | RegExp) => {
    await page.locator(`[data-type="${type}"]`).click();
    for (const [id, value] of Object.entries(values)) await page.locator(id).fill(value);
    await expect(page.locator("#encoded")).toHaveText(encoded);
  };
  await fill(
    "email",
    { "#email-to": "a@b.co", "#email-subject": "Hi there" },
    "mailto:a@b.co?subject=Hi%20there"
  );
  await fill("call", { "#call-number": "+44 20 7946 0000" }, "tel:+442079460000");
  await fill("sms", { "#sms-number": "+1 555 0100", "#sms-message": "Hi" }, "SMSTO:+15550100:Hi");
  await fill("whatsapp", { "#wa-number": "+44 7700 900000" }, "https://wa.me/447700900000");
  await fill("vcard", { "#vc-first": "Ada", "#vc-last": "Lovelace" }, /^BEGIN:VCARD/);
  await fill("event", { "#ev-title": "Launch", "#ev-start": "2026-10-02T09:00" }, /^BEGIN:VEVENT/);
  await fill("text", { "#text-content": "Hello, 🌍!" }, "Hello, 🌍!");

  await page.locator('[data-type="wifi"]').click();
  await page.locator("#ssid").fill("office;guest");
  await page.locator("#password").fill("test-password");
  const wifi = "WIFI:T:WPA;S:office\\;guest;P:test-password;H:false;;";
  await expect(page.locator("#encoded")).toHaveText(wifi);
  expect(scanQr(await downloadedPixels(page))).toBe(wifi);
  await page.locator("#ssid").fill("");
  await expect(page.locator("#status")).toContainText("Enter the network name");
  await expect(page.locator("#save-svg")).toBeDisabled();
  expect(await page.locator("#preview").boundingBox()).toEqual(before);

  for (const [kind, content, expected, format] of [
    ["code128", "TOOLS-2026", "TOOLS-2026", BarcodeFormat.CODE_128],
    ["ean13", "400638133393", "4006381333931", BarcodeFormat.EAN_13],
    ["upca", "03600029145", "036000291452", BarcodeFormat.UPC_A],
  ] as const) {
    await page.locator('[data-type="barcode"]').click();
    await expect(page.locator("#tab-shapes")).toBeHidden();
    await page.locator("#symbology").selectOption(kind);
    await page.locator("#barcode-value").fill(content);
    await expect(page.locator("#encoded")).toHaveText(expected);
    const image = await downloadedPixels(page);
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

test("Codes starts on the example, the same code as on the index page", async ({ page }) => {
  await page.goto("/Tools/codes/");
  await expect(page.locator("#link-url")).toHaveValue("https://peterhewat.github.io/Tools/");
  await expect(page.locator("#status")).toContainText("H correction");
  await expect(page.locator("#gradient")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#gradient-kind")).toHaveValue("radial");
  const shown = await page
    .locator("#preview > svg")
    .evaluate((svg) => [...svg.querySelectorAll("path")].map((p) => p.getAttribute("d")));
  const art = await page.evaluate(async () => {
    const text = await (await fetch("/Tools/codes/art.svg")).text();
    const svg = new DOMParser().parseFromString(text, "image/svg+xml").querySelector("svg svg")!;
    return {
      paths: [...svg.querySelectorAll("path")].map((p) => p.getAttribute("d")),
      gradient: [...svg.querySelector("radialGradient")!.querySelectorAll("*")]
        .map((stop) => stop.getAttribute("stop-color"))
        .concat(
          ["cx", "cy", "r"].map((name) => svg.querySelector("radialGradient")!.getAttribute(name))
        ),
    };
  });
  expect(shown).toEqual(art.paths);
  const gradient = await page
    .locator("#preview > svg radialGradient")
    .evaluate((g) =>
      [...g.querySelectorAll("*")]
        .map((stop) => stop.getAttribute("stop-color"))
        .concat(["cx", "cy", "r"].map((name) => g.getAttribute(name)))
    );
  expect(gradient).toEqual(art.gradient);
  expect(scanQr(await downloadedPixels(page))).toBe("https://peterhewat.github.io/Tools/");
});

test("Codes redraws the code in place as it changes, without blinking", async ({ page }) => {
  await page.goto("/Tools/codes/");
  await page.locator("#reset-design").click();
  await expect(page.locator("#status")).toContainText("M correction");
  await page.locator("#tab-logo").click();
  await page.locator('#logo-options [data-value="link"]').click();
  await expect(page.locator("#status")).toContainText("H correction");
  // Watch the preview: it is never dimmed or emptied, and the logo image is never replaced.
  await page.evaluate(() => {
    const preview = document.querySelector("#preview")!;
    const marked = window as unknown as { blinks: number };
    marked.blinks = 0;
    new MutationObserver((changes) => {
      for (const change of changes)
        if (change.type === "attributes" || change.removedNodes.length) marked.blinks++;
    }).observe(preview, { attributes: true, attributeFilter: ["class"], childList: true });
    Object.assign(preview.querySelector("svg svg")!, { kept: true });
  });
  await page.locator("#tab-shapes").click();
  await page.locator('#module-options [data-value="dots"]').click();
  await page.locator('#eye-frame-options [data-value="circle"]').click();
  await page.locator("#tab-colours").click();
  await page.locator("#gradient").click();
  await expect(page.locator("#gradient")).toHaveAttribute("aria-checked", "true");
  await page.locator("#link-url").fill("https://example.org/");
  await expect(page.locator("#encoded")).toHaveText("https://example.org/");
  await pickColour(page, "fg", "#a0306e");
  await expect(page.locator("#preview svg svg circle")).toHaveAttribute("fill", "#a0306e");
  await expect(page.locator("#preview > svg > path").nth(1)).toHaveAttribute("fill", "url(#g0)");
  expect(
    await page.evaluate(() => ({
      blinks: (window as unknown as { blinks: number }).blinks,
      kept: (document.querySelector("#preview svg svg") as unknown as { kept?: boolean }).kept,
    }))
  ).toEqual({ blinks: 0, kept: true });
  await expect(page.locator("#save-png")).toBeEnabled();
});

test("Codes designs: shapes, colours, a logo and a frame still scan", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/Tools/codes/");
  await page.locator("#reset-design").click();
  await page.locator("#link-url").fill("https://example.com/");
  // Small enough to decode quickly, large enough for several pixels a module.
  await page.locator("#size").selectOption("s");
  await page.locator("#tab-shapes").click();
  const designs: [string, string, string][] = [
    ["rounded", "rounded", "rounded"],
    ["dots", "circle", "circle"],
    ["soft", "leaf", "leaf"],
    ["diamond", "square", "diamond"],
    ["vertical", "rounded", "square"],
    ["horizontal", "circle", "rounded"],
  ];
  for (const [modules, frame, ball] of designs) {
    await page.locator(`#module-options [data-value="${modules}"]`).click();
    await page.locator(`#eye-frame-options [data-value="${frame}"]`).click();
    await page.locator(`#eye-ball-options [data-value="${ball}"]`).click();
    await expect(page.locator(`#module-options [data-value="${modules}"]`)).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.locator("#save-png")).toBeEnabled();
    expect(scanQr(await downloadedPixels(page)), modules).toBe("https://example.com/");
  }
  // Each tab is as tall as what it holds; an option turned on opens beside its box.
  const height = async () => (await page.locator(".codes-build").boundingBox())!.height;
  const shapes = await height();
  await page.locator("#tab-colours").click();
  const settled = await height();
  expect(settled).toBeLessThan(shapes);
  await pickColour(page, "fg", "#3a1c71");
  await page.locator("#gradient").click();
  await expect(page.locator("#gradient")).toHaveAttribute("aria-checked", "true");
  await page.locator("#eye-own").click();
  await expect(page.locator("#eye-own")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#gradient-to-swatch")).toBeVisible();
  expect(await height()).toBe(settled);
  await pickColour(page, "eye-color", "#b3122e");
  await expect(page.locator("#warnings")).toBeEmpty();
  await page.locator("#tab-logo").click();
  await page.locator('#logo-options [data-value="wifi"]').click();
  await expect(page.locator("#level")).toBeDisabled();
  await expect(page.locator("#status")).toContainText("H correction");
  await page.locator("#tab-frame").click();
  await page.locator('#frame-options [data-value="below"]').click();
  const lineOf = async (id: string) => (await page.locator(id).boundingBox())!;
  const [caption, text, frame] = [
    await lineOf("#caption"),
    await lineOf("#caption-color-swatch"),
    await lineOf("#frame-color-swatch"),
  ];
  expect([text.y, frame.y, text.height, frame.height]).toEqual([
    caption.y,
    caption.y,
    caption.height,
    caption.height,
  ]);
  await page.locator('#frame-options [data-value="outline"]').click();
  await expect(page.locator("#caption-color")).toHaveValue("#000000");
  await page.locator('#frame-options [data-value="below"]').click();
  await expect(page.locator("#caption-color")).toHaveValue("#ffffff");
  const framed = await downloadedPixels(page);
  expect(framed.height).toBeGreaterThan(framed.width);
  expect(scanQr(framed)).toBe("https://example.com/");
  // An uploaded logo, kept with the draft.
  await page.locator("#tab-logo").click();
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#logo-upload").click();
  const logo = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#c00"/></svg>'
  );
  await (await chooser).setFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: logo });
  await expect(page.locator('#logo-options [data-value="upload"]')).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.locator("#preview svg image")).toHaveCount(1);
  expect(scanQr(await downloadedPixels(page))).toBe("https://example.com/");
  await page.reload();
  await expect(page.locator('#logo-options [data-value="upload"]')).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  // Poor colours are flagged, and reset brings back the plain code.
  await page.locator("#tab-colours").click();
  await page.locator("#gradient").click();
  await expect(page.locator("#gradient")).toHaveAttribute("aria-checked", "false");
  await pickColour(page, "fg", "#bbbbbb");
  await expect(page.locator("#warnings")).toContainText("Low contrast");
  await page.locator("#reset-design").click();
  await expect(page.locator("#warnings")).toBeEmpty();
  // Without the logo, error correction is the level chosen before it, not H.
  await expect(page.locator("#level")).toBeEnabled();
  await expect(page.locator("#level")).toHaveValue("M");
  await expect(page.locator("#status")).toContainText(/ (\d+) × \1 px/);
  // A background at 0% opacity is transparent: no background drawn, clear pixels in the PNG.
  await pickColour(page, "bg", "#ffffff", 0);
  await expect(page.locator("#bg")).toHaveValue("#ffffff00");
  await expect(page.locator("#warnings")).toContainText("Transparent");
  await expect(page.locator("#preview svg > rect")).toHaveCount(0);
  const clear = await downloadedPixels(page);
  expect(clear.data[3]).toBe(0);
  expect(scanQr(clear)).toBe("https://example.com/");
});

for (const [slug, field, value] of [
  ["codes", "#link-url", "example.org/remember"],
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
test("Codec and Digests open each other on the same text", async ({ page }) => {
  await page.goto("/Tools/digests/");
  await page.locator("#text .cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("Grüße");
  await page.locator("#to-codec").click();
  await expect(page).toHaveURL(/\/codec\/$/);
  await expect(page.locator("#hex .cm-content")).toHaveText("47 72 c3 bc c3 9f 65");
  await page.locator("#text .cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("hello");
  await page.locator("#to-digests").click();
  await expect(page).toHaveURL(/\/digests\/$/);
  await expect(page.locator("#sha-256")).toHaveText(
    createHash("sha256").update("hello").digest("hex")
  );
});
test("digests draft survives reload; a fresh tab starts on the example; an incompatible draft is kept", async ({
  page,
  context,
}) => {
  await page.goto("/Tools/digests/");
  await page.locator("#text .cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("remember digests");
  await expect(page.locator("#sha-256")).toHaveText(
    createHash("sha256").update("remember digests").digest("hex")
  );
  await page.reload();
  await expect(page.locator("#text .cm-content")).toHaveText("remember digests");
  const fresh = await context.newPage();
  await fresh.goto("/Tools/digests/");
  await expect(fresh.locator("#text .cm-content")).toHaveText(
    "The quick brown fox jumps over the lazy dog"
  );
  await fresh.close();
  const saved = JSON.stringify({ version: 999, value: {} });
  await page.evaluate((value) => sessionStorage.setItem("tools.digests.draft", value), saved);
  await page.reload();
  await expect(page.locator("#draft-status")).toContainText("Clear this app's session storage");
  await page.locator("#text .cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("still works");
  await expect(page.locator("#sha-256")).toHaveText(
    createHash("sha256").update("still works").digest("hex")
  );
  expect(await page.evaluate(() => sessionStorage.getItem("tools.digests.draft"))).toBe(saved);
});
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

for (const [slug, field, value, result] of [
  ["codes", "#link-url", "example.org/still-works", "#encoded"],
] as const) {
  test(`${slug} works without saving over an incompatible draft`, async ({ page }) => {
    await page.goto(`/Tools/${slug}/`);
    const saved = JSON.stringify({ version: 999, value: {} });
    await page.evaluate(
      ([slug, value]) => sessionStorage.setItem(`tools.${slug}.draft`, value),
      [slug, saved]
    );
    await page.reload();
    await expect(page.locator("#draft-status")).toContainText("Clear this app's session storage");
    await page.locator(field).fill(value);
    await expect(page.locator(result)).toHaveText("https://" + value);
    expect(await page.evaluate((slug) => sessionStorage.getItem(`tools.${slug}.draft`), slug)).toBe(
      saved
    );
  });
}

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
    const compactHeader = findApp(slug)!.compactHeader;
    if (compactHeader !== false) expect(compactHeader).toBeGreaterThanOrEqual(headerWidth);
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
    if (compactHeader === false) {
      for (const width of [274, 240, 217]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator(".ui-app-name")).not.toHaveCSS("position", "absolute");
        await expect(page.locator(".ui-app-title")).not.toHaveCSS("position", "absolute");
        expect((await page.locator(".ui-app-title").boundingBox())!.width).toBeGreaterThan(0);
        expect(await page.locator("header").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(
          true
        );
      }
    } else {
      await page.setViewportSize({ width: compactHeader!, height: 900 });
      await expect(page.locator(".ui-app-name")).toHaveCSS("position", "absolute");
      expect(await page.locator("header").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(
        true
      );
    }
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({ path: `test-results/${slug}-phone.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    if (slug === "codes") {
      await page.locator("#link-url").fill("https://example.com/");
      await expect(page.locator("#preview > svg")).toBeVisible();
    }
    if (slug === "digests") await expect(page.locator("#sha-256")).not.toBeEmpty();
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
