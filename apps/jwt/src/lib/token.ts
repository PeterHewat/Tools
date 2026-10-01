import { fromBase64, textFromBytes, utf8, webCrypto } from "@tools/bytes";
import type { HashAlgorithm } from "@tools/bytes";
import { parse, printJson } from "@tools/json-core";

export interface Token {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  headerText: string;
  payloadText: string;
  signingInput: string;
  signature: Uint8Array<ArrayBuffer>;
}

function objectPart(part: string, label: string): { value: Record<string, unknown>; text: string } {
  try {
    const source = textFromBytes(fromBase64(part, true));
    const parsed = parse(source);
    if (!parsed.ok || parsed.edits.length || parsed.duplicates.length)
      throw new Error("Expected strict JSON with unique member names");
    const value: unknown = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Expected an object");
    return { value: value as Record<string, unknown>, text: printJson(parsed.root) };
  } catch {
    throw new Error(
      `${label} must be a Base64url-encoded UTF-8 JSON object with unique member names.`
    );
  }
}

export function decodeToken(value: string): Token {
  const parts = value.trim().split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1])
    throw new Error("A signed JWT has three dot-separated parts: header.payload.signature.");
  const [header, payload, signature] = parts;
  const decodedHeader = objectPart(header, "Header");
  const decodedPayload = objectPart(payload, "Payload");
  return {
    header: decodedHeader.value,
    payload: decodedPayload.value,
    headerText: decodedHeader.text,
    payloadText: decodedPayload.text,
    signingInput: `${header}.${payload}`,
    signature: fromBase64(signature, true),
  };
}

export type HmacAlgorithm = "HS256" | "HS384" | "HS512";
export async function verifyToken(
  token: Token,
  key: Uint8Array<ArrayBuffer>,
  algorithm: HmacAlgorithm
): Promise<boolean> {
  if (token.header.alg !== algorithm)
    throw new Error("The selected algorithm does not match the token header.");
  if (token.header.crit !== undefined || token.header.b64 !== undefined)
    throw new Error("Tokens with crit or b64 header extensions cannot be verified here.");
  if (!key.length) throw new Error("Enter a non-empty verification key.");
  const hash: HashAlgorithm = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" }[
    algorithm
  ] as HashAlgorithm;
  const subtle = webCrypto();
  const imported = await subtle.importKey("raw", key, { name: "HMAC", hash }, false, ["verify"]);
  return subtle.verify("HMAC", imported, token.signature, utf8(token.signingInput));
}

export interface ClaimTime {
  claim: string;
  date: string;
  description: string;
  problem: boolean;
}
export function claimTimes(payload: Record<string, unknown>, now = Date.now() / 1000): ClaimTime[] {
  return ["exp", "iat", "nbf"]
    .filter((claim) => Object.hasOwn(payload, claim))
    .map((claim) => {
      const value = payload[claim];
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value * 1000) > 8.64e15)
        return {
          claim,
          date: "Invalid NumericDate",
          description: "Expected a finite Unix timestamp in seconds.",
          problem: true,
        };
      const difference = value - now;
      const seconds = Math.abs(Math.round(difference));
      const duration =
        seconds < 60
          ? `${seconds} s`
          : seconds < 3600
            ? `${Math.floor(seconds / 60)} min`
            : seconds < 172800
              ? `${Math.floor(seconds / 3600)} h`
              : seconds < 2 * 31557600
                ? `${Math.floor(seconds / 86400)} days`
                : `${Math.floor(seconds / 31557600)} years`;
      const description =
        claim === "exp"
          ? difference <= 0
            ? `Expired ${duration} ago`
            : `Expires in ${duration}`
          : claim === "nbf"
            ? difference > 0
              ? `Not valid for ${duration}`
              : `Valid since ${duration} ago`
            : difference > 0
              ? `Issued ${duration} in the future`
              : `Issued ${duration} ago`;
      return {
        claim,
        date: new Date(value * 1000).toISOString(),
        description,
        problem: claim === "exp" ? difference <= 0 : difference > 0,
      };
    });
}

/** What the registered (RFC 7519) and common OpenID Connect claim names mean. */
export const CLAIM_NAMES: Readonly<Record<string, string>> = {
  iss: "Issuer",
  sub: "Subject",
  aud: "Audience",
  exp: "Expiration time",
  nbf: "Not before",
  iat: "Issued at",
  jti: "JWT ID",
  azp: "Authorized party",
  auth_time: "Authentication time",
  nonce: "Nonce",
  scope: "Scope",
  client_id: "Client ID",
  sid: "Session ID",
  name: "Full name",
  given_name: "Given name",
  family_name: "Family name",
  preferred_username: "Preferred username",
  email: "Email address",
  email_verified: "Email verified",
  roles: "Roles",
  groups: "Groups",
};

/** What header parameters mean (RFC 7515). */
export const HEADER_NAMES: Readonly<Record<string, string>> = {
  alg: "Algorithm",
  typ: "Token type",
  cty: "Content type",
  kid: "Key ID",
  jku: "JWK Set URL",
  jwk: "JSON Web Key",
  x5u: "X.509 URL",
  x5c: "X.509 certificate chain",
  x5t: "X.509 SHA-1 thumbprint",
  "x5t#S256": "X.509 SHA-256 thumbprint",
  crit: "Critical extensions",
  b64: "Payload encoding",
};
const ALGORITHM_NAMES: Readonly<Record<string, string>> = {
  HS256: "HMAC with SHA-256",
  HS384: "HMAC with SHA-384",
  HS512: "HMAC with SHA-512",
  RS256: "RSA PKCS#1 v1.5 with SHA-256",
  RS384: "RSA PKCS#1 v1.5 with SHA-384",
  RS512: "RSA PKCS#1 v1.5 with SHA-512",
  PS256: "RSA-PSS with SHA-256",
  PS384: "RSA-PSS with SHA-384",
  PS512: "RSA-PSS with SHA-512",
  ES256: "ECDSA P-256 with SHA-256",
  ES384: "ECDSA P-384 with SHA-384",
  ES512: "ECDSA P-521 with SHA-512",
  EdDSA: "EdDSA (Ed25519)",
  none: "none: not signed",
};

/** "Issued 8 years ago" reads as "8 years ago" after "Issued at"; the rest lower-cased. */
const relative = (description: string): string =>
  description.startsWith("Issued ")
    ? description.slice("Issued ".length)
    : description.charAt(0).toLowerCase() + description.slice(1);

export interface MemberNote {
  /** The end of the member's line, where the note goes. */
  at: number;
  text: string;
  /** Expired, not yet valid, issued in the future or not a date. */
  problem: boolean;
}
/**
 * What each member of a header or payload means, to show beside it: "Expiration time · 14 Nov
 * 2023 · expired 2 years ago". A note goes at the end of the member's line, so only members
 * with a line to themselves get one (compact JSON on one line gets none). Unknown names get none.
 */
export function memberNotes(
  text: string,
  part: "header" | "payload",
  formatDate: (seconds: number) => string,
  now = Date.now() / 1000
): MemberNote[] {
  const parsed = parse(text);
  if (!parsed.ok || parsed.root.kind !== "object") return [];
  const lineOf = (offset: number) => text.slice(0, offset).split("\n").length;
  const perLine = new Map<number, number>();
  for (const member of parsed.root.members) {
    const line = lineOf(member.keyStart);
    perLine.set(line, (perLine.get(line) ?? 0) + 1);
  }
  const notes: MemberNote[] = [];
  for (const member of parsed.root.members) {
    if (perLine.get(lineOf(member.keyStart)) !== 1) continue;
    const names = part === "header" ? HEADER_NAMES : CLAIM_NAMES;
    if (!Object.hasOwn(names, member.key)) continue;
    let note = names[member.key],
      problem = false;
    const value: unknown =
      member.value.kind === "object" || member.value.kind === "array"
        ? undefined
        : JSON.parse(member.value.raw);
    if (part === "header" && member.key === "alg")
      note +=
        ": " +
        (typeof value === "string" && Object.hasOwn(ALGORITHM_NAMES, value)
          ? ALGORITHM_NAMES[value]
          : "not one this tool knows");
    if (part === "payload" && ["exp", "nbf", "iat"].includes(member.key)) {
      const time = claimTimes({ [member.key]: value }, now)[0];
      problem = time.problem;
      note +=
        typeof value === "number" && time.date !== "Invalid NumericDate"
          ? ` · ${formatDate(value)} (${relative(time.description)})`
          : " · not a NumericDate (Unix seconds)";
    }
    const end = text.indexOf("\n", member.keyStart);
    notes.push({ at: end < 0 ? text.length : end, text: note, problem });
  }
  return notes;
}
