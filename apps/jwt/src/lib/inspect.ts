import { fromBase64, textFromBytes } from "@tools/bytes";
import { JsonError, strictObject } from "./signing.js";
export interface InspectedPart {
  text: string;
  object?: Record<string, unknown>;
  /** Each member's value as exact compact JSON. */
  raw?: Record<string, string>;
  error?: string;
  /** Where in `text` the JSON problem is, when known. */
  offset?: number;
}
export interface Inspection {
  header: InspectedPart;
  payload: InspectedPart;
  /** Empty for an unsigned token (alg none). */
  signature?: Uint8Array<ArrayBuffer>;
  input: string;
  error?: string;
  /** Where each of the three segments sits in the trimmed token. */
  segments: { from: number; to: number }[];
  valid: boolean;
}

/**
 * A token as it is often pasted, made compact: an `Authorization` header's "Bearer " dropped,
 * and the spaces and line breaks of a token wrapped in a log or an email taken out. None of them
 * can be part of a JWT. `what` says what went, for a note; empty when nothing did.
 */
export function cleanToken(value: string): { token: string; what: string } {
  const bearer = /^\s*Bearer\s+(?=\S)/i.exec(value);
  const rest = bearer ? value.slice(bearer[0].length) : value;
  const spaced = /\S\s+\S/.test(rest.trim());
  const token = bearer || spaced ? rest.replace(/\s+/g, "") : value;
  const what = [bearer ? 'the "Bearer " prefix' : "", spaced ? "spaces and line breaks" : ""]
    .filter(Boolean)
    .join(" and ");
  return { token, what };
}

function inspectPart(value: string | undefined): InspectedPart {
  if (!value) return { text: "", error: "Missing token part." };
  let text = "";
  try {
    text = textFromBytes(fromBase64(value.replace(/=+$/, ""), true));
    const result = strictObject(text);
    return {
      text: result.pretty,
      object: result.object,
      raw: result.raw,
      ...(value.includes("=") ? { error: "JWT Base64url must be unpadded." } : {}),
    };
  } catch (error) {
    return {
      text,
      error: (error as Error).message,
      ...(error instanceof JsonError && error.offset !== undefined ? { offset: error.offset } : {}),
    };
  }
}
/** Inspect each JSON segment independently, even if the other segment or signature is broken. */
export function inspectJwt(value: string): Inspection {
  const trimmed = value.trim(),
    parts = trimmed.split("."),
    segments: { from: number; to: number }[] = [];
  for (let i = 0, from = 0; i < parts.length; from += parts[i].length + 1, i++)
    segments.push({ from, to: from + parts[i].length });
  const header = inspectPart(parts[0]);
  // An encrypted token's second part is its encrypted key, not a payload to read.
  const encrypted = parts.length === 5 && header.object?.enc !== undefined;
  const payload = encrypted
    ? { text: "", error: "Encrypted: it cannot be read without the recipient's key." }
    : inspectPart(parts[1]);
  let signature: Uint8Array<ArrayBuffer> | undefined, error: string | undefined;
  try {
    if (encrypted)
      throw new Error(
        "This is an encrypted token (JWE): only its header can be read here, not its payload."
      );
    if (parts.length !== 3) throw new Error("A compact JWT needs three dot-separated parts.");
    const unsigned = header.object?.alg === "none";
    if (unsigned && parts[2])
      throw new Error("An unsigned token (alg none) must have an empty signature.");
    if (!unsigned && !parts[2]) throw new Error("The signature is empty.");
    signature = fromBase64(parts[2], true);
    if (typeof header.object?.alg !== "string") throw new Error("The header needs an alg string.");
  } catch (caught) {
    error = (caught as Error).message;
  }
  return {
    header,
    payload,
    signature,
    input: parts.slice(0, 2).join("."),
    error,
    segments,
    valid: !header.error && !payload.error && !error,
  };
}
