/** Structural checks at file boundaries, before data reaches geometry or DOM code. */
export const plainId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z][\w-]*$/.test(value);

export const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const nonnegative = (value: unknown) => finite(value) && value >= 0;
const positive = (value: unknown) => finite(value) && value > 0;
const optional = (value: unknown, check: (value: unknown) => boolean) =>
  value === undefined || check(value);
const numbers = (value: unknown): value is number[] => Array.isArray(value) && value.every(finite);
const point = (value: unknown) => record(value) && finite(value.x) && finite(value.y);
const anchor = (value: unknown) =>
  record(value) &&
  point(value) &&
  typeof value.smooth === "boolean" &&
  (value.hIn === null || point(value.hIn)) &&
  (value.hOut === null || point(value.hOut));

export function validGeometry(el: Record<string, unknown>): boolean {
  if (
    !optional(el.name, (v) => typeof v === "string") ||
    !optional(el.rotation, finite) ||
    !optional(el.hidden, (v) => typeof v === "boolean") ||
    !optional(el.locked, (v) => typeof v === "boolean") ||
    !optional(el.fillRule, (v) => v === "evenodd") ||
    !optional(el.dash, (v) => Array.isArray(v) && v.every(nonnegative))
  )
    return false;
  switch (el.type) {
    case "path": {
      if (!Array.isArray(el.points) || !el.points.every(anchor) || typeof el.closed !== "boolean")
        return false;
      const length = el.points.length;
      return optional(
        el.subpaths,
        (v) =>
          numbers(v) &&
          v.every((n, i) => Number.isInteger(n) && n > 0 && n < length && (i === 0 || n > v[i - 1]))
      );
    }
    case "polyline":
    case "polygon":
      return Array.isArray(el.points) && el.points.every(point);
    case "line":
      return [el.x1, el.y1, el.x2, el.y2].every(finite);
    case "rect":
      return (
        [el.x, el.y].every(finite) &&
        [el.width, el.height, el.rx].every(nonnegative) &&
        optional(el.ry, nonnegative)
      );
    case "ellipse":
      return [el.cx, el.cy].every(finite) && [el.rx, el.ry].every(nonnegative);
    case "text":
      return (
        [el.x, el.y].every(finite) &&
        positive(el.fontSize) &&
        typeof el.text === "string" &&
        typeof el.fontFamily === "string" &&
        ["start", "middle", "end"].includes(String(el.anchor))
      );
    default:
      return false;
  }
}

export function validImage(img: Record<string, unknown>): boolean {
  return (
    [img.x, img.y, img.scaleX, img.scaleY, img.rotation].every(finite) &&
    typeof img.name === "string" &&
    typeof img.fileName === "string" &&
    typeof img.visible === "boolean" &&
    optional(img.naturalWidth, positive) &&
    optional(img.naturalHeight, positive)
  );
}

export function validCollections(doc: Record<string, unknown>): boolean {
  const dictionary = (value: unknown, check: (v: unknown) => boolean) =>
    optional(
      value,
      (v) => record(v) && Object.entries(v).every(([id, item]) => plainId(id) && check(item))
    );
  return (
    record(doc.grid) &&
    positive(doc.grid.step) &&
    typeof doc.grid.visible === "boolean" &&
    typeof doc.grid.snap === "boolean" &&
    dictionary(doc.groupNames, (v) => typeof v === "string") &&
    dictionary(doc.groupHues, finite) &&
    optional(doc.guides, (v) => record(v) && numbers(v.x) && numbers(v.y))
  );
}
