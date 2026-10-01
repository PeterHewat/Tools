import { toHex } from "@tools/bytes";
import { bindToolHelp, byId, copyText, registerServiceWorker, showMessage } from "@tools/ui";
import { convert, readValue } from "./lib/convert.js";
import type { Format } from "./lib/convert.js";
bindToolHelp("codec");
registerServiceWorker();
const sides = ["left", "right"] as const;
const field = (side: string) => byId<HTMLTextAreaElement>(side);
const format = (side: string) => byId<HTMLSelectElement>(`${side}-format`);
format("right").value = "base64";
function inspect(side: string): void {
  try {
    const bytes = readValue(field(side).value, format(side).value as Format);
    byId(`${side}-bytes`).textContent =
      toHex(bytes.subarray(0, 4096)).replace(/(..)/g, "$1 ").trim() +
      (bytes.length > 4096 ? "\n… first 4096 bytes shown" : "");
    showMessage(byId(`${side}-status`), `${bytes.length.toLocaleString()} bytes`);
  } catch (error) {
    byId(`${side}-bytes`).textContent = "";
    showMessage(byId(`${side}-status`), (error as Error).message, true);
  }
}
for (const side of sides) {
  for (const control of [field(side), format(side)])
    control.addEventListener("input", () => {
      inspect(side);
      showMessage(byId("status"), "");
    });
  byId(`${side}-convert`).addEventListener("click", () => {
    const target = side === "left" ? "right" : "left";
    try {
      const result = convert(
        field(side).value,
        format(side).value as Format,
        format(target).value as Format
      );
      field(target).value = result.text;
      inspect(side);
      inspect(target);
      showMessage(
        byId("status"),
        `Converted ${side} to ${target} · ${result.bytes.length.toLocaleString()} bytes.`
      );
    } catch (error) {
      showMessage(byId("status"), (error as Error).message, true);
    }
  });
  byId(`${side}-copy`).addEventListener("click", async () => {
    if (!(await copyText(field(side).value, byId(`${side}-copy`))))
      showMessage(byId("status"), "Clipboard unavailable. Select and copy the pane text.", true);
  });
  inspect(side);
}
byId("sample").addEventListener("click", () => {
  format("left").value = "text";
  format("right").value = "base64";
  field("left").value = "Hello, 🌍!\n";
  byId("left-convert").click();
});
byId("clear").addEventListener("click", () => {
  for (const side of sides) {
    field(side).value = "";
    inspect(side);
  }
  showMessage(byId("status"), "");
  field("left").focus();
});
