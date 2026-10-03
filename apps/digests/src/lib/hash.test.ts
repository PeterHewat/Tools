import { expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { toBase64, toHex, utf8 } from "@tools/bytes";
import { hashAll, matchDigest, MAX_FILE_BYTES, readFile } from "./hash.js";

const encode = { hex: toHex, base64: toBase64 };

test("every algorithm at once, plain or keyed", async () => {
  const bytes = utf8("abc");
  const plain = await hashAll(bytes);
  expect(toHex(plain["SHA-256"])).toBe(createHash("sha256").update("abc").digest("hex"));
  expect(toHex(plain["SHA-384"])).toBe(createHash("sha384").update("abc").digest("hex"));
  expect(toHex(plain["SHA-512"])).toBe(createHash("sha512").update("abc").digest("hex"));
  expect(toHex(plain["SHA-1"])).toBe(createHash("sha1").update("abc").digest("hex"));
  const keyed = await hashAll(bytes, utf8("key"));
  expect(toHex(keyed["SHA-512"])).toBe(createHmac("sha512", "key").update("abc").digest("hex"));
});

test("files keep their binary bytes and one too large is refused before it is read", async () => {
  const bytes = new Uint8Array([0, 255, 13, 10]);
  expect([...(await readFile(new File([bytes], "binary")))]).toEqual([...bytes]);
  const file = {
    size: MAX_FILE_BYTES + 1,
    arrayBuffer: () => {
      throw new Error("must not read");
    },
  } as unknown as File;
  await expect(readFile(file)).rejects.toThrow("64 MiB");
});

test("an expected digest names the algorithm it matches, hex in any case or Base64", async () => {
  const digests = await hashAll(utf8("abc"));
  const sha384 = toHex(digests["SHA-384"]);
  expect(matchDigest(sha384.toUpperCase(), digests, encode)).toBe("SHA-384");
  expect(matchDigest(" " + sha384.slice(0, 40) + "\n" + sha384.slice(40), digests, encode)).toBe(
    "SHA-384"
  );
  expect(matchDigest(toBase64(digests["SHA-1"]), digests, encode)).toBe("SHA-1");
  expect(matchDigest(toBase64(digests["SHA-1"]).toLowerCase(), digests, encode)).toBeUndefined();
  expect(matchDigest("", digests, encode)).toBeUndefined();
});
