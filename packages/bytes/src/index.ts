/** Byte formats shared by Codec, JWT and Digests. No lossy text decoding. */
export type ByteFormat = "text" | "hex" | "base64" | "base64url";
export type HashAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  // TextEncoder replaces unpaired surrogates. Reject them instead of silently changing input.
  if (!text.isWellFormed()) throw new Error("Text contains an unpaired UTF-16 surrogate.");
  return new TextEncoder().encode(text);
}

export function textFromBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("These bytes are not valid UTF-8. Use hex or Base64 to inspect them.");
  }
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(value: string): Uint8Array<ArrayBuffer> {
  const text = value.replace(/\s/g, "");
  if (!/^(?:[\da-f]{2})*$/i.test(text)) throw new Error("Hex needs complete pairs of 0–9 or A–F.");
  return Uint8Array.from(text.match(/../g) ?? [], (b) => parseInt(b, 16));
}

export function toBase64(bytes: Uint8Array, url = false): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const encoded = btoa(binary);
  return url ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : encoded;
}

export function fromBase64(value: string, url = false): Uint8Array<ArrayBuffer> {
  const text = url ? value : value.replace(/\s/g, "");
  const pattern = url ? /^[\w-]*$/ : /^[A-Za-z0-9+/]*={0,2}$/;
  if (
    !pattern.test(text) ||
    text.length % 4 === 1 ||
    (!url && text.includes("=") && text.length % 4 !== 0)
  )
    throw new Error(url ? "Invalid unpadded Base64url." : "Invalid Base64.");
  const raw = text.replace(/=+$/, "");
  const standard = raw.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Uint8Array.from(
    atob(standard + "=".repeat((4 - (standard.length % 4)) % 4)),
    (c) => c.charCodeAt(0)
  );
  if (toBase64(decoded, url).replace(/=+$/, "") !== raw)
    throw new Error("Invalid Base64 padding bits.");
  return decoded;
}

export function decodeBytes(value: string, format: ByteFormat): Uint8Array<ArrayBuffer> {
  switch (format) {
    case "text":
      return utf8(value);
    case "hex":
      return fromHex(value);
    case "base64":
      return fromBase64(value);
    case "base64url":
      return fromBase64(value, true);
  }
}

export function encodeBytes(bytes: Uint8Array, format: ByteFormat): string {
  switch (format) {
    case "text":
      return textFromBytes(bytes);
    case "hex":
      return toHex(bytes);
    case "base64":
      return toBase64(bytes);
    case "base64url":
      return toBase64(bytes, true);
  }
}

export function webCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle)
    throw new Error("Web Crypto needs HTTPS or localhost in this browser.");
  return crypto.subtle;
}

export async function digest(
  bytes: Uint8Array<ArrayBuffer>,
  algorithm: HashAlgorithm
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await webCrypto().digest(algorithm, bytes));
}

export async function hmac(
  bytes: Uint8Array<ArrayBuffer>,
  key: Uint8Array<ArrayBuffer>,
  algorithm: HashAlgorithm
): Promise<Uint8Array<ArrayBuffer>> {
  if (!key.length) throw new Error("Enter a non-empty HMAC key.");
  const subtle = webCrypto();
  const imported = await subtle.importKey("raw", key, { name: "HMAC", hash: algorithm }, false, [
    "sign",
  ]);
  return new Uint8Array(await subtle.sign("HMAC", imported, bytes));
}
