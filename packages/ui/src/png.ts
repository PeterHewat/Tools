/**
 * A PNG of an SVG: the markup drawn by the browser onto a canvas of the given size, so the PNG
 * shows exactly what the SVG does, transparent where it is. Shared by the apps that export both.
 *
 * A browser's own PNG is large: four bytes a pixel however few colours it holds, compressed
 * lightly. So the pixels are written again here, the same pixels: with a palette at as few bits a
 * pixel as the colours need when there are 256 or fewer (a code, flat artwork), often a twentieth
 * of the size; otherwise in full colour, without alpha when nothing is translucent.
 */
export async function renderPng(svg: string, width: number, height: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The drawing could not be rendered."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot draw the picture.");
    ctx.drawImage(img, 0, 0, width, height);
    if (typeof CompressionStream === "function") {
      const pixels = ctx.getImageData(0, 0, width, height).data;
      return new Blob(await encodePng(width, height, pixels), { type: "image/png" });
    }
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("The PNG could not be made."))),
        "image/png"
      )
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The bytes of a PNG of the RGBA pixels, in whichever form is smallest. */
export async function encodePng(
  width: number,
  height: number,
  rgba: Uint8ClampedArray | Uint8Array
): Promise<Uint8Array<ArrayBuffer>[]> {
  const indexed = indexPixels(rgba);
  return indexed ? palettePng(width, height, indexed) : truecolourPng(width, height, rgba);
}

/** Pixels as indexes into a palette of RGBA colours, translucent ones first. */
export interface Indexed {
  palette: number[];
  indexes: Uint8Array;
}

/** The picture's colours and each pixel's place among them; null past 256 colours. */
export function indexPixels(rgba: Uint8ClampedArray | Uint8Array): Indexed | null {
  const pixels = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength >> 2);
  const seen = new Map<number, number>();
  const indexes = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    let at = seen.get(pixels[i]);
    if (at === undefined) {
      if (seen.size === 256) return null;
      at = seen.size;
      seen.set(pixels[i], at);
    }
    indexes[i] = at;
  }
  // Colours as RGBA whatever the machine's byte order; translucent first keeps tRNS short.
  const colour = (p: number): number => {
    const b = new Uint8Array(new Uint32Array([p]).buffer);
    return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  };
  const order = [...seen.keys()].sort(
    (a, b) => Number((colour(a) & 255) === 255) - Number((colour(b) & 255) === 255)
  );
  const remap = new Uint8Array(seen.size);
  order.forEach((p, i) => (remap[seen.get(p)!] = i));
  for (let i = 0; i < indexes.length; i++) indexes[i] = remap[indexes[i]];
  return { palette: order.map(colour), indexes };
}

/** The bytes of a palette PNG: 1, 2, 4 or 8 bits a pixel, as few as the palette allows. */
export async function palettePng(
  width: number,
  height: number,
  { palette, indexes }: Indexed
): Promise<Uint8Array<ArrayBuffer>[]> {
  const depth = palette.length <= 2 ? 1 : palette.length <= 4 ? 2 : palette.length <= 16 ? 4 : 8;
  const perRow = Math.ceil((width * depth) / 8);
  const rows = new Uint8Array((perRow + 1) * height);
  const perByte = 8 / depth;
  for (let y = 0; y < height; y++) {
    const row = y * (perRow + 1) + 1; // each row starts with filter 0, none: best for a palette
    for (let x = 0; x < width; x++) {
      const shift = 8 - depth * ((x % perByte) + 1);
      rows[row + Math.floor(x / perByte)] |= indexes[y * width + x] << shift;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([depth, 3, 0, 0, 0], 8); // colour type 3: indexed
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((c, i) => plte.set([c >>> 24, (c >> 16) & 255, (c >> 8) & 255], i * 3));
  const translucent = palette.findLastIndex((c) => (c & 255) !== 255) + 1;
  const trns = Uint8Array.from(palette.slice(0, translucent), (c) => c & 255);
  const extra = [chunk("PLTE", plte), ...(translucent ? [chunk("tRNS", trns)] : [])];
  return png(header, extra, await deflate(rows));
}

/**
 * The bytes of a full-colour PNG: RGB, or RGBA when a pixel is translucent. Rows go unfiltered or
 * each predicted from the one above, whichever compresses smaller: unfiltered wins on flat colour
 * with smooth edges, prediction on gradients that run down the picture.
 */
export async function truecolourPng(
  width: number,
  height: number,
  rgba: Uint8ClampedArray | Uint8Array
): Promise<Uint8Array<ArrayBuffer>[]> {
  let opaque = true;
  for (let i = 3; i < rgba.length && opaque; i += 4) opaque = rgba[i] === 255;
  const channels = opaque ? 3 : 4;
  const stride = width * channels;
  const plain = new Uint8Array((stride + 1) * height);
  for (let p = 0, at = 0; p < rgba.length; p += 4) {
    if (p % (width * 4) === 0) at++; // the row's filter byte, 0: none
    plain[at++] = rgba[p];
    plain[at++] = rgba[p + 1];
    plain[at++] = rgba[p + 2];
    if (!opaque) plain[at++] = rgba[p + 3];
  }
  const up = plain.slice();
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    up[row] = 2; // filter 2: each byte less the one above it
    if (y)
      for (let x = 1; x <= stride; x++) up[row + x] = plain[row + x] - plain[row + x - stride - 1];
  }
  const [a, b] = await Promise.all([deflate(plain), deflate(up)]);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, opaque ? 2 : 6, 0, 0, 0], 8); // colour type 2: RGB, 6: RGBA
  return png(header, [], a.length <= b.length ? a : b);
}

function png(
  header: Uint8Array,
  extra: Uint8Array<ArrayBuffer>[],
  data: Uint8Array
): Uint8Array<ArrayBuffer>[] {
  return [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", header),
    ...extra,
    chunk("IDAT", data),
    chunk("IEND", new Uint8Array(0)),
  ];
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)));
  return out;
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
