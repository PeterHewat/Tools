import { fromBase64, textFromBytes } from "@tools/bytes";
import { strictObject } from "./signing.js";
export interface InspectedPart {
  text: string;
  object?: Record<string, unknown>;
  error?: string;
}
export interface Inspection {
  header: InspectedPart;
  payload: InspectedPart;
  signature?: Uint8Array<ArrayBuffer>;
  input: string;
  error?: string;
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
      ...(value.includes("=") ? { error: "JWT Base64url must be unpadded." } : {}),
    };
  } catch (error) {
    return { text, error: (error as Error).message };
  }
}
/** Inspect each JSON segment independently, even if the other segment or signature is broken. */
export function inspectJwt(value: string): Inspection {
  const parts = value.trim().split(".");
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
    valid: !header.error && !payload.error && !error,
  };
}
