import { expect, test } from "bun:test";
import {
  decodeBytes,
  digest,
  encodeBytes,
  fromBase64,
  fromHex,
  hmac,
  textFromBytes,
  toBase64,
  toHex,
  utf8,
} from "./index.js";

test("encodings round trip Unicode, null and BOM without normalization", () => {
  const text = "\ufeffhéllo 🌍\u0000\r\n";
  for (const format of ["text", "hex", "base64", "base64url"] as const)
    expect(textFromBytes(decodeBytes(encodeBytes(utf8(text), format), format))).toBe(text);
  expect(toBase64(utf8("foobar"))).toBe("Zm9vYmFy");
  expect(toBase64(new Uint8Array([251, 255]), true)).toBe("-_8");
  expect(toHex(fromHex("00 ff\nAb"))).toBe("00ffab");
});

test("malformed encodings fail instead of changing bytes", () => {
  for (const text of ["A", "AB==", "A===", "Zg=", "Zg===", "?", "===="])
    expect(() => fromBase64(text)).toThrow();
  for (const text of ["Zg==", "a/b", "a+b", "a b", "AB"])
    expect(() => fromBase64(text, true)).toThrow();
  expect(() => fromHex("f")).toThrow();
  expect(() => textFromBytes(new Uint8Array([255]))).toThrow();
  expect(() => utf8("\ud800")).toThrow();
  expect(toHex(fromBase64(" Zg==\n"))).toBe("66");
});

test("large Base64 conversion avoids argument stack limits", () => {
  const bytes = new Uint8Array(200_000).fill(253);
  expect(fromBase64(toBase64(bytes))).toEqual(bytes);
});

test("SHA and HMAC match published known vectors", async () => {
  expect(toHex(await digest(utf8("abc"), "SHA-256"))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  expect(toHex(await digest(utf8(""), "SHA-1"))).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  expect(toHex(await hmac(utf8("Hi There"), new Uint8Array(20).fill(11), "SHA-256"))).toBe(
    "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
  );
  expect(toHex(await hmac(utf8("Hi There"), new Uint8Array(20).fill(11), "SHA-384"))).toBe(
    "afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6"
  );
  expect(toHex(await hmac(utf8("Hi There"), new Uint8Array(20).fill(11), "SHA-512"))).toBe(
    "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cde daa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854".replace(
      / /g,
      ""
    )
  );
});
