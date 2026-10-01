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

export interface ClaimRow {
  claim: string;
  /** Exact compact JSON of the value. */
  value: string;
  /** What the name means, when it is a known claim. */
  label?: string;
  /** NumericDate claims: the time in Unix seconds and how far it is from now. */
  time?: number;
  relative?: string;
  problem?: boolean;
}
/** One row per payload member, in token order, with time claims read as dates. */
export function claimRows(
  payload: Record<string, unknown>,
  raw: Record<string, string>,
  now = Date.now() / 1000
): ClaimRow[] {
  const times = new Map(claimTimes(payload, now).map((time) => [time.claim, time]));
  return Object.keys(raw).map((claim) => {
    const time = times.get(claim);
    return {
      claim,
      value: raw[claim],
      ...(Object.hasOwn(CLAIM_NAMES, claim) ? { label: CLAIM_NAMES[claim] } : {}),
      ...(time
        ? {
            ...(time.date === "Invalid NumericDate" ? {} : { time: payload[claim] as number }),
            relative: time.description,
            problem: time.problem,
          }
        : {}),
    };
  });
}
