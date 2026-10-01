import { expect, test } from "bun:test";
import { fromBase64, toBase64, utf8 } from "@tools/bytes";
import {
  ALGORITHMS,
  defaultExample,
  encodeJwt,
  generateExample,
  checkKey,
  convertSecret,
  generateKey,
  isPrivateKey,
  JsonError,
  pairFormat,
  secretBytes,
  signInput,
  signingInput,
  strictObject,
  verifyInput,
  withAlg,
} from "./signing.js";
import { inspectJwt } from "./inspect.js";
import { constants, createHmac, createPublicKey, verify } from "node:crypto";

for (const algorithm of ALGORITHMS) {
  test(
    algorithm + " signs, verifies and rejects tampering with public/private key separation",
    async () => {
      const example = await generateExample(algorithm);
      const decoded = inspectJwt(example.token);
      expect(decoded.valid).toBe(true);
      const bits = algorithm.slice(-3);
      const hash = algorithm === "EdDSA" ? null : "sha" + bits;
      if (algorithm.startsWith("HS")) {
        expect(
          createHmac(hash!, secretBytes(example.key, example.format))
            .update(decoded.input)
            .digest("base64url")
        ).toBe(example.token.split(".")[2]);
      } else {
        expect(
          verify(
            hash,
            Buffer.from(decoded.input),
            {
              key: createPublicKey(example.publicKey),
              ...(algorithm.startsWith("PS")
                ? {
                    padding: constants.RSA_PKCS1_PSS_PADDING,
                    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
                  }
                : {}),
              ...(algorithm.startsWith("ES") ? { dsaEncoding: "ieee-p1363" as const } : {}),
            },
            Buffer.from(decoded.signature!)
          )
        ).toBe(true);
      }
      expect(
        await verifyInput(
          decoded.input,
          decoded.signature!,
          example.publicKey || example.key,
          example.format,
          algorithm
        )
      ).toBe(true);
      expect(
        await verifyInput(
          decoded.input + "x",
          decoded.signature!,
          example.publicKey || example.key,
          example.format,
          algorithm
        )
      ).toBe(false);
      if (example.publicKey) {
        expect(
          await verifyInput(
            decoded.input,
            decoded.signature!,
            example.key,
            example.format,
            algorithm
          )
        ).toBe(true);
        await expect(
          encodeJwt(example.header, example.payload, example.publicKey, "pem", algorithm)
        ).rejects.toThrow("private");
      }
    }
  );
}
test("strict JSON preserves integers and rejects ambiguous or unsupported signing input", async () => {
  expect(strictObject('{"id":9223372036854775807}').compact).toBe('{"id":9223372036854775807}');
  expect(() => strictObject('{"a":1,"a":2}')).toThrow("unique");
  expect(() => strictObject('{"a":1,}')).toThrow("strict");
  await expect(encodeJwt('{"alg":"HS512"}', "{}", "key", "text", "HS256")).rejects.toThrow("match");
  await expect(
    encodeJwt('{"alg":"HS256","crit":[]}', "{}", "key", "text", "HS256")
  ).rejects.toThrow("extensions");
  expect(secretBytes('{"kty":"oct","k":"YWJj"}', "jwk")).toEqual(utf8("abc"));
  expect(() => secretBytes('{"kty":"RSA"}', "jwk")).toThrow("oct");
  await expect(encodeJwt('{"alg":"HS256"}', "{}", "short", "text", "HS256")).rejects.toThrow(
    "at least 32"
  );
  await expect(
    verifyInput("x", utf8("x"), '{"kty":"oct","k":"YWJj","alg":"HS512"}', "jwk", "HS256")
  ).rejects.toThrow("match");
});
test("private and public JWKs interoperate and mismatched JWK algorithms are rejected", async () => {
  const example = await generateExample("RS256");
  const key = (await import("node:crypto")).createPrivateKey(example.key);
  const privateJwk = JSON.stringify(key.export({ format: "jwk" }));
  const publicJwk = JSON.stringify(createPublicKey(key).export({ format: "jwk" }));
  const decoded = inspectJwt(
    await encodeJwt(example.header, example.payload, privateJwk, "jwk", "RS256")
  );
  expect(await verifyInput(decoded.input, decoded.signature!, publicJwk, "jwk", "RS256")).toBe(
    true
  );
  expect(await verifyInput(decoded.input, decoded.signature!, privateJwk, "jwk", "RS256")).toBe(
    true
  );
  await expect(
    verifyInput(
      decoded.input,
      decoded.signature!,
      JSON.stringify({ ...createPublicKey(key).export({ format: "jwk" }), alg: "RS512" }),
      "jwk",
      "RS256"
    )
  ).rejects.toThrow("match");
});
test("default public sample verifies and partial decoding retains both recoverable segments", async () => {
  const example = await defaultExample(),
    decoded = inspectJwt(example.token);
  expect(await verifyInput(decoded.input, decoded.signature!, example.key, "text", "HS256")).toBe(
    true
  );
  const header = toBase64(utf8('{"alg":"HS256"}'), true);
  const payload = toBase64(utf8('{"incomplete":'), true);
  const partial = inspectJwt(header + "." + payload + ".!!");
  expect(partial.valid).toBe(false);
  expect(partial.header.object?.alg).toBe("HS256");
  expect(partial.payload.text).toBe('{"incomplete":');
  expect(partial.payload.error).toBeDefined();
  expect(inspectJwt(header + "." + toBase64(utf8('{"ok":true}'), true)).payload.object?.ok).toBe(
    true
  );
  expect(inspectJwt(header + "=.e30.AA").header.error).toContain("unpadded");
  expect(fromBase64(example.token.split(".")[2], true).length).toBe(32);
});
test("choosing an algorithm rewrites only the header's alg, keeping the text as typed", () => {
  expect(withAlg('{\n  "alg": "HS256",\n  "typ": "JWT"\n}', "RS256")).toBe(
    '{\n  "alg": "RS256",\n  "typ": "JWT"\n}'
  );
  expect(withAlg('{\n  "typ": "JWT"\n}', "ES256")).toBe('{\n  "alg": "ES256",\n  "typ": "JWT"\n}');
  expect(withAlg('{"typ":"JWT"}', "EdDSA")).toBe('{"alg": "EdDSA", "typ":"JWT"}');
  expect(withAlg("{}", "HS512")).toBe('{"alg": "HS512"}');
  expect(withAlg('{"alg":', "HS512")).toBe('{"alg":');
});
test("strict JSON reports where it fails and keeps each member's exact value", () => {
  const result = strictObject('{"id":9223372036854775807,"aud":["a", "b"]}');
  expect(result.raw).toEqual({ id: "9223372036854775807", aud: '["a","b"]' });
  for (const [source, offset] of [
    ['{"a":1 "b":2}', 7],
    ['{"a":1,"a":2}', 7],
    ['{"a":1,}', 6],
    ["[1]", 0],
  ] as const) {
    let caught: unknown;
    try {
      strictObject(source);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JsonError);
    expect((caught as JsonError).offset).toBe(offset);
  }
});
test("key pairs: generated keys sign, a public key cannot, and the format is read from the text", async () => {
  expect(pairFormat('  {"kty":"EC"}')).toBe("jwk");
  expect(pairFormat("-----BEGIN PUBLIC KEY-----")).toBe("pem");
  const header = strictObject('{"alg":"ES256"}'),
    payload = strictObject('{"sub":"x"}');
  const input = signingInput(header, payload);
  expect(input).toBe(
    toBase64(utf8('{"alg":"ES256"}'), true) + "." + toBase64(utf8('{"sub":"x"}'), true)
  );
  const pair = await generateKey("ES256");
  expect(pair.format).toBe("pem");
  const publicJwk = JSON.stringify(createPublicKey(pair.publicKey).export({ format: "jwk" }));
  await expect(signInput(input, publicJwk, "jwk", "ES256")).rejects.toThrow("private key");
  await expect(signInput(input, pair.publicKey, "pem", "ES256")).rejects.toThrow("private key");
  const signature = await signInput(input, pair.key, "pem", "ES256");
  expect(await verifyInput(input, signature, publicJwk, "jwk", "ES256")).toBe(true);
  const secret = await generateKey("HS384");
  expect(secret.format).toBe("text");
  expect(secretBytes(secret.key, secret.format).length).toBeGreaterThanOrEqual(48);
  expect(secret.publicKey).toBe("");
  expect(isPrivateKey(pair.key)).toBe(true);
  expect(isPrivateKey(pair.publicKey)).toBe(false);
  expect(isPrivateKey(publicJwk)).toBe(false);
  await expect(checkKey(pair.publicKey, "pem", "ES384", "verify")).rejects.toThrow(
    "Not a P-384 EC key"
  );
  await expect(checkKey("{", "jwk", "RS256", "verify")).rejects.toThrow("not valid JSON");
});
test("changing the encoding rewrites the secret as the same bytes", () => {
  expect(convertSecret("abc", "text", "base64url")).toBe("YWJj");
  expect(convertSecret("YWJj", "base64url", "hex")).toBe("616263");
  expect(convertSecret("616263", "hex", "jwk")).toBe('{"kty":"oct","k":"YWJj"}');
  expect(convertSecret('{"kty":"oct","k":"YWJj"}', "jwk", "text")).toBe("abc");
  expect(convertSecret("-_8", "base64url", "base64")).toBe("+/8=");
  expect(() => convertSecret("-_8", "base64url", "text")).toThrow("not UTF-8");
});
