import { decodeBytes, encodeBytes, utf8 } from "@tools/bytes";
import type { ByteFormat } from "@tools/bytes";

export type Format = ByteFormat | "url";
export function readValue(value: string, format: Format): Uint8Array<ArrayBuffer> {
  if (format !== "url") return decodeBytes(value, format);
  try {
    return utf8(decodeURIComponent(value));
  } catch {
    throw new Error("Invalid percent encoding or UTF-8 in URL component.");
  }
}
export function convert(
  value: string,
  from: Format,
  to: Format
): { text: string; bytes: Uint8Array<ArrayBuffer> } {
  const bytes = readValue(value, from);
  const text =
    to === "url" ? encodeURIComponent(encodeBytes(bytes, "text")) : encodeBytes(bytes, to);
  return { text, bytes };
}
