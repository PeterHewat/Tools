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
  signature?: Uint8Array<ArrayBuffer>;
  input: string;
  error?: string;
  /** Where each of the three segments sits in the trimmed token. */
  segments: { from: number; to: number }[];
  valid: boolean;
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
  const header = inspectPart(parts[0]),
    payload = inspectPart(parts[1]);
  let signature: Uint8Array<ArrayBuffer> | undefined, error: string | undefined;
  try {
    if (parts.length !== 3) throw new Error("A compact JWT needs three dot-separated parts.");
    if (!parts[2]) throw new Error("The signature is empty.");
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
