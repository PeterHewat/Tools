import { expect, test } from "bun:test";
import { toBase64, utf8 } from "@tools/bytes";
import { claimTimes, memberNotes } from "./token.js";
import { cleanToken, inspectJwt } from "./inspect.js";

const part = (json: string) => toBase64(utf8(json), true);
const HS256 = part('{"alg":"HS256"}');

test("JWT inspection preserves exact numbers, escapes and key order", () => {
  const payload = '{"id":9223372036854775807,"decimal":1.0,"overflow":1e400,"name":"\\u0061"}';
  const text = inspectJwt(`${HS256}.${part(payload)}.c2ln`).payload.text;
  for (const exact of ["9223372036854775807", "1.0", "1e400", '"\\u0061"'])
    expect(text).toContain(exact);
  for (const source of ['{"alg":"HS256","alg":"none"}', '{"x":1,}', '{/*comment*/"x":1}'])
    expect(inspectJwt(`${part(source)}.e30.c2ln`).header.error).toBeTruthy();
});

test("strict JWT structures", () => {
  for (const value of ["", "a.b", `${HS256}.e30.a.b`, "W10.e30.c2ln", `${HS256}.W10.c2ln`])
    expect(inspectJwt(value).valid).toBe(false);
  expect(inspectJwt(`${HS256}.e30.?`).error).toContain("Base64url");
  expect(inspectJwt(`${HS256}.e30.`).error).toBe("The signature is empty.");
  expect(inspectJwt(`${HS256}.e30.c2ln`).valid).toBe(true);
});

test("an unsigned token (alg none) is valid with an empty signature, and only then", () => {
  const none = part('{"alg":"none"}');
  const unsigned = inspectJwt(`${none}.e30.`);
  expect(unsigned.valid).toBe(true);
  expect(unsigned.signature).toEqual(new Uint8Array());
  expect(inspectJwt(`${none}.e30.c2ln`).error).toContain("must have an empty signature");
});

test("an encrypted token (JWE) shows its header and says why its payload cannot be read", () => {
  const jwe = inspectJwt(`${part('{"alg":"RSA-OAEP","enc":"A256GCM"}')}.a2V5.aXY.Y2lwaGVy.dGFn`);
  expect(jwe.header.object).toEqual({ alg: "RSA-OAEP", enc: "A256GCM" });
  expect(jwe.valid).toBe(false);
  expect(jwe.error).toContain("encrypted token (JWE)");
  expect(jwe.payload.error).toContain("Encrypted");
});

test("pasted tokens lose a Bearer prefix and the line breaks they were wrapped with", () => {
  expect(cleanToken("Bearer abc.def.ghi")).toEqual({
    token: "abc.def.ghi",
    what: 'the "Bearer " prefix',
  });
  expect(cleanToken("abc.de\n  f.ghi\n")).toEqual({
    token: "abc.def.ghi",
    what: "spaces and line breaks",
  });
  expect(cleanToken("bearer  ab c.d").what).toBe('the "Bearer " prefix and spaces and line breaks');
  // Nothing to take out: the text stays as it is, surrounding spaces included.
  expect(cleanToken("  abc.def.ghi\n")).toEqual({ token: "  abc.def.ghi\n", what: "" });
  // "Bearer " typed on its own is left alone until the token follows it.
  expect(cleanToken("Bearer ").what).toBe("");
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
test("member notes stay linear on a large payload", () => {
  const members = Array.from({ length: 20_000 }, (_, i) => `  "x${i}": ${i}`);
  const text = "{\n" + members.join(",\n") + ',\n  "exp": 0\n}';
  const started = performance.now();
  const notes = memberNotes(text, "payload", () => "date", 0);
  expect(notes).toHaveLength(1);
  expect(notes[0].at).toBe(text.lastIndexOf("\n"));
  expect(performance.now() - started).toBeLessThan(500);
});
