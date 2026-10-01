import { expect, test } from "bun:test";
import { hmac, toBase64, utf8 } from "@tools/bytes";
import { claimTimes, decodeToken, verifyToken } from "./token.js";

test("JWT inspection preserves exact numbers, escapes and key order", () => {
  const payload = '{"id":9223372036854775807,"decimal":1.0,"overflow":1e400,"name":"\\u0061"}';
  const token = decodeToken(`e30.${toBase64(utf8(payload), true)}.`);
  expect(token.payloadText).toContain("9223372036854775807");
  expect(token.payloadText).toContain("1.0");
  expect(token.payloadText).toContain("1e400");
  expect(token.payloadText).toContain('"\\u0061"');
  for (const source of ['{"alg":"HS256","alg":"none"}', '{"x":1,}', '{/*comment*/"x":1}'])
    expect(() => decodeToken(`${toBase64(utf8(source), true)}.e30.`)).toThrow();
});

test("decode and verify all supported HMAC algorithms, reject tampering and mismatches", async () => {
  for (const [algorithm, hash] of [
    ["HS256", "SHA-256"],
    ["HS384", "SHA-384"],
    ["HS512", "SHA-512"],
  ] as const) {
    const input = `${toBase64(utf8(JSON.stringify({ alg: algorithm })), true)}.${toBase64(utf8('{"sub":"héllo"}'), true)}`;
    const key = utf8("test vector key");
    const token = decodeToken(`${input}.${toBase64(await hmac(utf8(input), key, hash), true)}`);
    expect(token.payload.sub).toBe("héllo");
    expect(await verifyToken(token, key, algorithm)).toBe(true);
    expect(await verifyToken(token, utf8("wrong"), algorithm)).toBe(false);
    token.signingInput += "a";
    expect(await verifyToken(token, key, algorithm)).toBe(false);
  }
  await expect(
    verifyToken(decodeToken("eyJhbGciOiJub25lIn0.e30."), utf8("x"), "HS256")
  ).rejects.toThrow("match");
});

test("strict JWT structures and unsupported extensions", async () => {
  for (const value of ["", "a.b", "e30.e30.a.b", "W10.e30.", "e30.W10.", "e30.e30.?"])
    expect(() => decodeToken(value)).toThrow();
  const token = decodeToken(`${toBase64(utf8('{"alg":"HS256","crit":["custom"]}'), true)}.e30.`);
  await expect(verifyToken(token, utf8("key"), "HS256")).rejects.toThrow("extensions");
});

test("NumericDate boundaries, invalid claims and fractional seconds", () => {
  expect(claimTimes({ exp: 100, nbf: 101, iat: 99 }, 100).map((c) => c.problem)).toEqual([
    true,
    false,
    true,
  ]);
  expect(claimTimes({ exp: "100", nbf: 1e20 }, 100).every((c) => c.problem)).toBe(true);
  expect(claimTimes({ exp: 100.5 }, 100)[0].date).toBe("1970-01-01T00:01:40.500Z");
});
