/**
 * The document a tab opens on when it has nothing of its own yet: small, but with something for
 * every view — one of every kind of value for the colours and for folding, a list of plain values,
 * and a list of objects that the CSV view shows as a table (and the types as an interface).
 *
 * It is also what the index page's card shows (`public/art.svg`); a test keeps the two the same.
 */
export const SAMPLE = `{
  "name": "Tools",
  "version": 1.4,
  "offline": true,
  "owner": null,
  "tags": ["json", "svg"],
  "apps": [
    { "id": "svg", "kb": 191 },
    { "id": "json", "kb": 43 }
  ]
}`;
