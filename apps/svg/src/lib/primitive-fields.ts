import { getState, setState, mutateDocument, findElement, replaceElements } from "./state.js";
import { setElementClosed } from "./selection-commands.js";
import { pushUndo, undoStepper } from "./undo.js";
import { DASH_STYLES, dashPreset, dashStyleOf, keepDashStyle, type DashStyle } from "./dash.js";
import { addTurn, turnedBy } from "./session.js";
import {
  MARKER_TYPES,
  MARKER_SHAPES,
  canToggleClosed,
  isClosedShape,
  elementBBox,
  gradientStops,
  PAINT_KEYS,
  type PaintKind,
  keepsRotation,
  parseDash,
} from "./model.js";
import { closeColorPicker, isColorPickerOpenFor, openColorPicker } from "@tools/ui";
import { escapeAttr } from "./utils.js";
import { membersOf } from "./groups.js";
import type { BBox, SceneElement } from "./types.js";
import { rotateAll, setBoxField, unionBox, type BoxField } from "./selection-transform.js";
import { holdSvgFocus, setSvgFocus } from "./svg-source.js";

/**
 * Shapes whose Dash menu reads Custom although their numbers match a named style: chosen here so
 * that the pattern can be typed. Where you are, not part of the drawing, like a folded group.
 */
const customDash = new Set<string>();

export function dashStyleFor(el: SceneElement): DashStyle {
  return customDash.has(el.id) ? "custom" : dashStyleOf(el);
}

function swatchHtml(kind: string, color: string, alpha: number, title: string): string {
  return `<button type="button" class="color-swatch" data-picker="${kind}" title="${title}" style="--c:${color};--a:${alpha}"><span class="color-swatch-fill"></span></button>`;
}

type Option = string | [string, string];

function selectHtml(field: string, value: string, options: readonly Option[]): string {
  const opts = options
    .map((o) => {
      const [v, label] = Array.isArray(o) ? o : [o, o];
      return `<option value="${v}"${v === value ? " selected" : ""}>${label}</option>`;
    })
    .join("");
  return `<select data-field="${field}">${opts}</select>`;
}

/**
 * Position and size, as numbers to type. Every shape reports the same four, measured from its
 * bounding box, so one set of fields works for a rect, an ellipse and a traced path alike -
 * and typing a number is the one way to be exact that a fingertip cannot manage.
 */
function geometryRowsHtml(el: SceneElement): string {
  const box = elementBBox(el);
  if (!box) return "";
  // Ordinary field rows, not a grid of their own: they land in the same two columns, with the
  // same label width and the same control width, as every other field in the body.
  const field = (key: string, label: string, aria: string, value: number, step = 1, min?: number) =>
    `<label class="field-row"><span>${label}</span><input type="number" data-field="${key}" step="${step}"${
      min == null ? "" : ` min="${min}"`
    } value="${Math.round(value * 100) / 100}" aria-label="${aria}" /></label>`;
  const position = field("geomX", "X", "X", box.x) + field("geomY", "Y", "Y", box.y);
  // Text has no width of its own - its size is the font size, which has its own field.
  const size =
    el.type === "text"
      ? ""
      : field("geomW", "W", "Width", box.width, 1, 0) +
        field("geomH", "H", "Height", box.height, 1, 0);
  // Only the shapes that store an angle get a field for it; on a path it is baked into points.
  const angle = keepsRotation(el)
    ? field("rotation", "Angle", "Rotation (degrees)", el.rotation ?? 0, 5)
    : "";
  return position + size + angle;
}

export function primitiveBodyHtml(el: SceneElement): string {
  const rows: string[] = [geometryRowsHtml(el)];
  if (el.type === "text") {
    rows.push(
      `<div class="field-row field-row--wide"><span>Text</span><input type="text" data-field="text" value="${escapeAttr(el.text)}" /></div>`,
      `<div class="field-row"><span>Size</span><input type="number" data-field="fontSize" min="1" step="1" value="${el.fontSize}" /></div>`,
      `<div class="field-row"><span>Font</span>${selectHtml("fontFamily", el.fontFamily, ["sans-serif", "serif", "monospace", "cursive"])}</div>`,
      `<div class="field-row"><span>Align</span>${selectHtml("anchor", el.anchor || "start", [
        ["start", "left"],
        ["middle", "center"],
        ["end", "right"],
      ])}</div>`
    );
  }
  rows.push(
    `<div class="field-row"><span>Stroke</span>${swatchHtml("stroke", el.stroke, el.strokeOpacity, "Stroke color and opacity")}</div>`,
    `<div class="field-row"><span>Stroke type</span>${selectHtml("strokeType", el.strokeType, [
      ["solid", "Solid"],
      ["linear", "Linear Gradient"],
      ["radial", "Radial Gradient"],
    ])}</div>`,
    gradientStopsHtml(el, "stroke")
  );
  if (el.type !== "line") {
    rows.push(
      `<div class="field-row"><label class="fill-toggle"><span>Fill</span><input type="checkbox" data-field="fillEnabled"${el.fillEnabled ? " checked" : ""} /></label>${swatchHtml("fill", el.fill, el.fillOpacity, "Fill color and opacity")}</div>`,
      `<div class="field-row"><span>Fill type</span>${selectHtml("fillType", el.fillType, [
        ["solid", "Solid"],
        ["linear", "Linear Gradient"],
        ["radial", "Radial Gradient"],
      ])}</div>`,
      gradientStopsHtml(el, "fill")
    );
  }
  // Where outlines overlap - a hole, a shape crossing itself - the rule decides what is inside.
  if (el.type === "path" || el.type === "polygon" || el.type === "polyline") {
    rows.push(
      `<div class="field-row" title="Where outlines overlap: non-zero fills a hole drawn the same way round as its shape, even-odd leaves every other overlap empty"><span>Fill rule</span>${selectHtml(
        "fillRule",
        el.fillRule ?? "nonzero",
        [
          ["nonzero", "Non-zero"],
          ["evenodd", "Even-odd"],
        ]
      )}</div>`
    );
  }
  if (canToggleClosed(el)) {
    rows.push(
      `<div class="field-row"><label class="fill-toggle"><span>Closed</span><input type="checkbox" data-field="closed"${isClosedShape(el) ? " checked" : ""} /></label></div>`
    );
  }
  rows.push(
    `<div class="field-row"><span>Width</span><input type="number" data-field="strokeWidth" min="0" step="0.5" value="${el.strokeWidth}" /></div>`,
    `<div class="field-row"><span>Line cap</span>${selectHtml("linecap", el.linecap, ["round", "butt", "square"])}</div>`,
    `<div class="field-row field-row--line-start" title="Solid, or a dash pattern worked out from the stroke width"><span>Dash</span>${selectHtml("dashStyle", dashStyleFor(el), DASH_STYLES)}</div>`,
    `<div class="field-row" title="Dash and gap lengths along the stroke, taking turns - 6 4 is a dash of 6 then a gap of 4. Choose Custom to type your own."><span>Pattern</span><input type="text" data-field="dash" inputmode="decimal" placeholder="${dashStyleFor(el) === "custom" ? "6 4" : "none"}" value="${escapeAttr((el.dash ?? []).join(" "))}" aria-label="Dash pattern"${dashStyleFor(el) === "custom" ? "" : " disabled"} /></div>`,
    `<div class="field-row"><span>Line join</span>${selectHtml("linejoin", el.linejoin, ["round", "miter", "bevel"])}</div>`
  );
  if (el.type === "rect") {
    rows.push(
      `<div class="field-row"><span>Corner X</span><input type="number" data-field="rx" min="0" step="1" value="${Math.round(el.rx)}" /></div>`,
      `<div class="field-row"><span>Corner Y</span><input type="number" data-field="ry" min="0" step="1" value="${Math.round(el.ry ?? el.rx)}" /></div>`
    );
  }
  if (MARKER_TYPES.includes(el.type)) {
    rows.push(
      `<div class="field-row"><span>Start</span>${selectHtml("markerStart", el.markerStart, MARKER_SHAPES)}</div>`,
      `<div class="field-row"><span>End</span>${selectHtml("markerEnd", el.markerEnd, MARKER_SHAPES)}</div>`
    );
  }
  return rows.join("");
}

/**
 * A paint's gradient stops, one row each: colour, where it sits along the gradient, and a way to
 * remove it. Where the gradient *runs* is not here - that is the two handles on the canvas,
 * which beat typing an angle on a touch screen and can express more than an angle could.
 * Shown only while that paint is a gradient (styles.css, by the row's paint types).
 */
function gradientStopsHtml(el: SceneElement, kind: PaintKind): string {
  const stops = gradientStops(el, kind);
  const rows = stops
    .map(
      (stop, i) =>
        `<div class="grad-stop">
          ${swatchHtml(`${kind}-stop-${i}`, stop.color, stop.opacity, `Stop ${i + 1} colour and opacity`)}
          <input type="number" data-field="${kind}StopOffset" data-stop="${i}" min="0" max="100" step="1"
            value="${Math.round(stop.offset * 100)}" aria-label="Stop ${i + 1} position (%)" />
          <span class="grad-stop-unit">%</span>
          <button type="button" class="grad-stop-del" data-stop-remove="${i}" title="Remove stop"
            aria-label="Remove stop ${i + 1}"${stops.length > 2 ? "" : " disabled"}><svg class="glyph" aria-hidden="true"><use href="#icon-clear" /></svg></button>
        </div>`
    )
    .join("");
  return `<div class="field-row field-row--wide ${kind}-grad-only grad-stops-row" data-paint="${kind}"><span>Stops</span>
      <div class="grad-stops">${rows}
        <button type="button" class="ui-btn ui-btn--small grad-stop-add" data-stop-add title="Add a stop"><svg class="glyph" aria-hidden="true"><use href="#icon-plus" /></svg>Add stop</button>
      </div>
    </div>`;
}

/** Field sessions, geometry, paint controls and undo live together; list rendering stays outside. */
export function bindPrimitiveFields(primitiveListEl: HTMLElement, refresh: () => void): void {
  /** A shape's position and size fields, by the edge of its box each one sets. */
  const GEOMETRY_FIELDS: Record<string, BoxField> = {
    geomX: "x",
    geomY: "y",
    geomW: "width",
    geomH: "height",
  };

  /**
   * A spinner step on a position or size field - a shape's or a group's - lands on the next whole
   * number, so 5.2 goes to 6 and 5, not 6.2 and 4.2. `box` is what the field showed, to two
   * decimals; the shapes themselves change on the `change` that follows.
   */
  function stepToWhole(input: HTMLInputElement, box: BBox | null, key: BoxField): void {
    const v = parseFloat(input.value);
    if (!box || Number.isNaN(v)) return;
    const from = Math.round(box[key] * 100) / 100;
    if (v === from) return;
    input.value = String(v > from ? Math.floor(from + 1e-9) + 1 : Math.ceil(from - 1e-9) - 1);
  }

  function applyToElement(id: string, fn: (el: SceneElement) => void): void {
    if (!findElement(id)) return;
    pushUndo();
    mutateDocument(() => {
      const el = findElement(id);
      if (el) fn(el);
    });
  }

  const NUMERIC_FIELDS: Record<string, (v: number) => number> = {
    strokeWidth: (v) => Math.max(0, v),
    fontSize: (v) => Math.max(1, v),
    rx: (v) => Math.max(0, v),
    ry: (v) => Math.max(0, v),
    rotation: (v) => ((v % 360) + 360) % 360,
  };

  // Fields that update the shape (and the SVG panel) live while typing; one undo step per session.
  const LIVE_TEXT = ["text", "name"];
  const LIVE_NUMBER = ["fontSize", "strokeWidth", "rx", "ry"];
  const WRAPPING_ANGLES = ["rotation"];

  /** The undo step of the field being edited: one for all the typing in it. */
  let fieldStep = undoStepper();

  primitiveListEl.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.hasAttribute("data-group-name")) return;
    const gid = input.closest<HTMLElement>("[data-group-id]")?.dataset.groupId;
    if (!gid) return;
    const name = input.value.trim();
    if ((getState().groupNames[gid] ?? "") === name) return;
    fieldStep();
    setState((s) => {
      const groupNames = { ...s.groupNames };
      if (name) groupNames[gid] = name;
      else delete groupNames[gid];
      return { ...s, groupNames };
    });
  });

  /** A named dash style follows the stroke's width and cap as they change; a custom one does not. */
  function restyleDash(el: SceneElement, before: SceneElement): void {
    if (!customDash.has(el.id)) keepDashStyle(el, before);
  }

  /**
   * A Custom dash pattern, applied as it is typed. Only digits, points and spaces go in - pasted
   * text too - and a pattern half typed (a lone "."), or all zeros, waits rather than turning the
   * line solid under the typing. One undo step for the whole edit, as for a name.
   */
  function liveDash(input: HTMLInputElement): void {
    const raw = input.value;
    const clean = raw.replace(/[^\d. ]/g, "");
    if (clean !== raw) {
      const caret = input.selectionStart ?? clean.length;
      const removed =
        raw.slice(0, caret).length - raw.slice(0, caret).replace(/[^\d. ]/g, "").length;
      input.value = clean;
      input.setSelectionRange(caret - removed, caret - removed);
    }
    const el = findElement(
      input.closest<HTMLElement>("[data-element-id]")?.dataset.elementId ?? ""
    );
    if (!el) return;
    const dash = parseDash(clean);
    if (!dash && clean.trim()) return;
    if ((dash ?? []).join(" ") === (el.dash ?? []).join(" ")) return;
    fieldStep();
    mutateDocument(() => {
      if (dash) el.dash = dash;
      else delete el.dash;
    });
  }

  /* Group fields: position, size and a turn for every member at once. */
  primitiveListEl.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    const key = input.dataset?.groupField;
    const gid = input.closest<HTMLElement>("[data-group-id]")?.dataset.groupId;
    if (!key || !gid || key === "turn" || (e as InputEvent).inputType) return;
    stepToWhole(input, unionBox(membersOf(getState().elements, gid)), key as BoxField);
  });

  primitiveListEl.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const key = input.dataset?.groupField;
    const gid = input.closest<HTMLElement>("[data-group-id]")?.dataset.groupId;
    if (!key || !gid) return;
    const members = membersOf(getState().elements, gid);
    const v = parseFloat(input.value);
    let next: SceneElement[] | null = null;
    if (key === "turn") {
      // The field reads the running total, so what is typed is turned by the difference.
      const box = unionBox(members);
      const ids = members.map((e) => e.id);
      const by = Number.isFinite(v) ? v - turnedBy(ids) : 0;
      if (box && by) {
        // A whole turn moves nothing, but still counts.
        if (by % 360) next = rotateAll(members, by, box.x + box.width / 2, box.y + box.height / 2);
        addTurn(ids, by);
      } else {
        input.value = String(turnedBy(ids));
      }
    } else {
      next = setBoxField(members, key as BoxField, v);
    }
    if (!next) {
      refresh();
      return;
    }
    pushUndo();
    replaceElements(next);
  });

  primitiveListEl.addEventListener("focusin", () => {
    fieldStep = undoStepper();
  });

  primitiveListEl.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    const field = input.dataset?.field;
    if (!field) return;

    // Spinner arrows (no inputType) wrap the angle around instead of running past 0/360.
    if (!(e as InputEvent).inputType && WRAPPING_ANGLES.includes(field)) {
      const v = parseFloat(input.value);
      if (!Number.isNaN(v)) input.value = String(((v % 360) + 360) % 360);
      return;
    }

    if (!(e as InputEvent).inputType && field in GEOMETRY_FIELDS) {
      const el = findElement(input.closest<HTMLElement>("[data-element-id]")?.dataset.elementId);
      stepToWhole(input, el ? elementBBox(el) : null, GEOMETRY_FIELDS[field]!);
      return;
    }

    if (field === "dash") {
      liveDash(input);
      return;
    }

    if (!LIVE_TEXT.includes(field) && !LIVE_NUMBER.includes(field)) return;
    const li = input.closest<HTMLElement>("[data-element-id]");
    const el = li?.dataset.elementId ? findElement(li.dataset.elementId) : undefined;
    if (!el) return;
    let value: string | number = input.value;
    if (LIVE_NUMBER.includes(field)) {
      const v = parseFloat(input.value);
      if (Number.isNaN(v)) return;
      value = NUMERIC_FIELDS[field]!(v);
    }
    const target = el as unknown as Record<string, unknown>;
    if (target[field] === value) return;
    fieldStep();
    mutateDocument(() => {
      const before = { ...el };
      target[field] = value;
      restyleDash(el, before);
    });
  });

  primitiveListEl.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const field = input.dataset?.field;
    if (!field || field === "text") return;
    const li = input.closest<HTMLElement>("[data-element-id]");
    const id = li?.dataset.elementId;
    if (!id) return;
    const current = findElement(id);
    if (LIVE_TEXT.includes(field) || LIVE_NUMBER.includes(field)) {
      const v = LIVE_NUMBER.includes(field)
        ? NUMERIC_FIELDS[field]!(parseFloat(input.value))
        : input.value.trim();
      if (current && (current as unknown as Record<string, unknown>)[field] === v) return;
    }
    if (field === "fillEnabled") {
      applyToElement(id, (el) => {
        el.fillEnabled = input.checked;
      });
    } else if (field === "closed") {
      setElementClosed(id, input.checked);
    } else if (field === "dashStyle") {
      const style = input.value as DashStyle;
      if (style === "custom") {
        // Nothing changes yet: the pattern opens for typing, starting from what the style drew.
        customDash.add(id);
        refresh();
        const pattern = li!.querySelector<HTMLInputElement>('[data-field="dash"]');
        pattern?.focus();
        pattern?.select();
        return;
      }
      customDash.delete(id);
      applyToElement(id, (el) => {
        const dash = dashPreset(style, el);
        if (dash) el.dash = dash;
        else delete el.dash;
      });
    } else if (field === "dash") {
      // Typing already applied it; leaving the field only tidies what it shows.
      input.value = (current?.dash ?? []).join(" ");
    } else if (field === "fillRule") {
      applyToElement(id, (el) => {
        if (input.value === "evenodd") el.fillRule = "evenodd";
        else delete el.fillRule;
      });
    } else if (field === "fillType") {
      applyToElement(id, (el) => {
        el.fillType = input.value as SceneElement["fillType"];
        if (input.value !== "solid") el.fillEnabled = true;
      });
    } else if (field === "strokeType") {
      applyToElement(id, (el) => {
        el.strokeType = input.value as SceneElement["strokeType"];
      });
    } else if (field === "fillStopOffset" || field === "strokeStopOffset") {
      const percent = parseFloat(input.value);
      if (Number.isNaN(percent)) return;
      const kind: PaintKind = field === "fillStopOffset" ? "fill" : "stroke";
      const index = parseInt(input.dataset.stop ?? "0", 10);
      applyToElement(id, (el) => {
        const stops = gradientStops(el, kind);
        const stop = stops[index];
        if (stop) stop.offset = Math.min(1, Math.max(0, percent / 100));
        el[PAINT_KEYS[kind].stops] = stops;
      });
    } else if (field in GEOMETRY_FIELDS) {
      // Moves or stretches the shape to put one edge of its box at the value typed, through the
      // same matrix code that bakes imported transforms, so every shape type behaves.
      const next =
        current && setBoxField([current], GEOMETRY_FIELDS[field]!, parseFloat(input.value));
      if (next) {
        pushUndo();
        replaceElements(next);
      }
    } else if (field in NUMERIC_FIELDS) {
      const v = parseFloat(input.value);
      if (Number.isNaN(v)) return;
      applyToElement(id, (el) => {
        const before = { ...el };
        (el as unknown as Record<string, unknown>)[field] = NUMERIC_FIELDS[field]!(v);
        restyleDash(el, before);
      });
    } else if (field === "name") {
      applyToElement(id, (el) => {
        el.name = input.value.trim();
      });
    } else {
      // Plain string selects: linecap, linejoin, markers, font family, anchor.
      applyToElement(id, (el) => {
        const before = { ...el };
        (el as unknown as Record<string, unknown>)[field] = input.value;
        restyleDash(el, before);
      });
    }
  });

  /** What a swatch sets: a paint's colour (`fill`, `stroke`), or one of its stops (`fill-stop-2`). */
  function swatchTarget(picker: string): { kind: PaintKind; stop: number | null } | null {
    const m = /^(fill|stroke)(?:-stop-(\d+))?$/.exec(picker);
    return m ? { kind: m[1] as PaintKind, stop: m[2] == null ? null : Number(m[2]) } : null;
  }

  /** Writes a colour into a paint, or into one of its gradient's stops. */
  function writeColor(el: SceneElement, picker: string, hex: string, alpha: number): void {
    const target = swatchTarget(picker);
    if (!target) return;
    const k = PAINT_KEYS[target.kind];
    if (target.stop != null) {
      const stops = gradientStops(el, target.kind);
      const stop = stops[target.stop];
      if (!stop) return;
      stop.color = hex;
      stop.opacity = alpha;
      el[k.stops] = stops;
      // The first stop is also the solid colour, so turning the gradient off keeps something.
      if (target.stop !== 0) return;
    }
    el[k.color] = hex;
    el[k.opacity] = alpha;
    if (target.kind === "fill") el.fillEnabled = true;
  }

  /** The colour and alpha a swatch currently shows. */
  function readColor(el: SceneElement, picker: string): { color: string; alpha: number } {
    const target = swatchTarget(picker);
    if (!target) return { color: "#000000", alpha: 1 };
    if (target.stop != null) {
      const stop = gradientStops(el, target.kind)[target.stop];
      return { color: stop?.color ?? "#000000", alpha: stop?.opacity ?? 1 };
    }
    const k = PAINT_KEYS[target.kind];
    return { color: el[k.color], alpha: el[k.opacity] };
  }

  primitiveListEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-picker]");
    if (!btn) return;
    if (isColorPickerOpenFor(btn)) {
      closeColorPicker();
      return;
    }
    const id = btn.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
    const kind = btn.dataset.picker;
    const el = id ? findElement(id) : undefined;
    if (!id || !kind || !el) return;
    const target = swatchTarget(kind);
    if (!target) return;
    const start = readColor(el, kind);
    const step = undoStepper();
    holdSvgFocus(true);
    setSvgFocus({ id, field: target.kind });
    openColorPicker({
      anchor: btn,
      onClose: () => {
        holdSvgFocus(false);
        if (!primitiveListEl.contains(document.activeElement)) setSvgFocus(null);
      },
      color: start.color,
      alpha: start.alpha,
      onChange: (hex, alpha) => {
        const cur = findElement(id);
        if (!cur) return;
        step();
        mutateDocument(() => writeColor(cur, kind, hex, alpha));
      },
    });
  });

  /* Adding, moving and removing gradient stops. */
  primitiveListEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const add = target.closest<HTMLElement>("[data-stop-add]");
    const remove = target.closest<HTMLElement>("[data-stop-remove]");
    if (!add && !remove) return;
    const id = target.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
    const kind = target.closest<HTMLElement>("[data-paint]")?.dataset.paint as
      PaintKind | undefined;
    if (!id || !kind) return;
    applyToElement(id, (el) => {
      const stops = gradientStops(el, kind);
      if (add) {
        // A new stop lands midway between the last two, taking a blend of their colours.
        const a = stops[stops.length - 2]!;
        const b = stops[stops.length - 1]!;
        stops.splice(stops.length - 1, 0, {
          offset: (a.offset + b.offset) / 2,
          color: b.color,
          opacity: (a.opacity + b.opacity) / 2,
        });
      } else if (stops.length > 2) {
        stops.splice(parseInt(remove!.dataset.stopRemove ?? "0", 10), 1);
      }
      el[PAINT_KEYS[kind].stops] = stops;
    });
  });
}
