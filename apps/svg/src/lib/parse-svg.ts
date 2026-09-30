/**
 * The one place SVG markup from outside - a file, a drop, a paste, the SVG panel - is parsed.
 *
 * Code scanning flags this parse as XSS and as an XML bomb; neither applies, and the alerts are
 * dismissed with this comment as the reason. Keep the parse here so that dismissal still matches:
 * - `DOMParser` builds a detached document. Its scripts and event handlers never run, and the
 *   importer only reads values out of it (numbers, `#rrggbb` colours, names and text that are
 *   escaped wherever shown); none of its markup is put into the page.
 * - Entities can only be declared in a DOCTYPE, so refusing one (and any stray `<!ENTITY`) rules
 *   out entity expansion. SVG written by editors does not need one.
 */
export function parseSvg(text: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("SVG with a DOCTYPE is not supported");
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  if (err) {
    const message = err.textContent?.match(/(?:error on )?line \d+[^\n]*/i)?.[0] ?? "Invalid SVG";
    throw new Error(message);
  }
  return doc;
}
