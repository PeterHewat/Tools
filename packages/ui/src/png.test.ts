import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { encodePng, indexPixels, palettePng } from "./png.js";

/** The chunks of a PNG by type, checked for a valid signature. */
function chunks(png: Uint8Array): Map<string, Uint8Array> {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset);
  const out = new Map<string, Uint8Array>();
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    out.set(type, png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  return out;
}

const join = (parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));

describe("palette PNG", () => {
  test("a two-colour picture is one bit a pixel, rows packed from the high bit", async () => {
    // 3 × 2: black, white, black / white, white, black
    const px = [0, 255, 0, 255, 255, 0].flatMap((v) => [v, v, v, 255]);
    const indexed = indexPixels(new Uint8Array(px))!;
    expect(indexed.palette).toEqual([0x000000ff, 0xffffffff]);
    const png = chunks(join(await palettePng(3, 2, indexed)));
    const ihdr = new DataView(png.get("IHDR")!.buffer, png.get("IHDR")!.byteOffset);
    expect([ihdr.getUint32(0), ihdr.getUint32(4), ihdr.getUint8(8), ihdr.getUint8(9)]).toEqual([
      3, 2, 1, 3,
    ]);
    expect([...png.get("PLTE")!]).toEqual([0, 0, 0, 255, 255, 255]);
    expect(png.has("tRNS")).toBe(false);
    expect([...inflateSync(png.get("IDAT")!)]).toEqual([0, 0b01000000, 0, 0b11000000]);
  });

  test("translucent colours come first and alone have alpha", async () => {
    const px = [255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 128];
    const indexed = indexPixels(new Uint8Array(px))!;
    expect(indexed.palette.map((c) => c & 255)).toEqual([0, 128, 255]);
    const png = chunks(join(await palettePng(3, 1, indexed)));
    expect([...png.get("tRNS")!]).toEqual([0, 128]);
    expect(png.get("IHDR")![8]).toBe(2);
  });

  test("past 256 colours there is no palette", () => {
    const px = Array.from({ length: 257 }, (_, i) => [i & 255, i >> 8, 0, 255]).flat();
    expect(indexPixels(new Uint8Array(px))).toBeNull();
  });

  test("past 256 colours the pixels are full colour, alpha dropped when all are opaque", async () => {
    const w = 20;
    const h = 20;
    const px = Array.from({ length: w * h }, (_, i) => [
      i % w,
      (i / w) | 0,
      (i * 7) & 255,
      255,
    ]).flat();
    const png = chunks(join(await encodePng(w, h, new Uint8Array(px))));
    expect(png.has("PLTE")).toBe(false);
    expect([png.get("IHDR")![8], png.get("IHDR")![9]]).toEqual([8, 2]);
    // Undo each row's filter (0: none, 2: up) and compare with the pixels given.
    const raw = inflateSync(png.get("IDAT")!);
    const stride = w * 3;
    const rgb: number[] = [];
    for (let y = 0; y < h; y++) {
      const filter = raw[y * (stride + 1)];
      for (let x = 0; x < stride; x++) {
        const v = raw[y * (stride + 1) + 1 + x];
        rgb.push(filter === 2 && y ? (v + rgb[(y - 1) * stride + x]) & 255 : v);
      }
    }
    expect(rgb).toEqual(px.filter((_, i) => i % 4 !== 3));
  });

  test("a translucent full-colour picture keeps its alpha", async () => {
    const px = Array.from({ length: 300 }, (_, i) => [
      i & 255,
      i >> 8,
      0,
      i === 0 ? 0 : 255,
    ]).flat();
    const png = chunks(join(await encodePng(300, 1, new Uint8Array(px))));
    expect(png.get("IHDR")![9]).toBe(6);
    expect([...inflateSync(png.get("IDAT")!).subarray(0, 9)]).toEqual([
      0, 0, 0, 0, 0, 1, 0, 0, 255,
    ]);
  });
});
