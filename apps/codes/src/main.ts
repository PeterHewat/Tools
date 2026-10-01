import {
  bindToolHelp,
  byId,
  downloadBlob,
  downloadText,
  registerServiceWorker,
  showMessage,
} from "@tools/ui";
import { encodeQr, qrSvg } from "./lib/qr.js";
import type { Level, QrCode } from "./lib/qr.js";
import { urlContent, wifiContent } from "./lib/presets.js";
bindToolHelp("codes");
registerServiceWorker();
const input = (id: string) => byId<HTMLInputElement>(id);
const select = (id: string) => byId<HTMLSelectElement>(id);
let current: QrCode | null = null;
let svg = "";
let timer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
function clearResult(): void {
  revision++;
  current = null;
  svg = "";
  byId("preview").replaceChildren();
  byId("encoded").textContent = "";
  byId<HTMLButtonElement>("save-svg").disabled = true;
  byId<HTMLButtonElement>("save-png").disabled = true;
}
function render(): void {
  clearResult();
  try {
    const preset = select("preset").value;
    byId("wifi-fields").hidden = preset !== "wifi";
    byId("content-field").hidden = preset === "wifi";
    byId("content-label").textContent = preset === "url" ? "URL to encode" : "Text to encode";
    input("password").disabled = select("security").value === "nopass";
    const content =
      preset === "wifi"
        ? wifiContent(
            input("ssid").value,
            input("password").value,
            select("security").value as "WPA" | "WEP" | "nopass",
            input("hidden-network").checked
          )
        : byId<HTMLTextAreaElement>("content").value;
    if (!content) {
      showMessage(byId("status"), "Enter content to generate a QR code.");
      return;
    }
    const encoded = preset === "url" ? urlContent(content) : content;
    current = encodeQr(encoded, select("level").value as Level);
    svg = qrSvg(current, Number(input("margin").value));
    // qrSvg contains only generated numeric paths, never user content.
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    parsed.setAttribute("role", "img");
    parsed.setAttribute("aria-label", "Generated QR code");
    byId("preview").append(document.importNode(parsed, true));
    byId("encoded").textContent = encoded;
    byId<HTMLButtonElement>("save-svg").disabled = false;
    byId<HTMLButtonElement>("save-png").disabled = false;
    showMessage(
      byId("status"),
      `Version ${current.version} · ${current.modules.length} × ${current.modules.length} modules · ${current.level} correction · ${new TextEncoder().encode(encoded).length} bytes`
    );
  } catch (error) {
    clearResult();
    showMessage(byId("status"), (error as Error).message, true);
  }
}
for (const element of document.querySelectorAll<
  HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
>("main input, main textarea, main select"))
  element.addEventListener("input", () => {
    clearTimeout(timer);
    clearResult();
    if (element.id === "preset" || element.id === "security") render();
    else {
      showMessage(byId("status"), "Updating…");
      timer = setTimeout(render, 120);
    }
  });
byId("save-svg").addEventListener("click", () => {
  if (svg) downloadText("qr-code.svg", svg, "image/svg+xml");
});
byId("save-png").addEventListener("click", () => {
  if (!current) return;
  const scale = Number(input("scale").value),
    margin = Number(input("margin").value);
  if (!Number.isInteger(scale) || scale < 1 || scale > 32) {
    showMessage(
      byId("status"),
      "PNG scale must be an integer from 1 to 32 pixels per module.",
      true
    );
    return;
  }
  const version = revision;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = (current.modules.length + margin * 2) * scale;
  const context = canvas.getContext("2d");
  if (!context) {
    showMessage(byId("status"), "This browser cannot export PNG. Use SVG instead.", true);
    return;
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  current.modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) context.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
    })
  );
  canvas.toBlob((blob) => {
    if (version !== revision) return;
    if (blob) downloadBlob("qr-code.png", blob);
    else showMessage(byId("status"), "PNG export failed. Use SVG instead.", true);
  }, "image/png");
});
byId("clear").addEventListener("click", () => {
  clearTimeout(timer);
  for (const id of ["content", "ssid", "password"]) input(id).value = "";
  input("hidden-network").checked = false;
  render();
});
render();
