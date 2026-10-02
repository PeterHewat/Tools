import { expect, test } from "bun:test";
import { checkDigit, encodeBarcode } from "./barcode.js";
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";
import { DEFAULT_DESIGN, barcodeScene } from "./design.js";
import { exportSize, sceneSvg } from "./render.js";
test("published EAN/UPC check digits and EAN symbol vector", () => {
  expect(checkDigit("400638133393")).toBe("1");
  expect(encodeBarcode("400638133393", "ean13").text).toBe("4006381333931");
  expect(encodeBarcode("03600029145", "upca").text).toBe("036000291452");
  const bits = encodeBarcode("0123456789012", "ean13").modules.map(Number).join("");
  expect(bits).toBe(
    "101" +
      "0011001" +
      "0010011" +
      "0111101" +
      "0100011" +
      "0110001" +
      "0101111" +
      "01010" +
      "1000100" +
      "1001000" +
      "1110100" +
      "1110010" +
      "1100110" +
      "1101100" +
      "101"
  );
  expect(() => encodeBarcode("4006381333932", "ean13")).toThrow("check digit");
});

for (const [kind, input, expected, format] of [
  ["code128", "Tools <123>", "Tools <123>", BarcodeFormat.CODE_128],
  ["code128", "1234567890", "1234567890", BarcodeFormat.CODE_128],
  ["ean13", "400638133393", "4006381333931", BarcodeFormat.EAN_13],
  ["upca", "03600029145", "036000291452", BarcodeFormat.UPC_A],
] as const) {
  test(kind + " is independently decoded from generated bars: " + input, () => {
    const code = encodeBarcode(input, kind);
    const scale = 3,
      width = (code.modules.length + 20) * scale,
      height = 120;
    const pixels = new Uint8ClampedArray(width * height).fill(255);
    code.modules.forEach((dark, x) => {
      if (dark)
        for (let y = 8; y < height - 8; y++)
          pixels.fill(0, y * width + (x + 10) * scale, y * width + (x + 11) * scale);
    });
    const reader = new MultiFormatReader();
    const result = reader.decode(
      new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height))),
      new Map([[DecodeHintType.POSSIBLE_FORMATS, [format]]])
    );
    expect(result.getText()).toBe(expected);
    expect(result.getBarcodeFormat()).toBe(format);
  });
}
test("exports have explicit dimensions, readable modules and XML-safe labels", () => {
  const scene = barcodeScene(encodeBarcode("<script>", "code128"), DEFAULT_DESIGN);
  const svg = sceneSvg(scene, exportSize(scene, "s"));
  expect(svg).toContain(`width="${exportSize(scene, "s").width}"`);
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).not.toContain("<script>");
  const long = barcodeScene(encodeBarcode("x".repeat(80), "code128"), DEFAULT_DESIGN);
  expect(exportSize(long, "xs")).toMatchObject({ perModule: 1, width: long.width });
});
test("Code 128 B and C symbol/checksum vectors", () => {
  expect(encodeBarcode("AB", "code128").symbols).toEqual([104, 33, 34, 102, 106]);
  expect(encodeBarcode("123456", "code128").symbols).toEqual([105, 12, 34, 56, 44, 106]);
  expect(encodeBarcode("AB", "code128").modules.slice(0, 11).map(Number).join("")).toBe(
    "11010010000"
  );
  expect(() => encodeBarcode("🌍", "code128")).toThrow("ASCII");
  expect(() => encodeBarcode("", "code128")).toThrow();
  expect(() => encodeBarcode("x".repeat(81), "code128")).toThrow();
});
test("each barcode keeps its standard quiet zones", () => {
  for (const [value, kind, left, right] of [
    ["400638133393", "ean13", 11, 7],
    ["03600029145", "upca", 9, 9],
    ["TOOLS", "code128", 10, 10],
  ] as const) {
    const code = encodeBarcode(value, kind);
    const scene = barcodeScene(code, DEFAULT_DESIGN);
    const svg = sceneSvg(scene, exportSize(scene, "s"));
    expect(svg).toContain(`viewBox="0 0 ${code.modules.length + left + right} 80"`);
    expect(svg).toContain(`d="M${left} 4h`);
  }
});
