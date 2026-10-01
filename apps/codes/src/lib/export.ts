import { escapeXml } from "@tools/ui";
import { qrSvg } from "./qr.js";
import type { QrCode } from "./qr.js";
import type { Barcode } from "./barcode.js";
export interface Graphic {
  svg: string;
  width: number;
  height: number;
  qr?: QrCode;
  barcode?: Barcode;
  margin: number;
}
export function graphic(code: QrCode | Barcode, size: number, margin = 4): Graphic {
  if (!Number.isInteger(size) || size < 64 || size > 4096)
    throw new Error("Export width must be an integer from 64 to 4096 pixels.");
  if ("version" in code) {
    const modules = code.modules.length + margin * 2;
    if (size < modules)
      throw new Error("Increase export width to at least " + modules + " pixels for this QR code.");
    return {
      svg: qrSvg(code, margin).replace(
        /width="\d+" height="\d+"/,
        'width="' + size + '" height="' + size + '"'
      ),
      width: size,
      height: size,
      qr: code,
      margin,
    };
  }
  const width = code.modules.length + 20,
    height = Math.max(120, Math.round(size / 3));
  if (size < width)
    throw new Error(
      "Increase export width to at least " + width + " pixels to keep barcode bars readable."
    );
  let path = "";
  for (let x = 0; x < code.modules.length; x++)
    if (code.modules[x]) path += "M" + (x + 10) + " 4h1v60h-1z";
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    size +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    ' 80" preserveAspectRatio="none"><rect width="100%" height="100%" fill="#fff"/><path d="' +
    path +
    '" fill="#000"/><text x="' +
    width / 2 +
    '" y="75" text-anchor="middle" font-family="monospace" font-size="7" fill="#000">' +
    escapeXml(code.text) +
    "</text></svg>";
  return { svg, width: size, height, barcode: code, margin: 10 };
}
/** Exact requested PNG dimensions, with integer modules and surplus pixels added to the quiet zone. */
export function drawGraphic(context: CanvasRenderingContext2D, image: Graphic): void {
  const { width, height, qr, barcode, margin } = image;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#000";
  if (qr) {
    const total = qr.modules.length + margin * 2,
      scale = Math.floor(width / total),
      offset = Math.floor((width - total * scale) / 2) + margin * scale;
    qr.modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) context.fillRect(offset + x * scale, offset + y * scale, scale, scale);
      })
    );
  } else if (barcode) {
    const total = barcode.modules.length + 20,
      scale = Math.floor(width / total),
      offset = Math.floor((width - total * scale) / 2) + 10 * scale;
    barcode.modules.forEach((dark, x) => {
      if (dark) context.fillRect(offset + x * scale, 8, scale, height - 36);
    });
    context.font = "14px monospace";
    context.textAlign = "center";
    context.fillText(barcode.text, width / 2, height - 10, width - 20);
  }
}
