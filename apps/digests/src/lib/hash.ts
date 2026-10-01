import { digest, hmac } from "@tools/bytes";
import type { HashAlgorithm } from "@tools/bytes";

export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export function hashBytes(
  bytes: Uint8Array<ArrayBuffer>,
  algorithm: HashAlgorithm,
  key?: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  return key === undefined ? digest(bytes, algorithm) : hmac(bytes, key, algorithm);
}
export async function hashFile(
  file: File,
  algorithm: HashAlgorithm,
  key?: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  if (file.size > MAX_FILE_BYTES)
    throw new Error(
      "Files must be 64 MiB or smaller. Web Crypto reads the whole file into memory."
    );
  return hashBytes(new Uint8Array(await file.arrayBuffer()), algorithm, key);
}
