import { expect, test } from "bun:test";
import { toHex } from "@tools/bytes";
import { hashBytes, hashFile, MAX_FILE_BYTES } from "./hash.js";
test("file hashing preserves binary bytes and rejects oversized files before reading", async () => {
  const bytes = new Uint8Array([0, 255, 13, 10]);
  expect(toHex(await hashFile(new File([bytes], "binary"), "SHA-256"))).toBe(
    toHex(await hashBytes(bytes, "SHA-256"))
  );
  const file = {
    size: MAX_FILE_BYTES + 1,
    arrayBuffer: () => {
      throw new Error("must not read");
    },
  } as unknown as File;
  await expect(hashFile(file, "SHA-256")).rejects.toThrow("64 MiB");
});
