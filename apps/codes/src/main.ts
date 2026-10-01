import {
  bindToolHelp,
  byId,
  downloadBlob,
  downloadText,
  fieldValues,
  readDraft,
  registerServiceWorker,
  restoreFields,
  showMessage,
  writeDraft,
} from "@tools/ui";
import { encodeQr } from "./lib/qr.js";
import type { Level } from "./lib/qr.js";
import { urlContent, wifiContent } from "./lib/presets.js";
import { encodeBarcode } from "./lib/barcode.js";
import type { BarcodeKind } from "./lib/barcode.js";
import { drawGraphic, graphic } from "./lib/export.js";
import type { Graphic } from "./lib/export.js";
bindToolHelp("codes");
registerServiceWorker();
const ids = [
  "kind",
  "preset",
  "content",
  "ssid",
  "password",
  "security",
  "hidden-network",
  "level",
  "margin",
  "resolution",
];
const draft = readDraft("codes", 1);
const input = (id: string) => byId<HTMLInputElement>(id);
const select = (id: string) => byId<HTMLSelectElement>(id);
if (!draft.error && draft.found) restoreFields(draft.value, ids);
else if (!draft.error) byId<HTMLTextAreaElement>("content").value = "https://example.com/";
let image: Graphic | undefined,
  revision = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
function fields(): void {
  const qr = select("kind").value === "qr",
    wifi = qr && select("preset").value === "wifi";
  byId("qr-options").hidden = !qr;
  byId("preset-field").hidden = !qr;
  byId("wifi-fields").hidden = !wifi;
  byId("content-field").hidden = wifi;
  byId("content-label").textContent =
    qr && select("preset").value === "url"
      ? "URL to encode"
      : qr
        ? "Text to encode"
        : select("kind").value === "code128"
          ? "Printable ASCII text"
          : "Digits · check digit calculated or validated";
  input("password").disabled = select("security").value === "nopass";
}
function exportsEnabled(enabled: boolean): void {
  byId<HTMLButtonElement>("save-svg").disabled = !enabled;
  byId<HTMLButtonElement>("save-png").disabled = !enabled;
}
function render(): void {
  try {
    const kind = select("kind").value,
      preset = select("preset").value;
    const content =
      kind === "qr" && preset === "wifi"
        ? wifiContent(
            input("ssid").value,
            input("password").value,
            select("security").value as "WPA" | "WEP" | "nopass",
            input("hidden-network").checked
          )
        : byId<HTMLTextAreaElement>("content").value;
    if (!content) {
      image = undefined;
      byId("preview").replaceChildren();
      byId("encoded").textContent = "";
      exportsEnabled(false);
      showMessage(byId("status"), "Enter content to generate a code.");
      return;
    }
    const encoded = kind === "qr" && preset === "url" ? urlContent(content) : content;
    const code =
      kind === "qr"
        ? encodeQr(encoded, select("level").value as Level)
        : encodeBarcode(encoded, kind as BarcodeKind);
    image = graphic(code, Number(input("resolution").value), Number(input("margin").value));
    const parsed = new DOMParser().parseFromString(image.svg, "image/svg+xml").documentElement;
    parsed.setAttribute("role", "img");
    parsed.setAttribute("aria-label", kind === "qr" ? "Generated QR code" : "Generated barcode");
    byId("preview").replaceChildren(document.importNode(parsed, true));
    byId("preview").classList.remove("pending");
    byId("encoded").textContent = "text" in code ? code.text : encoded;
    exportsEnabled(true);
    showMessage(
      byId("status"),
      ("version" in code
        ? "QR version " + code.version + " · " + code.level + " correction"
        : kind.toUpperCase()) +
        " · export " +
        image.width +
        " × " +
        image.height +
        " px"
    );
  } catch (error) {
    image = undefined;
    exportsEnabled(false);
    byId("preview").classList.add("pending");
    showMessage(byId("status"), (error as Error).message, true);
  }
}
function update(): void {
  if (draft.error) return;
  revision++;
  clearTimeout(timer);
  fields();
  exportsEnabled(false);
  byId("preview").classList.add("pending");
  showMessage(byId("status"), "Updating…");
  if (!writeDraft("codes", 1, fieldValues(ids)))
    showMessage(
      byId("status"),
      "Draft could not be remembered (storage unavailable or over 2 MB).",
      true
    );
  timer = setTimeout(render, 100);
}
for (const id of ids) byId(id).addEventListener("input", update);
byId("save-svg").addEventListener("click", () => {
  if (image) downloadText(select("kind").value + "-code.svg", image.svg, "image/svg+xml");
});
byId("save-png").addEventListener("click", () => {
  if (!image) return;
  const version = revision,
    canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    showMessage(byId("status"), "This browser cannot export PNG. Use SVG instead.", true);
    return;
  }
  drawGraphic(context, image);
  canvas.toBlob((blob) => {
    if (version !== revision) return;
    if (blob) downloadBlob(select("kind").value + "-code.png", blob);
    else showMessage(byId("status"), "PNG export failed. Use SVG instead.", true);
  }, "image/png");
});
byId("clear").addEventListener("click", () => {
  for (const id of ["content", "ssid", "password"]) input(id).value = "";
  input("hidden-network").checked = false;
  select("preset").value = "text";
  update();
});
byId<HTMLSelectElement>("examples").addEventListener("change", () => {
  const sample = select("examples").value;
  select("kind").value = sample === "url" || sample === "text" ? "qr" : sample;
  select("preset").value = sample === "url" ? "url" : "text";
  byId<HTMLTextAreaElement>("content").value =
    (
      {
        url: "https://example.com/",
        text: "Hello, 🌍!",
        code128: "TOOLS-2026",
        ean13: "400638133393",
        upca: "03600029145",
      } as Record<string, string>
    )[sample] ?? "";
  update();
  select("examples").value = "";
});
fields();
if (draft.error) showMessage(byId("status"), draft.error, true);
else render();
