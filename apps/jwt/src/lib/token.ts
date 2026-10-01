import { fromBase64, textFromBytes, utf8, webCrypto } from "@tools/bytes";
import type { HashAlgorithm } from "@tools/bytes";

export interface Token {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array<ArrayBuffer>;
}

function objectPart(part: string, label: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(textFromBytes(fromBase64(part, true)));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Expected an object");
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must be a Base64url-encoded UTF-8 JSON object.`);
  }
}

export function decodeToken(value: string): Token {
  const parts = value.trim().split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1])
    throw new Error("A signed JWT has three dot-separated parts: header.payload.signature.");
  const [header, payload, signature] = parts;
  return {
    header: objectPart(header, "Header"),
    payload: objectPart(payload, "Payload"),
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
            : seconds < 86400
              ? `${Math.floor(seconds / 3600)} h`
              : `${Math.floor(seconds / 86400)} d`;
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
