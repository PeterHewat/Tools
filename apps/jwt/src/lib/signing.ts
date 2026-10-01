import { decodeBytes, encodeBytes, fromBase64, toBase64, utf8, webCrypto } from "@tools/bytes";
import type { ByteFormat } from "@tools/bytes";
import { REPAIRS, parse, printJson } from "@tools/json-core";

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
/** Asymmetric keys are PEM or JWK, and which one is plain from the text. */
export function pairFormat(value: string): "pem" | "jwk" {
  return value.trimStart().startsWith("{") ? "jwk" : "pem";
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
/** The same secret bytes written in another encoding, so changing the encoding keeps the key. */
export function convertSecret(value: string, from: KeyFormat, to: KeyFormat): string {
  const bytes = secretBytes(value, from);
  if (to === "jwk") return JSON.stringify({ kty: "oct", k: toBase64(bytes, true) });
  if (to === "pem") throw new Error("HMAC needs a shared secret, not a PEM key.");
  try {
    return encodeBytes(bytes, to);
  } catch {
    throw new Error("The secret's bytes are not UTF-8 text.");
  }
}
/** A private key, as PEM or as a JWK with its private part. */
export function isPrivateKey(value: string): boolean {
  if (pairFormat(value) === "pem") return value.includes("-----BEGIN PRIVATE KEY-----");
  try {
    return "d" in (JSON.parse(value) as JsonWebKey);
  } catch {
    return false;
  }
}
/** The kind of key pair an algorithm needs, as messages name it. */
function keyKind(algorithm: SigningAlgorithm): string {
  if (algorithm.startsWith("RS") || algorithm.startsWith("PS")) return "an RSA";
  if (algorithm === "EdDSA") return "an Ed25519";
  return "a " + (parameters(algorithm).key as EcKeyImportParams).namedCurve + " EC";
}
/** Key types by the DER of their object identifier, as a PEM key names its own type. */
const KEY_OIDS: [kind: string, oid: string][] = [
  ["an RSA-PSS", "06092a864886f70d01010a"],
  ["an RSA", "06092a864886f70d010101"],
  ["a P-256 EC", "06082a8648ce3d030107"],
  ["a P-384 EC", "06052b81040022"],
  ["a P-521 EC", "06052b81040023"],
  ["an Ed25519", "06032b6570"],
  ["an Ed448", "06032b6571"],
  ["an X25519", "06032b656e"],
];
/** What kind of key the text holds, as `keyKind` names it, when it says; undefined if unsure. */
export function describeKey(value: string): string | undefined {
  try {
    if (pairFormat(value) === "jwk") {
      const jwk = JSON.parse(value) as JsonWebKey;
      if (jwk.kty === "RSA") return "an RSA";
      if (jwk.kty === "EC" && jwk.crv) return `a ${jwk.crv} EC`;
      if (jwk.kty === "OKP" && jwk.crv) return `an ${jwk.crv}`;
      if (jwk.kty === "oct") return "a shared-secret (oct)";
      return undefined;
    }
    const body = /-----BEGIN [A-Z ]+-----([A-Za-z0-9+/=\s]+)-----END/.exec(value)?.[1];
    if (!body) return undefined;
    const der = [...fromBase64(body)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    // The key's own type comes first; an EC key's curve follows it.
    const ec = der.includes("06072a8648ce3d0201");
    return KEY_OIDS.find(([kind, oid]) => der.includes(oid) && (ec || !kind.endsWith(" EC")))?.[0];
  } catch {
    return undefined;
  }
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
      throw new Error(`The JWK is for ${jwk.alg}, not ${algorithm}.`);
  }
  if (algorithm.startsWith("HS")) {
    const bytes = secretBytes(value, format);
    if (!bytes.length) throw new Error("Enter a non-empty shared secret.");
    return subtle.importKey("raw", bytes, params, false, [usage]);
  }
  if (format === "jwk") {
    let jwk: JsonWebKey = JSON.parse(value);
    if (usage === "verify" && jwk.d) jwk = publicJwk(jwk);
    if (usage === "sign" && !jwk.d) throw new Error("Signing needs a private key.");
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
  if (usage === "sign" && !privateKey) throw new Error("Signing needs a private key.");
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
/** Imports a key for the algorithm, or says plainly why it does not fit. */
export async function checkKey(
  value: string,
  format: KeyFormat,
  algorithm: SigningAlgorithm,
  usage: "sign" | "verify"
): Promise<CryptoKey> {
  // A key that names its own type is held to it: some browsers import a key of another kind
  // for an algorithm (Firefox, an Ed25519 key for ES256) and then sign with it regardless.
  const needed = algorithm.startsWith("HS") ? undefined : keyKind(algorithm),
    found = needed && describeKey(value);
  if (needed && found && found !== needed)
    throw new Error(`This is ${found} key: ${algorithm} needs ${needed} key.`);
  let key: CryptoKey;
  try {
    key = await importSigningKey(value, format, algorithm, usage);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("The JWK is not valid JSON.", { cause: error });
    if (!(error instanceof DOMException)) throw error;
    if (!needed) throw new Error("The secret cannot be used for HMAC.", { cause: error });
    // A key of the right kind, or of no kind it names, that the browser still cannot import.
    throw new Error(
      `Not a valid ${needed.replace(/^an? /, "")} key: it may be cut short or damaged.`,
      { cause: error }
    );
  }
  if (
    usage === "sign" &&
    "modulusLength" in key.algorithm &&
    typeof key.algorithm.modulusLength === "number" &&
    key.algorithm.modulusLength < 2048
  )
    throw new Error("Signing requires an RSA key of at least 2048 bits.");
  return key;
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
  const key = await checkKey(value, format, algorithm, "sign");
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
    await checkKey(value, format, algorithm, "verify"),
    signature,
    utf8(input)
  );
}
/** A JSON problem, with where it is when the parser knows. */
export class JsonError extends Error {
  constructor(
    message: string,
    readonly offset?: number
  ) {
    super(message);
  }
}
export interface StrictObject {
  object: Record<string, unknown>;
  /** Each member's value as exact compact JSON, so large integers keep every digit. */
  raw: Record<string, string>;
  compact: string;
  pretty: string;
}
export function strictObject(text: string): StrictObject {
  const parsed = parse(text);
  if (!parsed.ok) throw new JsonError(parsed.message, parsed.offset);
  if (parsed.edits.length)
    throw new JsonError(REPAIRS[parsed.edits[0].kind].message + ".", parsed.edits[0].start);
  if (parsed.duplicates.length)
    throw new JsonError(
      `${JSON.stringify(parsed.duplicates[0].key)} appears twice: each name may appear once.`,
      parsed.duplicates[0].offset
    );
  if (parsed.root.kind !== "object")
    throw new JsonError("Must be a JSON object, in braces { }.", parsed.root.start);
  const object: unknown = JSON.parse(text);
  return {
    object: object as Record<string, unknown>,
    raw: Object.fromEntries(
      parsed.root.members.map((member) => [member.key, printJson(member.value, { indent: 0 })])
    ),
    compact: printJson(parsed.root, { indent: 0 }),
    pretty: printJson(parsed.root),
  };
}
/** The header and payload of a JWT as its first two segments, before the signature. */
export function signingInput(header: StrictObject, payload: StrictObject): string {
  return toBase64(utf8(header.compact), true) + "." + toBase64(utf8(payload.compact), true);
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
  const input = signingInput(h, p);
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
export interface GeneratedKey {
  /** The shared secret, or the private key as PEM. */
  key: string;
  /** The public key as PEM; empty for HMAC. */
  publicKey: string;
  format: KeyFormat;
}
/** A fresh random secret of the algorithm's minimum length, or a fresh key pair. */
export async function generateKey(algorithm: SigningAlgorithm): Promise<GeneratedKey> {
  let key: string,
    publicKey = "",
    format: KeyFormat;
  if (algorithm.startsWith("HS")) {
    // Random bytes written as Base64url and used as text: a secret anyone can read, type or
    // paste, longer than the algorithm's minimum.
    key = toBase64(crypto.getRandomValues(new Uint8Array(Number(algorithm.slice(2)) / 8)), true);
    format = "text";
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
  return { key, publicKey, format };
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
/** The header with its alg set, keeping the rest of the text as it was typed. */
export function withAlg(header: string, algorithm: SigningAlgorithm): string {
  const parsed = parse(header);
  if (!parsed.ok || parsed.root.kind !== "object") return header;
  const member = parsed.root.members.find((candidate) => candidate.key === "alg");
  if (member)
    return (
      header.slice(0, member.value.start) +
      JSON.stringify(algorithm) +
      header.slice(member.value.end)
    );
  const open = parsed.root.start + 1;
  const indent = /\n([ \t]*)\S/.exec(header.slice(open))?.[1];
  const entry = JSON.stringify("alg") + ": " + JSON.stringify(algorithm);
  return parsed.root.members.length
    ? header.slice(0, open) +
        (indent === undefined ? entry + ", " : "\n" + indent + entry + ",") +
        header.slice(open)
    : header.slice(0, open) + entry + header.slice(open);
}
