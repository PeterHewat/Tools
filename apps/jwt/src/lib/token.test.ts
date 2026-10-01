import { expect, test } from "bun:test";
import { hmac, toBase64, utf8 } from "@tools/bytes";
import { claimTimes, memberNotes, decodeToken, verifyToken } from "./token.js";

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

test("notes explain known members at the end of their line, with times read as dates", () => {
  const date = (seconds: number) => "@" + seconds;
  const payload = [
    "{",
    '  "sub": "x",',
    '  "exp": 1000,',
    '  "custom": 1,',
    '  "aud": [',
    '    "a"',
    "  ],",
    '  "iat": "soon"',
    "}",
  ].join("\n");
  const notes = memberNotes(payload, "payload", date, 100);
  expect(notes.map((note) => payload.slice(0, note.at).split("\n").pop())).toEqual([
    '  "sub": "x",',
    '  "exp": 1000,',
    '  "aud": [',
    '  "iat": "soon"',
  ]);
  expect(notes.map((note) => note.text)).toEqual([
    "Subject",
    "Expiration time · @1000 (expires in 15 min)",
    "Audience",
    "Issued at · not a NumericDate (Unix seconds)",
  ]);
  expect(notes.map((note) => note.problem)).toEqual([false, false, false, true]);
  expect(memberNotes('{\n  "exp": 1\n}', "payload", date, 100)[0]).toMatchObject({
    text: "Expiration time · @1 (expired 1 min ago)",
    problem: true,
  });
  const header = memberNotes('{\n  "alg": "HS256",\n  "typ": "JWT",\n  "x": 1\n}', "header", date);
  expect(header.map((note) => note.text)).toEqual(["Algorithm: HMAC with SHA-256", "Token type"]);
  expect(memberNotes('{\n  "alg": "XY1"\n}', "header", date)[0].text).toBe(
    "Algorithm: not one this tool knows"
  );
  // Several members on one line, or JSON that does not parse, get no notes.
  expect(memberNotes('{"sub":"x","exp":1}', "payload", date)).toEqual([]);
  expect(memberNotes('{"sub":', "payload", date)).toEqual([]);
  expect(memberNotes('{\n  "iat": 40\n}', "payload", date, 100)[0].text).toBe(
    "Issued at · @40 (1 min ago)"
  );
  expect(claimTimes({ exp: 0 }, 3 * 365.25 * 86400)[0].description).toBe("Expired 3 years ago");
  expect(claimTimes({ exp: 0 }, 10 * 86400)[0].description).toBe("Expired 10 days ago");
});
