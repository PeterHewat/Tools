import { decodeBytes, fromBase64, toBase64, utf8, webCrypto } from "@tools/bytes";
import type { ByteFormat } from "@tools/bytes";
import { parse, printJson } from "@tools/json-core";

export const ALGORITHMS = [
  "HS256",
  "HS384",
  "HS512",
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
] as const;
export type SigningAlgorithm = (typeof ALGORITHMS)[number];
export type KeyFormat = ByteFormat | "jwk" | "pem";
export function isAlgorithm(value: unknown): value is SigningAlgorithm {
  return ALGORITHMS.includes(value as SigningAlgorithm);
}
function parameters(algorithm: SigningAlgorithm): {
  key: HmacImportParams | RsaHashedImportParams | EcKeyImportParams | Algorithm;
  operation: Algorithm | EcdsaParams | RsaPssParams;
} {
  const hash =
    "SHA-" + (algorithm.endsWith("256") ? "256" : algorithm.endsWith("384") ? "384" : "512");
  if (algorithm.startsWith("HS"))
    return { key: { name: "HMAC", hash }, operation: { name: "HMAC" } };
  if (algorithm.startsWith("RS"))
    return { key: { name: "RSASSA-PKCS1-v1_5", hash }, operation: { name: "RSASSA-PKCS1-v1_5" } };
  if (algorithm.startsWith("PS"))
    return {
      key: { name: "RSA-PSS", hash },
      operation: { name: "RSA-PSS", saltLength: Number(hash.slice(4)) / 8 },
    };
  if (algorithm.startsWith("ES"))
    return {
      key: {
        name: "ECDSA",
        namedCurve: algorithm === "ES256" ? "P-256" : algorithm === "ES384" ? "P-384" : "P-521",
      },
      operation: { name: "ECDSA", hash },
    };
  return { key: { name: "Ed25519" }, operation: { name: "Ed25519" } };
}
function publicJwk(key: JsonWebKey): JsonWebKey {
  const result = { ...key };
  for (const name of ["d", "p", "q", "dp", "dq", "qi", "oth", "key_ops"])
    delete result[name as keyof JsonWebKey];
  return result;
}
export function secretBytes(value: string, format: KeyFormat): Uint8Array<ArrayBuffer> {
  if (format === "pem") throw new Error("HMAC needs a shared secret, not a PEM key.");
  if (format === "jwk") {
    const jwk: JsonWebKey = JSON.parse(value);
    if (jwk.kty !== "oct" || !jwk.k) throw new Error("HMAC needs an oct JWK with a k value.");
    return fromBase64(jwk.k, true);
  }
  return decodeBytes(value, format);
}
async function importSigningKey(
  value: string,
  format: KeyFormat,
  algorithm: SigningAlgorithm,
  usage: "sign" | "verify"
): Promise<CryptoKey> {
  const subtle = webCrypto(),
    params = parameters(algorithm).key;
  if (format === "jwk") {
    const jwk: JsonWebKey = JSON.parse(value);
    if (jwk.alg && jwk.alg !== algorithm)
      throw new Error("The JWK algorithm does not match the selected algorithm.");
  }
  if (algorithm.startsWith("HS")) {
    const bytes = secretBytes(value, format);
    if (!bytes.length) throw new Error("Enter a non-empty shared secret.");
    return subtle.importKey("raw", bytes, params, false, [usage]);
  }
  if (format === "jwk") {
    let jwk: JsonWebKey = JSON.parse(value);
    if (jwk.alg && jwk.alg !== algorithm)
      throw new Error("The JWK algorithm does not match the selected algorithm.");
    if (usage === "verify" && jwk.d) jwk = publicJwk(jwk);
    return subtle.importKey("jwk", jwk, params, false, [usage]);
  }
  if (format !== "pem") throw new Error("Choose JWK or PEM for this signing algorithm.");
  const match =
    /^\s*-----BEGIN (PUBLIC KEY|PRIVATE KEY)-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END \1-----\s*$/.exec(
      value
    );
  if (!match)
    throw new Error(
      "Use a PUBLIC KEY (SPKI) or PRIVATE KEY (PKCS#8) PEM. Certificates and PKCS#1 keys are not supported."
    );
  const privateKey = match[1] === "PRIVATE KEY";
  if (usage === "sign" && !privateKey) throw new Error("Encoding needs a private signing key.");
  const imported = await subtle.importKey(
    privateKey ? "pkcs8" : "spki",
    fromBase64(match[2]),
    params,
    privateKey && usage === "verify",
    [privateKey ? "sign" : "verify"]
  );
  if (privateKey && usage === "verify")
    return subtle.importKey(
      "jwk",
      publicJwk(await subtle.exportKey("jwk", imported)),
      params,
      false,
      ["verify"]
    );
  return imported;
}
export async function signInput(
  input: string,
  value: string,
  format: KeyFormat,
  algorithm: SigningAlgorithm
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    algorithm.startsWith("HS") &&
    secretBytes(value, format).length < Number(algorithm.slice(2)) / 8
  )
    throw new Error(
      "Signing requires a shared secret of at least " + Number(algorithm.slice(2)) / 8 + " bytes."
    );
  const key = await importSigningKey(value, format, algorithm, "sign");
  if (
    "modulusLength" in key.algorithm &&
    typeof key.algorithm.modulusLength === "number" &&
    key.algorithm.modulusLength < 2048
  )
    throw new Error("Signing requires an RSA key of at least 2048 bits.");
  return new Uint8Array(await webCrypto().sign(parameters(algorithm).operation, key, utf8(input)));
}
export async function verifyInput(
  input: string,
  signature: Uint8Array<ArrayBuffer>,
  value: string,
  format: KeyFormat,
  algorithm: SigningAlgorithm
): Promise<boolean> {
  return webCrypto().verify(
    parameters(algorithm).operation,
    await importSigningKey(value, format, algorithm, "verify"),
    signature,
    utf8(input)
  );
}
export function strictObject(text: string): {
  object: Record<string, unknown>;
  compact: string;
  pretty: string;
} {
  const parsed = parse(text);
  if (!parsed.ok) throw new Error(parsed.message);
  if (parsed.edits.length || parsed.duplicates.length || parsed.root.kind !== "object")
    throw new Error("Use a strict JSON object with unique member names.");
  const object: unknown = JSON.parse(text);
  return {
    object: object as Record<string, unknown>,
    compact: printJson(parsed.root, { indent: 0 }),
    pretty: printJson(parsed.root),
  };
}
export async function encodeJwt(
  header: string,
  payload: string,
  value: string,
  format: KeyFormat,
  algorithm: SigningAlgorithm
): Promise<string> {
  const h = strictObject(header),
    p = strictObject(payload);
  if (h.object.alg !== algorithm)
    throw new Error("The header alg must match the selected algorithm.");
  if (h.object.crit !== undefined || h.object.b64 !== undefined)
    throw new Error("crit and b64 header extensions are not supported.");
  const input = toBase64(utf8(h.compact), true) + "." + toBase64(utf8(p.compact), true);
  return input + "." + toBase64(await signInput(input, value, format, algorithm), true);
}
function pem(bytes: ArrayBuffer, privateKey: boolean): string {
  const label = privateKey ? "PRIVATE KEY" : "PUBLIC KEY";
  return (
    "-----BEGIN " +
    label +
    "-----\n" +
    toBase64(new Uint8Array(bytes))
      .match(/.{1,64}/g)!
      .join("\n") +
    "\n-----END " +
    label +
    "-----"
  );
}
export interface Example {
  token: string;
  header: string;
  payload: string;
  key: string;
  publicKey: string;
  format: KeyFormat;
}
export async function generateExample(algorithm: SigningAlgorithm): Promise<Example> {
  const header = JSON.stringify({ alg: algorithm, typ: "JWT" }, null, 2);
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify(
    { sub: "1234567890", name: "Jane Doe", iat: now, exp: now + 3600 },
    null,
    2
  );
  let key: string,
    publicKey = "",
    format: KeyFormat;
  if (algorithm.startsWith("HS")) {
    key = toBase64(crypto.getRandomValues(new Uint8Array(Number(algorithm.slice(2)) / 8)), true);
    format = "base64url";
  } else {
    const params = parameters(algorithm).key;
    const generation =
      algorithm.startsWith("RS") || algorithm.startsWith("PS")
        ? { ...params, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }
        : params;
    const pair = (await webCrypto().generateKey(
      generation as RsaHashedKeyGenParams | EcKeyGenParams | Algorithm,
      true,
      ["sign", "verify"]
    )) as CryptoKeyPair;
    key = pem(await webCrypto().exportKey("pkcs8", pair.privateKey), true);
    publicKey = pem(await webCrypto().exportKey("spki", pair.publicKey), false);
    format = "pem";
  }
  return {
    token: await encodeJwt(header, payload, key, format, algorithm),
    header,
    payload,
    key,
    publicKey,
    format,
  };
}
/** Deterministic public sample so initial rendering does not wait for key generation. */
export async function defaultExample(): Promise<Example> {
  const header = '{"alg":"HS256","typ":"JWT"}';
  const payload = '{"sub":"1234567890","name":"Jane Doe","admin":true,"iat":1516239022}';
  const key = "a-public-example-secret-at-least-32-bytes";
  const input = toBase64(utf8(header), true) + "." + toBase64(utf8(payload), true);
  return {
    token: input + ".4bhpUTktU-sgMx6iTqJWQFgrOyE0m50EGfMS6N-UgOo",
    header: strictObject(header).pretty,
    payload: strictObject(payload).pretty,
    key,
    publicKey: "",
    format: "text",
  };
}
