/**
 * Finding text in a document or a converted view. Stops counting at {@link MAX_MATCHES}, so a
 * one-letter search in a large document answers at once.
 */

export const MAX_MATCHES = 10_000;

export interface FindOptions {
  matchCase?: boolean;
}

/** Offsets where `query` starts in `text`, in order, without overlaps. */
export function findInText(
  text: string,
  query: string,
  { matchCase = false }: FindOptions = {}
): number[] {
  if (!query) return [];
  const hay = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  const found: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0 && found.length < MAX_MATCHES;) {
    found.push(i);
    i = hay.indexOf(needle, i + needle.length);
  }
  return found;
}
