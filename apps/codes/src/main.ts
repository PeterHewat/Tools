import {
  ICONS,
  bindToolHelp,
  byId,
  downloadBlob,
  downloadText,
  escapeAttr,
  fieldValues,
  iconSvg,
  onFileDrop,
  pickFiles,
  readDraft,
  registerServiceWorker,
  restoreFields,
  setPressed,
  showMessage,
  writeDraft,
} from "@tools/ui";
import type { IconName } from "@tools/ui";
import { encodeQr } from "./lib/qr.js";
import type { Level } from "./lib/qr.js";
import { encodeBarcode } from "./lib/barcode.js";
import type { BarcodeKind } from "./lib/barcode.js";
import {
  emailContent,
  eventContent,
  linkContent,
  phoneContent,
  smsContent,
  textContent,
  vcardContent,
  whatsappContent,
  wifiContent,
} from "./lib/content.js";
import {
  DEFAULT_DESIGN,
  EYE_BALLS,
  EYE_FRAMES,
  FRAMES,
  GRADIENTS,
  contrast,
  MODULE_SHAPES,
  PathData,
  barcodeScene,
  colourWarnings,
  eyeBall,
  eyeFrame,
  modulesPath,
  qrScene,
} from "./lib/design.js";
import type { Design, Logo, Measure, Scene } from "./lib/design.js";
import { SIZES, drawScene, exportSize, sceneSvg } from "./lib/render.js";
import type { Size, SizeName } from "./lib/render.js";

bindToolHelp("codes");
registerServiceWorker();

const TYPES = [
  "link",
  "text",
  "email",
  "call",
  "sms",
  "whatsapp",
  "wifi",
  "vcard",
  "event",
  "barcode",
] as const;
type ContentType = (typeof TYPES)[number];
const TABS = ["colours", "shapes", "logo", "frame"] as const;
const LOGOS: readonly IconName[] = [
  "link",
  "mail",
  "phone",
  "message",
  "chat",
  "wifi",
  "contact",
  "calendar",
];
const SYMBOLOGIES: readonly BarcodeKind[] = ["code128", "ean13", "upca"];
const LEVELS: readonly Level[] = ["L", "M", "Q", "H"];
const SIZE_NAMES = Object.keys(SIZES) as SizeName[];

/** What this tab keeps in its draft: every field, read back one by one. */
const ids = [
  "type",
  "link-url",
  "text-content",
  "email-to",
  "email-subject",
  "email-body",
  "call-number",
  "sms-number",
  "sms-message",
  "wa-number",
  "wa-message",
  "ssid",
  "security",
  "password",
  "hidden-network",
  "vc-first",
  "vc-last",
  "vc-org",
  "vc-title",
  "vc-mobile",
  "vc-phone",
  "vc-email",
  "vc-website",
  "vc-street",
  "vc-city",
  "vc-region",
  "vc-postcode",
  "vc-country",
  "vc-note",
  "ev-title",
  "ev-start",
  "ev-end",
  "ev-location",
  "ev-description",
  "symbology",
  "barcode-value",
  "design-tab",
  "fg",
  "bg",
  "transparent",
  "gradient",
  "gradient-to",
  "gradient-kind",
  "eye-own",
  "eye-color",
  "module-shape",
  "eye-frame",
  "eye-ball",
  "logo",
  "frame",
  "caption",
  "caption-color",
  "frame-color",
  "size",
  "level",
];
const DESIGN_DEFAULTS: Record<string, string | boolean> = {
  fg: "#000000",
  bg: "#ffffff",
  transparent: false,
  gradient: false,
  "gradient-to": "#1f6feb",
  "gradient-kind": "diagonal",
  "eye-own": false,
  "eye-color": "#1f6feb",
  "module-shape": "square",
  "eye-frame": "square",
  "eye-ball": "square",
  logo: "none",
  frame: "none",
  caption: "SCAN ME",
  "caption-color": "#ffffff",
  "frame-color": "#000000",
};

const input = (id: string) => byId<HTMLInputElement>(id);
const value = (id: string) => input(id).value;
const checked = (id: string) => input(id).checked;
const oneOf = <T extends string>(options: readonly T[], candidate: string, fallback: T): T =>
  options.includes(candidate as T) ? (candidate as T) : fallback;
const colour = (id: string, fallback: string) =>
  /^#[\da-f]{6}$/i.test(value(id)) ? value(id).toLowerCase() : fallback;

const draft = readDraft("codes", 1);
/** An image the person chose for the logo, downscaled, as a data: URL. */
let upload: Logo | undefined;
if (draft.found && !draft.error) {
  restoreFields(draft.value, ids);
  const saved = draft.value.upload as Partial<Logo> | undefined;
  if (
    typeof saved?.href === "string" &&
    saved.href.startsWith("data:image/") &&
    typeof saved.width === "number" &&
    typeof saved.height === "number"
  )
    upload = { href: saved.href, width: saved.width, height: saved.height };
} else input("link-url").value = "https://example.com/";

const type = (): ContentType => oneOf(TYPES, value("type"), "link");

/** Text widths measured as the page draws them, so a caption fits its frame. */
const measuring = document.createElement("canvas").getContext("2d");
const measure: Measure = (text, size, font, weight) => {
  if (!measuring) return [...text].length * size * 0.62;
  measuring.font = `${weight} 100px ${font}`;
  return (measuring.measureText(text).width * size) / 100;
};

/** A preset logo: the icon in white on a disc of the code's colour. */
function presetLogo(name: IconName, fill: string): Logo {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="12" fill="${escapeAttr(fill)}"/>` +
    `<g transform="translate(5 5) scale(0.5833)" color="#ffffff">${ICONS[name]}</g></svg>`;
  return { href: "data:image/svg+xml," + encodeURIComponent(svg), width: 24, height: 24 };
}

function design(): Design {
  const foreground = colour("fg", "#000000");
  const logoName = value("logo");
  const logo =
    logoName === "upload"
      ? upload
      : LOGOS.includes(logoName as IconName)
        ? presetLogo(logoName as IconName, foreground)
        : undefined;
  return {
    foreground,
    background: colour("bg", "#ffffff"),
    transparent: checked("transparent"),
    ...(checked("gradient")
      ? {
          gradient: {
            to: colour("gradient-to", "#1f6feb"),
            kind: oneOf(GRADIENTS, value("gradient-kind"), "diagonal"),
          },
        }
      : {}),
    ...(checked("eye-own") ? { eyeColor: colour("eye-color", foreground) } : {}),
    modules: oneOf(MODULE_SHAPES, value("module-shape"), "square"),
    eyeFrame: oneOf(EYE_FRAMES, value("eye-frame"), "square"),
    eyeBall: oneOf(EYE_BALLS, value("eye-ball"), "square"),
    ...(logo ? { logo } : {}),
    frame: oneOf(FRAMES, value("frame"), "none"),
    caption: value("caption"),
    captionColor: colour("caption-color", "#ffffff"),
    frameColor: colour("frame-color", "#000000"),
  };
}

/** What the QR code holds, from the fields of its type. */
function content(kind: Exclude<ContentType, "barcode">): string {
  switch (kind) {
    case "link":
      return linkContent(value("link-url"));
    case "text":
      return textContent(value("text-content"));
    case "email":
      return emailContent(value("email-to"), value("email-subject"), value("email-body"));
    case "call":
      return phoneContent(value("call-number"));
    case "sms":
      return smsContent(value("sms-number"), value("sms-message"));
    case "whatsapp":
      return whatsappContent(value("wa-number"), value("wa-message"));
    case "wifi":
      return wifiContent(
        value("ssid"),
        value("password"),
        oneOf(["WPA", "WEP", "nopass"] as const, value("security"), "WPA"),
        checked("hidden-network")
      );
    case "vcard":
      return vcardContent({
        first: value("vc-first"),
        last: value("vc-last"),
        organization: value("vc-org"),
        title: value("vc-title"),
        mobile: value("vc-mobile"),
        phone: value("vc-phone"),
        email: value("vc-email"),
        website: value("vc-website"),
        street: value("vc-street"),
        city: value("vc-city"),
        region: value("vc-region"),
        postcode: value("vc-postcode"),
        country: value("vc-country"),
        note: value("vc-note"),
      });
    case "event":
      return eventContent({
        title: value("ev-title"),
        location: value("ev-location"),
        description: value("ev-description"),
        // A datetime-local value is read in the browser's time zone.
        start: new Date(value("ev-start")),
        ...(value("ev-end") ? { end: new Date(value("ev-end")) } : {}),
      });
  }
}

/** The text fields of a type: whether any holds something says if anything was entered yet. */
const textFields = (kind: ContentType) => [
  ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    `[data-fields="${kind}"] :is(input:not([type="checkbox"]), textarea)`
  ),
];

// ---------- Choices drawn as small pictures ----------

const SAMPLE = ["11011", "10010", "01111", "11001", "10111"];
const SAMPLE_QR = encodeQr("Tools", "L");
const picture = (viewBox: string, inner: string) =>
  `<svg viewBox="${viewBox}" aria-hidden="true">${inner}</svg>`;
const LABELS: Record<string, string> = {
  square: "Square",
  rounded: "Rounded",
  soft: "Soft squares",
  dots: "Dots",
  diamond: "Diamonds",
  vertical: "Vertical lines",
  horizontal: "Horizontal lines",
  circle: "Circle",
  leaf: "Leaf",
  none: "No frame",
  below: "Caption below",
  above: "Caption above",
  outline: "Outline",
};

interface Choice {
  value: string;
  label: string;
  picture: () => string | Element;
}
/** A row of picture buttons that sets a hidden field; returns what redraws it. */
function choices(
  container: string,
  field: string,
  list: () => readonly Choice[],
  picked?: (value: string) => void
): () => void {
  const draw = () => {
    byId(container).replaceChildren(
      ...list().map((choice) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ui-btn";
        button.dataset.value = choice.value;
        button.title = choice.label;
        button.setAttribute("aria-label", choice.label);
        const shown = choice.picture();
        if (typeof shown === "string") button.innerHTML = shown;
        else button.append(shown);
        setPressed(button, value(field) === choice.value);
        button.addEventListener("click", () => {
          input(field).value = choice.value;
          picked?.(choice.value);
          update();
        });
        return button;
      })
    );
  };
  draw();
  return draw;
}
choices("module-options", "module-shape", () =>
  MODULE_SHAPES.map((shape) => ({
    value: shape,
    label: LABELS[shape],
    picture: () =>
      picture(
        "-5 -5 60 60",
        `<path fill="currentColor" d="${modulesPath(new PathData(10), 5, (x, y) => SAMPLE[y]?.[x] === "1", shape, 0, 0)}"/>`
      ),
  }))
);
choices("eye-frame-options", "eye-frame", () =>
  EYE_FRAMES.map((style) => ({
    value: style,
    label: LABELS[style],
    picture: () => {
      const path = new PathData(10);
      eyeFrame(path, style, "tl", 0, 0);
      eyeBall(path, "square", "tl", 2, 2);
      return picture("-5 -5 80 80", `<path fill="currentColor" fill-rule="evenodd" d="${path}"/>`);
    },
  }))
);
choices("eye-ball-options", "eye-ball", () =>
  EYE_BALLS.map((style) => ({
    value: style,
    label: LABELS[style],
    picture: () => {
      const frame = new PathData(10),
        ball = new PathData(10);
      eyeFrame(frame, "square", "tl", 0, 0);
      eyeBall(ball, style, "tl", 2, 2);
      return picture(
        "-5 -5 80 80",
        `<path fill="currentColor" fill-rule="evenodd" opacity="0.35" d="${frame}"/>` +
          `<path fill="currentColor" d="${ball}"/>`
      );
    },
  }))
);
const image = (href: string) => {
  const element = new Image();
  element.alt = "";
  element.src = href;
  return element;
};
const drawLogos = choices("logo-options", "logo", () => [
  { value: "none", label: "No logo", picture: () => iconSvg("close") },
  ...LOGOS.map((name) => ({
    value: name,
    label: `Logo: ${name}`,
    picture: () => image(presetLogo(name, colour("fg", "#000000")).href),
  })),
  ...(upload
    ? [{ value: "upload", label: "Logo: your image", picture: () => image(upload!.href) }]
    : []),
]);
choices(
  "frame-options",
  "frame",
  () =>
    FRAMES.map((frame) => ({
      value: frame,
      label: LABELS[frame],
      picture: () => {
        const captionColor = frame === "outline" ? "#000000" : "#ffffff";
        const scene = qrScene(SAMPLE_QR, { ...DEFAULT_DESIGN, frame, captionColor }, measure);
        return sceneSvg(scene, exportSize(scene, "xs"));
      },
    })),
  (frame) => {
    // The caption sits on the frame's band, or on the background under an outline: a text
    // colour that would vanish there takes the other one.
    const text = colour("caption-color", "#ffffff"),
      band = colour("frame-color", "#000000"),
      background = checked("transparent") ? "#ffffff" : colour("bg", "#ffffff");
    const under = frame === "outline" ? background : band;
    if (frame !== "none" && contrast(text, under) < 2)
      input("caption-color").value = frame === "outline" ? band : background;
  }
);

// ---------- Showing which fields apply ----------

function selectTab(tab: (typeof TABS)[number], focus = false): void {
  input("design-tab").value = tab;
  for (const name of TABS) {
    const button = byId(`tab-${name}`);
    const on = name === tab;
    button.setAttribute("aria-selected", String(on));
    button.tabIndex = on ? 0 : -1;
    byId(`panel-${name}`).hidden = !on;
    if (on && focus) button.focus();
  }
}

function fields(): void {
  const kind = type(),
    barcode = kind === "barcode";
  for (const button of document.querySelectorAll<HTMLElement>("[data-type]"))
    setPressed(button, button.dataset.type === kind);
  for (const group of document.querySelectorAll<HTMLElement>("[data-fields]"))
    group.hidden = group.dataset.fields !== kind;
  for (const element of document.querySelectorAll<HTMLElement>("[data-qr-only]"))
    element.hidden = barcode;
  for (const tab of ["shapes", "logo", "frame"] as const) byId(`tab-${tab}`).hidden = barcode;
  selectTab(barcode ? "colours" : oneOf(TABS, value("design-tab"), "colours"));
  // Shown beside the box that turns it on, its room kept while off, so nothing moves.
  byId("gradient-fields").classList.toggle("codes-off", !checked("gradient"));
  byId("eye-fields").classList.toggle("codes-off", !checked("eye-own"));
  input("bg").disabled = checked("transparent");
  input("password").disabled = value("security") === "nopass";
  const symbology = oneOf(SYMBOLOGIES, value("symbology"), "code128");
  byId("barcode-label").textContent =
    symbology === "code128"
      ? "Text · printable ASCII"
      : symbology === "ean13"
        ? "Digits · 12 to have the check digit added, 13 to check it"
        : "Digits · 11 to have the check digit added, 12 to check it";
  const logo = value("logo") !== "none";
  const level = byId<HTMLSelectElement>("level");
  level.disabled = logo;
  if (logo) level.value = "H";
  const framed = value("frame") !== "none";
  input("caption").disabled = !framed;
  input("frame-color").disabled = !framed;
  input("caption-color").disabled = !framed;
  for (const [container, field] of [
    ["module-options", "module-shape"],
    ["eye-frame-options", "eye-frame"],
    ["eye-ball-options", "eye-ball"],
    ["logo-options", "logo"],
    ["frame-options", "frame"],
  ])
    for (const button of byId(container).querySelectorAll<HTMLElement>("button"))
      setPressed(button, button.dataset.value === value(field));
}

// ---------- Making the code ----------

/** The code on show, ready to download. */
let current: { scene: Scene; size: Size; svg: string; name: string } | undefined;
let revision = 0,
  timer: ReturnType<typeof setTimeout> | undefined;

function exportsEnabled(enabled: boolean): void {
  byId<HTMLButtonElement>("save-svg").disabled = !enabled;
  byId<HTMLButtonElement>("save-png").disabled = !enabled;
}
function warn(list: readonly string[]): void {
  byId("warnings").replaceChildren(
    ...list.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    })
  );
}

function render(): void {
  const kind = type(),
    look = design();
  try {
    if (textFields(kind).every((field) => !field.value)) {
      current = undefined;
      exportsEnabled(false);
      byId("preview").replaceChildren();
      byId("encoded").textContent = "";
      warn([]);
      showMessage(byId("status"), "Fill in the content to make a code.");
      return;
    }
    let scene: Scene, encoded: string, summary: string, name: string;
    if (kind === "barcode") {
      const symbology = oneOf(SYMBOLOGIES, value("symbology"), "code128");
      const code = encodeBarcode(value("barcode-value"), symbology);
      scene = barcodeScene(code, look);
      encoded = code.text;
      summary = byId<HTMLSelectElement>("symbology").selectedOptions[0].text.split(" · ")[0];
      name = symbology;
    } else {
      encoded = content(kind);
      const qr = encodeQr(encoded, look.logo ? "H" : oneOf(LEVELS, value("level"), "M"));
      scene = qrScene(qr, look, measure);
      summary = `QR version ${qr.version} · ${qr.level} correction`;
      name = "qr-code";
    }
    const size = exportSize(scene, oneOf(SIZE_NAMES, value("size"), "m"));
    const svg = sceneSvg(scene, size);
    // Each size as it comes out for this code.
    for (const option of byId<HTMLSelectElement>("size").options) {
      const { width } = exportSize(scene, option.value as SizeName);
      option.textContent = `${option.value.toUpperCase()} · ${width} px`;
    }
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    parsed.setAttribute("role", "img");
    parsed.setAttribute(
      "aria-label",
      kind === "barcode" ? "Generated barcode" : "Generated QR code"
    );
    const shown = byId("preview").firstElementChild;
    if (shown?.localName === "svg") morph(shown, parsed);
    else byId("preview").replaceChildren(document.importNode(parsed, true));
    byId("preview").classList.remove("pending");
    byId("encoded").textContent = encoded;
    current = { scene, size, svg, name };
    exportsEnabled(true);
    warn(colourWarnings(look, kind !== "barcode"));
    showMessage(byId("status"), `${summary} · ${size.width} × ${size.height} px`);
  } catch (error) {
    current = undefined;
    exportsEnabled(false);
    byId("preview").classList.add("pending");
    showMessage(byId("status"), (error as Error).message, true);
  }
}

function save(): void {
  // An incompatible draft stays as it was: this tab works without saving over it.
  if (draft.error) return;
  if (!writeDraft("codes", 1, { ...fieldValues(ids), ...(upload ? { upload } : {}) }))
    showMessage(
      byId("status"),
      "Draft could not be remembered (storage unavailable or over 2 MB).",
      true
    );
}

/**
 * After an edit: the code is drawn again once typing pauses. Until then the preview, the status
 * and the buttons stay as they are, so nothing flickers; a download first draws what is pending.
 */
function update(): void {
  revision++;
  clearTimeout(timer);
  fields();
  save();
  timer = setTimeout(() => {
    timer = undefined;
    render();
  }, 100);
}
function flush(): void {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
  render();
}

/**
 * Makes the shown SVG match a new one, changing only what differs: an element left as it was is
 * not drawn again, and an image in it (a logo) is not decoded again, so the preview never blinks.
 */
function morph(shown: Element, next: Element): void {
  for (const attribute of [...shown.attributes])
    if (!next.hasAttributeNS(attribute.namespaceURI, attribute.localName))
      shown.removeAttributeNS(attribute.namespaceURI, attribute.localName);
  for (const attribute of next.attributes)
    if (shown.getAttributeNS(attribute.namespaceURI, attribute.localName) !== attribute.value)
      shown.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  const before = [...shown.children],
    after = [...next.children];
  if (!after.length) {
    if (shown.textContent !== next.textContent) shown.textContent = next.textContent;
    for (const child of before) child.remove();
    return;
  }
  // Children pair up by kind, in order (the first path with the first path), so a gradient's
  // <defs> appearing at the start does not shift every other element onto the wrong partner.
  const unused = new Map<string, Element[]>();
  for (const child of before)
    unused.set(child.localName, [...(unused.get(child.localName) ?? []), child]);
  after.forEach((child, i) => {
    const old = unused.get(child.localName)?.shift();
    if (old) morph(old, child);
    const node = old ?? document.importNode(child, true);
    if (shown.children[i] !== node) shown.insertBefore(node, shown.children[i] ?? null);
  });
  for (const extra of [...unused.values()].flat()) extra.remove();
}

// ---------- Controls ----------

for (const id of ids) {
  const element = byId(id);
  if (!(element instanceof HTMLInputElement && element.type === "hidden"))
    element.addEventListener("input", update);
}
// Preset logos are drawn in the code's colour: each picture follows it in place, without a blink.
input("fg").addEventListener("input", () => {
  for (const picture of byId("logo-options").querySelectorAll<HTMLImageElement>("img")) {
    const name = picture.closest<HTMLElement>("[data-value]")?.dataset.value as IconName;
    if (LOGOS.includes(name)) picture.src = presetLogo(name, colour("fg", "#000000")).href;
  }
});

for (const button of document.querySelectorAll<HTMLElement>("[data-type]"))
  button.addEventListener("click", () => {
    input("type").value = button.dataset.type!;
    update();
  });

for (const tab of TABS)
  byId(`tab-${tab}`).addEventListener("click", () => {
    selectTab(tab);
    save();
  });
byId("tab-colours").parentElement!.addEventListener("keydown", (event) => {
  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (!step) return;
  event.preventDefault();
  const shown = TABS.filter((tab) => !byId(`tab-${tab}`).hidden);
  const at = shown.indexOf(oneOf(TABS, value("design-tab"), "colours"));
  selectTab(shown[(at + step + shown.length) % shown.length], true);
  save();
});

/** An image file, scaled to fit 512 pixels and kept as a PNG data: URL in the draft. */
async function readLogo(file: File): Promise<Logo> {
  const url = URL.createObjectURL(file);
  try {
    const source = new Image();
    source.src = url;
    await source.decode();
    const width = source.naturalWidth || 512,
      height = source.naturalHeight || 512;
    const scale = Math.min(1, 512 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    return { href: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function useLogo(file: File | undefined): Promise<void> {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showMessage(byId("status"), "Choose an image for the logo: PNG, JPEG, SVG or WebP.", true);
    return;
  }
  try {
    upload = await readLogo(file);
  } catch {
    showMessage(byId("status"), "This image could not be read. Try a PNG or JPEG.", true);
    return;
  }
  input("logo").value = "upload";
  drawLogos();
  update();
}
byId("logo-upload").addEventListener("click", async () => {
  await useLogo((await pickFiles("image/*"))[0]);
});
onFileDrop(document.querySelector("main")!, (files) => {
  if (type() === "barcode") return;
  selectTab("logo");
  void useLogo(files[0]);
});

byId("clear").addEventListener("click", () => {
  for (const field of textFields(type())) field.value = "";
  if (type() === "wifi") input("hidden-network").checked = false;
  update();
  textFields(type())[0]?.focus();
});
byId("reset-design").addEventListener("click", () => {
  for (const [id, fallback] of Object.entries(DESIGN_DEFAULTS))
    if (typeof fallback === "boolean") input(id).checked = fallback;
    else input(id).value = fallback;
  drawLogos();
  update();
});

/** Loads an image the scene draws, for the canvas. */
async function loadImage(href: string): Promise<HTMLImageElement> {
  const element = new Image();
  element.src = href;
  await element.decode();
  return element;
}
byId("save-svg").addEventListener("click", () => {
  flush();
  if (current) downloadText(current.name + ".svg", current.svg, "image/svg+xml");
});
byId("save-png").addEventListener("click", async () => {
  flush();
  if (!current) return;
  const version = revision,
    { scene, size, name } = current;
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    showMessage(byId("status"), "This browser cannot export PNG. Use SVG instead.", true);
    return;
  }
  try {
    drawScene(context, scene, size, scene.image ? await loadImage(scene.image.href) : undefined);
  } catch {
    showMessage(byId("status"), "The logo could not be drawn. Use SVG instead.", true);
    return;
  }
  canvas.toBlob((blob) => {
    if (version !== revision) return;
    if (blob) downloadBlob(name + ".png", blob);
    else showMessage(byId("status"), "PNG export failed. Use SVG instead.", true);
  }, "image/png");
});

fields();
if (draft.error) {
  const status = byId("draft-status");
  status.hidden = false;
  showMessage(status, draft.error, true);
}
render();
