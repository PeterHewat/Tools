import { digest, hmac } from "@tools/bytes";
import type { HashAlgorithm } from "@tools/bytes";

export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Every digest the app shows, in the order it shows them: SHA-1 last, as legacy. */
export const ALGORITHMS = [
  "SHA-256",
  "SHA-384",
  "SHA-512",
  "SHA-1",
] as const satisfies readonly HashAlgorithm[];

export type Digests = Record<HashAlgorithm, Uint8Array<ArrayBuffer>>;

export function hashBytes(
  bytes: Uint8Array<ArrayBuffer>,
  algorithm: HashAlgorithm,
  key?: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  return key === undefined ? digest(bytes, algorithm) : hmac(bytes, key, algorithm);
}

/** The bytes with every algorithm, or HMAC with each when there is a key. */
export async function hashAll(
  bytes: Uint8Array<ArrayBuffer>,
  key?: Uint8Array<ArrayBuffer>
): Promise<Digests> {
  const results = await Promise.all(ALGORITHMS.map((name) => hashBytes(bytes, name, key)));
  return Object.fromEntries(ALGORITHMS.map((name, i) => [name, results[i]])) as Digests;
}

/** A file's bytes; one too large is refused before it is read. */
export async function readFile(file: File): Promise<Uint8Array<ArrayBuffer>> {
  if (file.size > MAX_FILE_BYTES)
    throw new Error(
      "Files must be 64 MiB or smaller. Web Crypto reads the whole file into memory."
    );
  return new Uint8Array(await file.arrayBuffer());
}

/** Which algorithm and encoding an expected digest matches: hex in either case, or Base64. */
export function matchDigest(
  expected: string,
  digests: Digests,
  encode: { hex: (b: Uint8Array) => string; base64: (b: Uint8Array) => string }
): HashAlgorithm | undefined {
  const value = expected.replace(/\s+/g, "");
  if (!value) return undefined;
  return ALGORITHMS.find(
    (name) =>
      value.toLowerCase() === encode.hex(digests[name]) || value === encode.base64(digests[name])
  );
}
