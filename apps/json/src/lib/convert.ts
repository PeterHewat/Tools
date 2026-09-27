/**
 * The document in other formats: YAML, CSV, TypeScript types and JSON Schema.
 *
 * All work from the parsed tree rather than `JSON.parse` values, so numbers are written as the
 * document has them (a 64-bit ID stays exact) and key order is kept.
 */
import type { JsonNode } from "./ast.js";
import { printJson } from "./print.js";

const decode = (raw: string) => JSON.parse(raw) as string;
const isBlock = (node: JsonNode) =>
  (node.kind === "object" && node.members.length > 0) ||
  (node.kind === "array" && node.items.length > 0);

// ---------- YAML ----------

/** Words YAML 1.1 readers take as booleans or null, and so must be quoted as strings. */
const YAML_RESERVED = /^(?:true|false|null|yes|no|on|off|y|n|~)$/i;
/** Safe unquoted: starts with a letter or `_ $ /`, then no `:`, `#` or other indicators. */
const YAML_PLAIN = /^[A-Za-z_$/][\w $./@-]*$/;

/** A string as YAML: plain when that reads back the same, else JSON's double-quoted form. */
function yamlString(value: string, raw: string): string {
  return YAML_PLAIN.test(value) && !YAML_RESERVED.test(value) && !/\s$/.test(value) ? value : raw;
}

function yamlLines(node: JsonNode): string[] {
  switch (node.kind) {
    case "string":
      return [yamlString(decode(node.raw), node.raw)];
    case "number":
    case "boolean":
    case "null":
      return [node.raw];
    case "object": {
      if (!node.members.length) return ["{}"];
      const out: string[] = [];
      for (const m of node.members) {
        const key = yamlString(m.key, m.keyRaw);
        if (isBlock(m.value)) {
          out.push(`${key}:`);
          for (const line of yamlLines(m.value)) out.push(`  ${line}`);
        } else {
          out.push(`${key}: ${yamlLines(m.value)[0]}`);
        }
      }
      return out;
    }
    case "array": {
      if (!node.items.length) return ["[]"];
      const out: string[] = [];
      for (const item of node.items) {
        const [first, ...rest] = yamlLines(item);
        out.push(`- ${first}`);
        for (const line of rest) out.push(`  ${line}`);
      }
      return out;
    }
  }
}

export function toYaml(root: JsonNode): string {
  return `${yamlLines(root).join("\n")}\n`;
}

// ---------- CSV ----------

export type Converted = { ok: true; text: string } | { ok: false; message: string };

function csvCell(node: JsonNode | undefined): string {
  if (!node || node.kind === "null") return "";
  const text =
    node.kind === "string"
      ? decode(node.raw)
      : node.kind === "object" || node.kind === "array"
        ? printJson(node, { indent: 0 })
        : node.raw;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * An array as a table: one row per item, one column per key seen (in first-seen order).
 * Nested objects and arrays go in their cell as JSON; items that are not objects fill a
 * `value` column.
 */
export function toCsv(node: JsonNode): Converted {
  if (node.kind !== "array") {
    return {
      ok: false,
      message:
        "CSV needs an array. Put the cursor in one (or select one in the tree), or open a document that is one.",
    };
  }
  const columns: string[] = [];
  const seen = new Set<string>();
  const add = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      columns.push(key);
    }
  };
  for (const item of node.items) {
    if (item.kind === "object") for (const m of item.members) add(m.key);
    else add("value");
  }
  const rows = [
    columns.map((c) => csvCell({ kind: "string", start: 0, end: 0, raw: JSON.stringify(c) })),
  ];
  for (const item of node.items) {
    const byKey = new Map<string, JsonNode>();
    if (item.kind === "object") for (const m of item.members) byKey.set(m.key, m.value);
    else byKey.set("value", item);
    rows.push(columns.map((c) => csvCell(byKey.get(c))));
  }
  return { ok: true, text: rows.map((r) => r.join(",")).join("\r\n") + "\r\n" };
}

// ---------- Shapes: what TypeScript types and JSON Schema are made from ----------

type Primitive = "string" | "integer" | "number" | "boolean" | "null";

/** Every value seen at one place in the document, merged: array items all land in one shape. */
interface Shape {
  primitives: Set<Primitive>;
  object: { fields: Map<string, { shape: Shape; seen: number }>; count: number } | null;
  /** Items of every array seen here; null when only empty arrays were. */
  items: Shape | null;
  sawArray: boolean;
}

const emptyShape = (): Shape => ({
  primitives: new Set(),
  object: null,
  items: null,
  sawArray: false,
});

function addTo(shape: Shape, node: JsonNode): void {
  switch (node.kind) {
    case "string":
    case "boolean":
    case "null":
      shape.primitives.add(node.kind);
      return;
    case "number":
      shape.primitives.add(/^-?\d+$/.test(node.raw) ? "integer" : "number");
      return;
    case "object": {
      const object = (shape.object ??= { fields: new Map(), count: 0 });
      object.count++;
      // A repeated key counts once per object, with the value JSON.parse would keep.
      const last = new Map(node.members.map((m) => [m.key, m.value]));
      for (const [key, value] of last) {
        let field = object.fields.get(key);
        if (!field) object.fields.set(key, (field = { shape: emptyShape(), seen: 0 }));
        field.seen++;
        addTo(field.shape, value);
      }
      return;
    }
    case "array":
      shape.sawArray = true;
      for (const item of node.items) addTo((shape.items ??= emptyShape()), item);
  }
}

export function shapeOf(root: JsonNode): Shape {
  const shape = emptyShape();
  addTo(shape, root);
  return shape;
}

// ---------- TypeScript ----------

const IDENT = /^[A-Za-z_$][\w$]*$/;

function pascal(hint: string): string {
  const words = hint.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("") || "Item";
  return /^\d/.test(name) ? `T${name}` : name;
}

/** "shapes" → "Shape", "entries" → "Entry": a name for one item of an array. */
function singular(hint: string): string {
  if (/ies$/i.test(hint)) return hint.slice(0, -3) + "y";
  if (/[^s]s$/i.test(hint) && hint.length > 3) return hint.slice(0, -1);
  return `${hint}Item`;
}

/** Interfaces for every object shape, named after the keys they sit under. */
export function toTypeScript(root: JsonNode, rootName = "Root"): string {
  const names = new Set<string>();
  const queue: { name: string; object: NonNullable<Shape["object"]> }[] = [];
  const unique = (base: string) => {
    let name = base;
    for (let n = 2; names.has(name); n++) name = `${base}${n}`;
    names.add(name);
    return name;
  };

  const typeOf = (shape: Shape, hint: string): string => {
    const parts: string[] = [];
    const p = shape.primitives;
    if (p.has("string")) parts.push("string");
    if (p.has("integer") || p.has("number")) parts.push("number");
    if (p.has("boolean")) parts.push("boolean");
    if (shape.object) {
      const name = unique(pascal(hint));
      queue.push({ name, object: shape.object });
      parts.push(name);
    }
    if (shape.sawArray) {
      const item = shape.items ? typeOf(shape.items, singular(hint)) : "unknown";
      parts.push(item.includes(" | ") ? `(${item})[]` : `${item}[]`);
    }
    if (p.has("null")) parts.push("null");
    return parts.length ? parts.join(" | ") : "unknown";
  };

  const shape = shapeOf(root);
  const rootType = typeOf(shape, rootName);
  const out: string[] = [];
  if (rootType !== rootName) out.push(`export type ${rootName} = ${rootType};\n`);
  for (let k = 0; k < queue.length; k++) {
    const { name, object } = queue[k];
    const lines = [`export interface ${name} {`];
    for (const [key, field] of object.fields) {
      const prop = IDENT.test(key) ? key : JSON.stringify(key);
      const optional = field.seen < object.count ? "?" : "";
      lines.push(`  ${prop}${optional}: ${typeOf(field.shape, key)};`);
    }
    lines.push("}\n");
    out.push(lines.join("\n"));
  }
  return out.join("\n");
}

// ---------- JSON Schema ----------

type Schema = Record<string, unknown>;

function schemaOf(shape: Shape): Schema {
  const alternatives: Schema[] = [];
  const types = [...shape.primitives].filter(
    (t) => !(t === "integer" && shape.primitives.has("number"))
  );
  if (types.length) alternatives.push({ type: types.length === 1 ? types[0] : types });
  if (shape.object) {
    const properties: Record<string, Schema> = {};
    const required: string[] = [];
    for (const [key, field] of shape.object.fields) {
      properties[key] = schemaOf(field.shape);
      if (field.seen === shape.object.count) required.push(key);
    }
    alternatives.push({ type: "object", properties, ...(required.length ? { required } : {}) });
  }
  if (shape.sawArray) {
    alternatives.push({ type: "array", ...(shape.items ? { items: schemaOf(shape.items) } : {}) });
  }
  if (alternatives.length === 1) return alternatives[0];
  return alternatives.length ? { anyOf: alternatives } : {};
}

/** A JSON Schema (draft 2020-12) that the document, and documents shaped like it, satisfy. */
export function toJsonSchema(root: JsonNode): string {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...schemaOf(shapeOf(root)),
  };
  return `${JSON.stringify(schema, null, 2)}\n`;
}
