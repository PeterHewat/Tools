import { BLOCKS, ECC } from "./qr-tables.js";

export type Level = "L" | "M" | "Q" | "H";
export interface QrCode {
  version: number;
  level: Level;
  mask: number;
  modules: boolean[][];
}
const bit = (value: number, index: number) => Boolean((value >>> index) & 1);
const grid = (size: number) => Array.from({ length: size }, () => Array<boolean>(size).fill(false));

/** GF(256), primitive polynomial x⁸+x⁴+x³+x²+1. */
function multiply(a: number, b: number): number {
  let product = 0;
  while (b) {
    if (b & 1) product ^= a;
    a <<= 1;
    if (a & 256) a ^= 0x11d;
    b >>>= 1;
  }
  return product;
}
function parity(data: number[], degree: number): number[] {
  let polynomial = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = Array<number>(polynomial.length + 1).fill(0);
    for (let j = 0; j < polynomial.length; j++) {
      next[j] ^= polynomial[j];
      next[j + 1] ^= multiply(polynomial[j], root);
    }
    polynomial = next;
    root = multiply(root, 2);
  }
  const remainder = Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift()!;
    remainder.push(0);
    for (let j = 0; j < degree; j++) remainder[j] ^= multiply(polynomial[j + 1], factor);
  }
  return remainder;
}
function rawWords(version: number): number {
  const align = Math.floor(version / 7) + 2;
  return Math.floor(
    ((16 * version + 128) * version +
      64 -
      (version >= 2 ? (25 * align - 10) * align - 55 : 0) -
      (version >= 7 ? 36 : 0)) /
      8
  );
}
export function capacity(version: number, level: Level): number {
  if (!Number.isInteger(version) || version < 1 || version > 40 || !Object.hasOwn(ECC, level))
    throw new Error("Invalid QR version or error correction level.");
  return rawWords(version) - ECC[level][version] * BLOCKS[level][version];
}
function codewords(bytes: Uint8Array, version: number, level: Level): number[] {
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(7, 4);
  append(26, 8); // ECI assignment 26: UTF-8.
  append(4, 4);
  append(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) append(byte, 8);
  const count = capacity(version, level);
  append(0, Math.min(4, count * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((v, b) => v * 2 + b, 0));
  for (let pad = 0; data.length < count; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  const blocks = BLOCKS[level][version];
  const ecc = ECC[level][version];
  const short = Math.floor(rawWords(version) / blocks) - ecc;
  const shortCount = blocks - (rawWords(version) % blocks);
  const parts: number[][] = [],
    checks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < blocks; i++) {
    const length = short + (i >= shortCount ? 1 : 0);
    const part = data.slice(offset, offset + length);
    offset += length;
    parts.push(part);
    checks.push(parity(part, ecc));
  }
  const output: number[] = [];
  for (let i = 0; i <= short; i++)
    for (const part of parts) if (i < part.length) output.push(part[i]);
  for (let i = 0; i < ecc; i++) for (const check of checks) output.push(check[i]);
  return output;
}
const masks = [
  (x: number, y: number) => (x + y) % 2 === 0,
  (_x: number, y: number) => y % 2 === 0,
  (x: number) => x % 3 === 0,
  (x: number, y: number) => (x + y) % 3 === 0,
  (x: number, y: number) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Score all four standard penalties, including scaled finder-like runs at edges. */
function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0,
    dark = 0;
  const lineScore = (line: boolean[]) => {
    const runs: { dark: boolean; length: number }[] = [{ dark: false, length: size }];
    for (const value of line) {
      const last = runs[runs.length - 1];
      if (last.dark === value) last.length++;
      else runs.push({ dark: value, length: 1 });
    }
    if (runs[runs.length - 1].dark) runs.push({ dark: false, length: size });
    else runs[runs.length - 1].length += size;
    // N1 is measured only in the symbol, excluding the quiet zone.
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    for (let i = 1; i + 5 < runs.length; i += 2) {
      const n = runs[i].length;
      if (
        runs[i + 1].length === n &&
        runs[i + 2].length === n * 3 &&
        runs[i + 3].length === n &&
        runs[i + 4].length === n
      ) {
        if (runs[i - 1].length >= 4 * n && runs[i + 5].length >= n) score += 40;
        if (runs[i + 5].length >= 4 * n && runs[i - 1].length >= n) score += 40;
      }
    }
  };
  for (let y = 0; y < size; y++) {
    lineScore(modules[y]);
    lineScore(modules.map((row) => row[y]));
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) dark++;
      if (
        x &&
        y &&
        modules[y][x] === modules[y][x - 1] &&
        modules[y][x] === modules[y - 1][x] &&
        modules[y][x] === modules[y - 1][x - 1]
      )
        score += 3;
    }
  }
  return (
    score + Math.max(0, Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10
  );
}

/** Model 2, versions 1–40, byte mode plus UTF-8 ECI. No content is inserted in markup. */
export function encodeQr(
  text: string,
  level: Level = "M",
  minimumVersion = 1,
  forcedMask?: number
): QrCode {
  if (!text.isWellFormed()) throw new Error("Text contains an unpaired UTF-16 surrogate.");
  capacity(minimumVersion, level);
  if (
    forcedMask !== undefined &&
    (!Number.isInteger(forcedMask) || forcedMask < 0 || forcedMask > 7)
  )
    throw new Error("Invalid QR mask.");
  const bytes = new TextEncoder().encode(text);
  let version = minimumVersion;
  for (; version <= 40; version++) {
    if (
      bytes.length < 2 ** (version < 10 ? 8 : 16) &&
      16 + (version < 10 ? 8 : 16) + bytes.length * 8 <= capacity(version, level) * 8
    )
      break;
  }
  if (version > 40)
    throw new Error(
      "Content is too long for a QR code at this correction level. Shorten it or lower error correction."
    );
  const size = version * 4 + 17;
  const modules = grid(size),
    reserved = grid(size);
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx,
          y = cy + dy,
          d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && y >= 0 && x < size && y < size) set(x, y, d !== 2 && d !== 4);
      }
  if (version > 1) {
    const count = Math.floor(version / 7) + 2;
    const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    const positions = [6];
    for (let p = size - 7; positions.length < count; p -= step) positions.splice(1, 0, p);
    for (let i = 0; i < count; i++)
      for (let j = 0; j < count; j++) {
        if ((i === 0 && (j === 0 || j === count - 1)) || (i === count - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            set(positions[i] + dx, positions[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
  }
  const format = (mask: number) => {
    const value = ({ L: 1, M: 0, Q: 3, H: 2 }[level] << 3) | mask;
    let remainder = value;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const encoded = ((value << 10) | remainder) ^ 0x5412;
    for (let i = 0; i < 6; i++) set(8, i, bit(encoded, i));
    set(8, 7, bit(encoded, 6));
    set(8, 8, bit(encoded, 7));
    set(7, 8, bit(encoded, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(encoded, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(encoded, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(encoded, i));
    set(8, size - 8, true);
  };
  format(0);
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const encoded = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3),
        b = Math.floor(i / 3);
      set(a, b, bit(encoded, i));
      set(b, a, bit(encoded, i));
    }
  }
  const words = codewords(bytes, version, level);
  let index = 0;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let offset = 0; offset < size; offset++) {
      const y = ((right + 1) & 2) === 0 ? size - 1 - offset : offset;
      for (const x of [right, right - 1])
        if (!reserved[y][x]) {
          modules[y][x] = index < words.length * 8 && bit(words[index >>> 3], 7 - (index & 7));
          index++;
        }
    }
  }
  if (Math.floor(index / 8) !== words.length) throw new Error("QR data placement failed.");
  const apply = (mask: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!reserved[y][x] && masks[mask](x, y)) modules[y][x] = !modules[y][x];
  };
  let bestMask = forcedMask ?? 0,
    bestScore = Infinity;
  if (forcedMask === undefined)
    for (let mask = 0; mask < 8; mask++) {
      apply(mask);
      format(mask);
      const score = penalty(modules);
      apply(mask);
      if (score < bestScore) {
        bestScore = score;
        bestMask = mask;
      }
    }
  apply(bestMask);
  format(bestMask);
  return { version, level, mask: bestMask, modules };
}

/** The clear border a QR code needs on every side, in modules (ISO/IEC 18004). */
export const QUIET_ZONE = 4;
