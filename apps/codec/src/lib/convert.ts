import { decodeBytes, encodeBytes, utf8 } from "@tools/bytes";
import type { ByteFormat } from "@tools/bytes";

export type Format = ByteFormat | "url";

/** The formats in the order they are shown. */
export const FORMATS: readonly Format[] = ["text", "url", "base64", "base64url", "hex"];

/** Bytes that a URL component keeps as they are: what `encodeURIComponent` leaves alone. */
const UNRESERVED = /[A-Za-z0-9\-_.!~*'()]/;

/**
 * Percent-encodes bytes as a URL component. Bytes that are valid UTF-8 give exactly what
 * `encodeURIComponent` gives for their text; any other byte is written as %XX too.
 */
export function toUrl(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    out +=
      byte < 0x80 && UNRESERVED.test(char)
        ? char
        : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** Reads a URL component: %XX is a byte, any other character its UTF-8 bytes; + stays a plus. */
export function fromUrl(value: string): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [];
  for (let i = 0; i < value.length;) {
    if (value[i] === "%") {
      const pair = value.slice(i + 1, i + 3);
      if (!/^[\da-f]{2}$/i.test(pair))
        throw new Error(`A % must be followed by two hex digits (at character ${i + 1}).`);
      bytes.push(parseInt(pair, 16));
      i += 3;
      continue;
    }
    const next = value.indexOf("%", i);
    const end = next < 0 ? value.length : next;
    for (const byte of utf8(value.slice(i, end))) bytes.push(byte);
    i = end;
  }
  return Uint8Array.from(bytes);
}

export function readValue(value: string, format: Format): Uint8Array<ArrayBuffer> {
  return format === "url" ? fromUrl(value) : decodeBytes(value, format);
}

/** Hex as byte pairs separated by spaces, which hex input also accepts. */
export function writeValue(bytes: Uint8Array, format: Format): string {
  if (format === "url") return toUrl(bytes);
  if (format === "hex") return encodeBytes(bytes, "hex").replace(/(..)(?!$)/g, "$1 ");
  return encodeBytes(bytes, format);
}

/** Every format written from the bytes; null where they cannot be (text that is not UTF-8). */
export function writeAll(bytes: Uint8Array): Record<Format, string | null> {
  const all = {} as Record<Format, string | null>;
  for (const format of FORMATS) {
    try {
      all[format] = writeValue(bytes, format);
    } catch {
      all[format] = null;
    }
  }
  return all;
}
