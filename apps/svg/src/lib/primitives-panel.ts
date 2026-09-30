import { getState, setState, selectOnly } from "./state.js";
import { pushUndo } from "./undo.js";
import { bindPrimitiveFields, dashStyleFor, primitiveBodyHtml } from "./primitive-fields.js";
import { turnedBy } from "./session.js";
import { elementBBox, gradientStops, PAINT_KINDS } from "./model.js";
import { escapeAttr } from "./utils.js";
import { canMoveGroup, canMoveWithinParent, groupColor, groupsOf, moveGroup } from "./groups.js";
import { flattenLines, lineOffsets, visibleRange, type ListLine } from "./list-lines.js";
import { type BBox, type EditorState, type SceneElement } from "./types.js";
import { unionBox } from "./selection-transform.js";
import {
  cachedList,
  accHeaderHtml,
  wireAccRow,
  setField,
  reorder,
  towardFront,
  setRowChecked,
} from "./accordion.js";
import { byId } from "@tools/ui";

const primitiveListEl = byId("primitive-list");

/* ---------- Primitives list ---------- */

/**
 * What the rows are built from: a change here rebuilds the list, and anything else is written
 * into the rows as they stand (`updatePrimitiveListValues`), so typing is never interrupted.
 */
function primitiveListKeyOf(state: EditorState): string {
  const els = state.elements
    .map(
      (e) =>
        `${e.id}:${e.type}:${groupsOf(e).join("/")}:${"closed" in e && e.closed ? 1 : 0}:${e.hidden ? 1 : 0}:${e.locked ? 1 : 0}:${e.fillStops.length}:${e.strokeStops.length}`
    )
    .join(",");
  const collapsed = [...collapsedGroups].join(",");
  return `${els}|${state.ui.expandedElementId}|${collapsed}`;
}

/** Each group's colour, from the hue it was given when it appeared (see `groupHues`). */
function groupColors(state: EditorState): Map<string, string> {
  const out = new Map<string, string>();
  for (const [gid, hue] of Object.entries(state.groupHues)) out.set(gid, groupColor(hue));
  return out;
}

/** Every element in group `gid`, at any depth. */
function membersOf(elements: readonly SceneElement[], gid: string): SceneElement[] {
  return elements.filter((e) => groupsOf(e).includes(gid));
}

function isInvisible(el: SceneElement): boolean {
  return el.strokeWidth === 0 && !el.fillEnabled;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Circle in the row header: border = stroke color, inside = fill (transparent when none). */
function headerSwatchStyle(el: SceneElement): string {
  const border = el.strokeWidth === 0 ? "var(--swatch-ring)" : rgba(el.stroke, el.strokeOpacity);
  let inside = "transparent";
  if (el.fillEnabled) {
    if (el.fillType === "solid") {
      inside = rgba(el.fill, el.fillOpacity);
    } else {
      const stops = gradientStops(el)
        .map((s) => `${rgba(s.color, s.opacity)} ${Math.round(s.offset * 100)}%`)
        .join(", ");
      const angle =
        (Math.atan2(el.fillTo.y - el.fillFrom.y, el.fillTo.x - el.fillFrom.x) * 180) / Math.PI;
      inside =
        el.fillType === "radial"
          ? `radial-gradient(${stops})`
          : `linear-gradient(${Math.round(angle) + 90}deg, ${stops})`;
    }
  }
  return `border-color:${border};background:${inside}`;
}

/**
 * The list is a tree, because the document is one, but only the part of it on screen is built:
 * `flattenLines` lays it out as lines, and each render draws the lines in view. A group is still
 * a single bracket down the left of the rows inside it - each line draws its stretch of every
 * bracket it sits in, and the stretches join up - not a coloured stripe repeated on each row.
 */
let lines: ListLine[] = [];
/** Measured heights by line key, gap below included; lines not yet seen are guessed. */
const lineHeights = new Map<string, number>();
let typicalHeight = 44;
/** The lines currently in the DOM, by key. */
const drawnLines = new Map<string, HTMLElement>();
let listColors = new Map<string, string>();
/** Lines drawn beyond the visible part, each way, so a short scroll never shows a gap. */
const OVERSCAN_PX = 600;
/** One bracket's width: its 3px line and the space after it. */
const RAIL_STEP_PX = 11;

function buildPrimitiveList(state: EditorState): void {
  // A rebuild replaces every field, so the one being typed in is found again afterwards: a
  // circle turned into an ellipse by its W field, say, must not lose the keyboard.
  const active = document.activeElement as HTMLElement | null;
  const inList = primitiveListEl.contains(active);
  const field = inList ? active?.dataset.field : undefined;
  const fieldOf = active?.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
  const groupField = inList ? active?.dataset.groupField : undefined;
  const groupFieldOf = active?.closest<HTMLElement>("[data-group-id]")?.dataset.groupId;
  primitiveListEl.innerHTML = "";
  drawnLines.clear();
  rowRefs.clear();
  groupNameInputs.clear();
  groupBodies.clear();
  lines = [];
  if (!state.elements.length) {
    primitiveListEl.style.height = "";
    const li = document.createElement("li");
    li.className = "primitive-empty muted";
    li.textContent = "No primitives yet";
    primitiveListEl.appendChild(li);
    return;
  }
  listColors = groupColors(state);
  lines = flattenLines(state.elements, collapsedGroups);
  renderLines(state);
  if (field && fieldOf) {
    primitiveListEl
      .querySelector<HTMLElement>(`[data-element-id="${fieldOf}"] [data-field="${field}"]`)
      ?.focus();
  }
  if (groupField && groupFieldOf) {
    primitiveListEl
      .querySelector<HTMLElement>(
        `[data-group-id="${groupFieldOf}"] [data-group-field="${groupField}"]`
      )
      ?.focus();
  }
}

/** The part of the list the panel shows, in the list's own coordinates. */
function listViewport(): { top: number; bottom: number } {
  const scroller = primitiveListEl.closest<HTMLElement>("#menu-document");
  const list = primitiveListEl.getBoundingClientRect();
  const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  return { top: view.top - list.top, bottom: view.bottom - list.top };
}

/**
 * Draws the lines in view and drops the rest. Heights are measured as lines are drawn, and a
 * line that turns out taller or shorter than guessed moves everything below it, so the layout
 * is redone until it holds - in practice once, when an expanded row first comes into view.
 */
function renderLines(state: EditorState): void {
  if (!lines.length) return;
  for (let pass = 0; pass < 3; pass++) {
    const offsets = lineOffsets(lines.map((l) => lineHeights.get(l.key) ?? typicalHeight));
    primitiveListEl.style.height = `${offsets[offsets.length - 1]}px`;
    const view = listViewport();
    const { start, end } = visibleRange(offsets, view.top, view.bottom, OVERSCAN_PX);
    const wanted = new Set<string>();
    for (let i = start; i < end; i++) wanted.add(lines[i]!.key);
    // The row being typed in stays, wherever it has scrolled to: dropping it would drop focus.
    const focused = document.activeElement?.closest<HTMLElement>(".list-line")?.dataset.key;
    if (focused && lines.some((l) => l.key === focused)) wanted.add(focused);

    for (const [key, node] of drawnLines) {
      if (wanted.has(key)) continue;
      node.remove();
      drawnLines.delete(key);
      forgetRefs(node);
    }
    lines.forEach((line, i) => {
      if (!wanted.has(line.key)) return;
      let node = drawnLines.get(line.key);
      if (!node) {
        node = drawLine(state, line);
        drawnLines.set(line.key, node);
        primitiveListEl.appendChild(node);
      }
      const top = `${offsets[i]}px`;
      if (node.style.top !== top) node.style.top = top;
    });

    let changed = false;
    for (const [key, node] of drawnLines) {
      const h = node.offsetHeight;
      if (!h || lineHeights.get(key) === h) continue;
      lineHeights.set(key, h);
      if (!node.querySelector(".acc-item.expanded")) typicalHeight = h;
      changed = true;
    }
    if (!changed) return;
  }
}

/** One line: its stretch of each bracket it sits in, then its row, indented past them. */
function drawLine(state: EditorState, line: ListLine): HTMLElement {
  const li = document.createElement("li");
  li.className = "list-line";
  li.dataset.key = line.key;
  li.style.paddingLeft = `${line.rails.length * RAIL_STEP_PX}px`;
  line.rails.forEach((rail, depth) => {
    const span = document.createElement("span");
    span.className = `list-rail${rail.first ? " first" : ""}${rail.last ? " last" : ""}`;
    span.style.left = `${depth * RAIL_STEP_PX}px`;
    span.style.setProperty("--gc", listColors.get(rail.gid) ?? "var(--accent)");
    li.appendChild(span);
  });
  if (line.kind === "group") {
    li.style.setProperty("--gc", listColors.get(line.gid) ?? "var(--accent)");
    li.appendChild(groupHead(state, line.gid));
  } else {
    li.appendChild(primitiveRow(state, line.index));
  }
  return li;
}

/** Drops the update's references into a line that has left the DOM. */
function forgetRefs(node: HTMLElement): void {
  const id = node.querySelector<HTMLElement>("[data-element-id]")?.dataset.elementId;
  if (id) rowRefs.delete(id);
  const gid = node.querySelector<HTMLElement>("[data-group-id]")?.dataset.groupId;
  if (gid) {
    groupNameInputs.delete(gid);
    groupBodies.delete(gid);
  }
}

let renderQueued = false;
/** Scrolling or resizing the panel brings other lines into view: drawn on the next frame. */
function queueRenderLines(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    // The document may have changed since this was queued (another one opened, say) without the
    // list having caught up yet: drawing the old lines against the new shapes read past their end.
    const state = getState();
    primitiveList.sync(state);
    renderLines(state);
  });
}
primitiveListEl.closest("#menu-document")?.addEventListener("scroll", queueRenderLines, {
  passive: true,
});
// Opening the panel or the section, or changing its width, changes what is in view.
// So does folding a section above the list, which moves it without scrolling anything.
{
  const observer = new ResizeObserver(queueRenderLines);
  const panel = primitiveListEl.closest("#menu-document");
  if (panel) {
    observer.observe(panel);
    panel.querySelectorAll(".doc-section").forEach((section) => observer.observe(section));
  }
}

/**
 * Each row, with the parts of it the in-place update writes to, by element id, filled in as
 * rows are drawn. That update runs on every change, every frame of a drag included.
 */
interface RowRefs {
  li: HTMLElement;
  name: HTMLInputElement | null;
  swatch: HTMLElement | null;
  style: string;
}
const rowRefs = new Map<string, RowRefs>();
/** The open body of each drawn group head that is selected whole, by group id. */
const groupBodies = new Map<string, HTMLElement>();
/** The name field of each drawn group head, by group id. */
const groupNameInputs = new Map<string, HTMLInputElement>();

/**
 * Groups folded shut in the list. Where you are looking, not part of the drawing: not saved,
 * not undone, and forgotten when the group is.
 */
const collapsedGroups = new Set<string>();

/**
 * A group's own row, built like a shape's so every button lines up down the list: the chevron
 * folds the group, the checkbox selects all of it, the name is what `<g id>` carries after the
 * group's id, the count stands where a shape shows its colours, the eye shows or hides every
 * member, the arrows move the group as one block, and the bin deletes it with everything in it.
 */
function groupHead(state: EditorState, gid: string): HTMLElement {
  const members = membersOf(state.elements, gid);
  const selected = new Set(state.selection.elementIds);
  const allSelected = members.every((e) => selected.has(e.id));
  const allHidden = members.every((e) => e.hidden);
  const allLocked = members.every((e) => e.locked);
  const head = document.createElement("div");
  head.className = `acc-item group-head${collapsedGroups.has(gid) ? "" : " open"}`;
  head.dataset.groupId = gid;
  head.innerHTML = accHeaderHtml({
    dot: { on: allSelected, title: allSelected ? "Deselect the group" : "Select the group" },
    eye: { visible: !allHidden, title: allHidden ? "Show the group" : "Hide the group" },
    lock: {
      locked: allLocked,
      title: allLocked ? "Unlock the group" : "Lock the group: out of reach on the canvas",
    },
    titleHtml: `<input type="text" class="acc-title-input group-name-input" data-group-name value="${escapeAttr(state.groupNames[gid] ?? "")}" placeholder="group" aria-label="Group name" title="Group name - exported in the group's id" />`,
    extra: `<span class="acc-swatch group-count" title="${members.length} shapes in this group">${members.length}</span>`,
    canUp: canMoveGroup(state.elements, gid, towardFront(-1)),
    canDown: canMoveGroup(state.elements, gid, towardFront(1)),
    index: 0,
    count: 0,
  });
  wireAccRow(head, {
    onExpand: () => toggleGroupCollapsed(gid),
    onDot: () => toggleGroupSelected(gid),
    onEye: () =>
      setHidden(
        members.map((e) => e.id),
        !allHidden
      ),
    onLock: () =>
      setLocked(
        members.map((e) => e.id),
        !allLocked
      ),
    onDelete: () => deleteGroup(gid),
    onMove: (dir, toEnd) => moveGroupBy(gid, towardFront(dir), toEnd),
  });
  const input = head.querySelector<HTMLInputElement>("[data-group-name]")!;
  groupNameInputs.set(gid, input);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
  // An open group shows the numbers of the box its members share, as an open shape row shows its
  // own; folded, it shows neither those nor its members.
  if (!collapsedGroups.has(gid)) {
    head.classList.add("expanded");
    const body = document.createElement("div");
    body.className = "acc-body";
    body.innerHTML = groupFieldsHtml(unionBox(members), turnedBy(members.map((e) => e.id)));
    head.appendChild(body);
    groupBodies.set(gid, body);
  }
  return head;
}

/**
 * A group's position and size - the box its members share - and a turn. Nothing of it is stored
 * on the group: each value typed is baked into the members' coordinates (selection-transform.ts),
 * so Rotate reads how far it has turned since it was chosen (session.ts), not a stored angle.
 */
function groupFieldsHtml(box: BBox | null, turned: number): string {
  if (!box) return "";
  const round = (n: number) => Math.round(n * 100) / 100;
  const field = (key: string, label: string, aria: string, value: number, step = 1) =>
    `<label class="field-row"><span>${label}</span><input type="number" data-group-field="${key}" step="${step}" value="${value}" aria-label="${aria}" /></label>`;
  return (
    field("x", "X", "Group X", round(box.x)) +
    field("y", "Y", "Group Y", round(box.y)) +
    field("width", "W", "Group width", round(box.width)) +
    field("height", "H", "Group height", round(box.height)) +
    `<label class="field-row" title="Rotates every member about the group's centre by this many degrees"><span>Rotate</span><input type="number" data-group-field="turn" step="5" value="${turned}" aria-label="Rotate the group by (degrees)" /></label>`
  );
}

function primitiveRow(state: EditorState, index: number): HTMLElement {
  const el = state.elements[index]!;
  const isSelected = state.selection.elementIds.includes(el.id);
  const li = document.createElement("div");
  li.className = `acc-item${state.ui.expandedElementId === el.id ? " expanded" : ""}`;
  li.dataset.elementId = el.id;
  li.innerHTML = `
    ${accHeaderHtml({
      dot: { on: isSelected, title: isSelected ? "Deselect" : "Select" },
      eye: { visible: !el.hidden, title: el.hidden ? "Show" : "Hide" },
      lock: {
        locked: !!el.locked,
        title: el.locked ? "Unlock" : "Lock: out of reach on the canvas",
      },
      name: el.name,
      placeholder: el.type,
      extra: `<span class="acc-swatch" style="${escapeAttr(headerSwatchStyle(el))}"></span>`,
      canUp: canMoveWithinParent(state.elements, el.id, towardFront(-1)),
      canDown: canMoveWithinParent(state.elements, el.id, towardFront(1)),
      index,
      count: state.elements.length,
    })}
    <div class="acc-body">${primitiveBodyHtml(el)}</div>
  `;
  li.dataset.filltype = el.fillType;
  li.dataset.stroketype = el.strokeType;
  li.classList.toggle("acc-item--hidden", !!el.hidden);
  li.classList.toggle("acc-item--invisible", isInvisible(el));
  const swatch = li.querySelector<HTMLElement>(".acc-swatch");
  if (swatch && isInvisible(el)) swatch.title = "Invisible: no stroke and no fill";
  const name = li.querySelector<HTMLInputElement>('[data-field="name"]');
  rowRefs.set(el.id, { li, name, swatch, style: headerSwatchStyle(el) });
  wireAccRow(li, {
    onExpand: () => toggleElementExpanded(el.id),
    onDot: () => toggleElementSelected(el.id),
    onEye: () => setHidden([el.id], !el.hidden),
    onLock: () => setLocked([el.id], !el.locked),
    onDelete: () => deletePrimitive(el.id),
    onMove: (dir, toEnd) => reorder("elements", el.id, towardFront(dir), toEnd),
  });
  return li;
}

function updatePrimitiveListValues(state: EditorState): void {
  const selected = new Set(state.selection.elementIds);
  for (const [gid, body] of groupBodies) {
    const members = membersOf(state.elements, gid);
    const box = unionBox(members);
    if (!box) continue;
    const turn = body.querySelector<HTMLInputElement>('[data-group-field="turn"]');
    const turned = String(turnedBy(members.map((e) => e.id)));
    if (turn && turn !== document.activeElement && turn.value !== turned) turn.value = turned;
    for (const key of ["x", "y", "width", "height"] as const) {
      const input = body.querySelector<HTMLInputElement>(`[data-group-field="${key}"]`);
      const value = String(Math.round(box[key] * 100) / 100);
      if (input && input !== document.activeElement && input.value !== value) input.value = value;
    }
  }
  for (const [gid, input] of groupNameInputs) {
    const on = membersOf(state.elements, gid).every((el) => selected.has(el.id));
    setRowChecked(
      input.closest<HTMLElement>(".group-head")!,
      on,
      on ? "Deselect the group" : "Select the group"
    );
    const value = state.groupNames[gid] ?? "";
    if (input !== document.activeElement && input.value !== value) input.value = value;
  }
  for (const el of state.elements) {
    const row = rowRefs.get(el.id);
    if (!row) continue;
    const { li, name } = row;
    const on = selected.has(el.id);
    setRowChecked(li, on, on ? "Deselect" : "Select");
    const label = el.name;
    if (name && name !== document.activeElement && name.value !== label) name.value = label;
    // Only what changed is written: an unchanged write still restyles the row.
    const style = headerSwatchStyle(el);
    if (row.swatch && style !== row.style) {
      row.swatch.style.cssText = style;
      row.style = style;
    }
    li.classList.toggle("acc-item--invisible", isInvisible(el));
    const fillType = el.fillType;
    if (li.dataset.filltype !== fillType) li.dataset.filltype = fillType;
    const strokeType = el.strokeType;
    if (li.dataset.stroketype !== strokeType) li.dataset.stroketype = strokeType;
    if (!li.classList.contains("expanded")) continue;
    const setSwatch = (kind: string, color: string, alpha: number) => {
      const btn = li.querySelector<HTMLElement>(`[data-picker="${kind}"]`);
      if (!btn) return;
      btn.style.setProperty("--c", color);
      btn.style.setProperty("--a", String(alpha));
    };
    setSwatch("stroke", el.stroke, el.strokeOpacity);
    setSwatch("fill", el.fill, el.fillOpacity);
    for (const kind of PAINT_KINDS) {
      gradientStops(el, kind).forEach((stop, i) => {
        setSwatch(`${kind}-stop-${i}`, stop.color, stop.opacity);
        const input = li.querySelector<HTMLInputElement>(
          `[data-field="${kind}StopOffset"][data-stop="${i}"]`
        );
        if (input && input !== document.activeElement)
          input.value = String(Math.round(stop.offset * 100));
      });
    }
    if (el.type === "text") {
      setField(li, "text", el.text ?? "");
      setField(li, "fontSize", el.fontSize ?? 48);
      setField(li, "fontFamily", el.fontFamily ?? "sans-serif");
      setField(li, "anchor", el.anchor ?? "start");
    }
    const box = elementBBox(el);
    if (box) {
      const round = (n: number) => Math.round(n * 100) / 100;
      setField(li, "geomX", round(box.x));
      setField(li, "geomY", round(box.y));
      setField(li, "geomW", round(box.width));
      setField(li, "geomH", round(box.height));
      setField(li, "rotation", Math.round(el.rotation ?? 0));
    }
    setField(li, "strokeWidth", el.strokeWidth);
    setField(li, "linecap", el.linecap);
    setField(li, "linejoin", el.linejoin);
    setField(li, "fillType", el.fillType);
    setField(li, "strokeType", el.strokeType);
    setField(li, "fillRule", el.fillRule ?? "nonzero");
    setField(li, "dash", (el.dash ?? []).join(" "));
    const dashStyle = dashStyleFor(el);
    setField(li, "dashStyle", dashStyle);
    const pattern = li.querySelector<HTMLInputElement>('[data-field="dash"]');
    if (pattern) {
      pattern.disabled = dashStyle !== "custom";
      pattern.placeholder = dashStyle === "custom" ? "6 4" : "none";
    }
    if (el.type === "rect") {
      setField(li, "rx", Math.round(el.rx));
      setField(li, "ry", Math.round(el.ry ?? el.rx));
    }
    setField(li, "markerStart", el.markerStart);
    setField(li, "markerEnd", el.markerEnd);
    const fillCheckbox = li.querySelector<HTMLInputElement>('[data-field="fillEnabled"]');
    if (fillCheckbox && fillCheckbox !== document.activeElement) {
      fillCheckbox.checked = !!el.fillEnabled;
    }
  }
  // An open row grows and shrinks with what it shows - a gradient's stops, say - and the lines
  // below it have to move with it.
  const open = state.ui.expandedElementId;
  if (open && rowRefs.has(open)) renderLines(state);
}

export const primitiveList = cachedList(
  primitiveListKeyOf,
  buildPrimitiveList,
  updatePrimitiveListValues
);

function toggleElementExpanded(id: string): void {
  setState((s) => ({
    ...s,
    ui: { ...s.ui, expandedElementId: s.ui.expandedElementId === id ? null : id },
  }));
}

function toggleElementSelected(id: string): void {
  setState((s) => {
    const ids = s.selection.elementIds;
    return {
      ...s,
      selection: selectOnly(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]),
      tool: "select",
    };
  });
}

/** Selects every member of a group, or, when they all are already, none of them. */
function toggleGroupSelected(gid: string): void {
  setState((s) => {
    const ids = membersOf(s.elements, gid).map((e) => e.id);
    const current = new Set(s.selection.elementIds);
    const all = ids.every((id) => current.has(id));
    const next = all
      ? s.selection.elementIds.filter((id) => !ids.includes(id))
      : [...new Set([...s.selection.elementIds, ...ids])];
    return { ...s, selection: selectOnly(next), tool: "select" };
  });
}

/**
 * Shows or hides shapes. A hidden shape leaves the selection, since nothing on the canvas would
 * show what a drag or a Delete was about to act on.
 */
function setHidden(ids: readonly string[], hidden: boolean): void {
  const wanted = new Set(ids);
  pushUndo();
  setState((s) => ({
    ...s,
    elements: s.elements.map((e) => {
      if (!wanted.has(e.id) || !!e.hidden === hidden) return e;
      const next = { ...e };
      if (hidden) next.hidden = true;
      else delete next.hidden;
      return next;
    }),
    selection: hidden
      ? selectOnly(s.selection.elementIds.filter((id) => !wanted.has(id)))
      : s.selection,
  }));
}

/**
 * Locked shapes stay selected: they were chosen here, where a locked shape is still reached, and
 * the bar is where they are unlocked again.
 */
function setLocked(ids: readonly string[], locked: boolean): void {
  const wanted = new Set(ids);
  pushUndo();
  setState((s) => ({
    ...s,
    elements: s.elements.map((e) => {
      if (!wanted.has(e.id) || !!e.locked === locked) return e;
      const next = { ...e };
      if (locked) next.locked = true;
      else delete next.locked;
      return next;
    }),
  }));
}

function toggleGroupCollapsed(gid: string): void {
  if (collapsedGroups.has(gid)) collapsedGroups.delete(gid);
  else collapsedGroups.add(gid);
  primitiveList.sync(getState());
}

/** `dir` is in document order: +1 towards the front. */
function moveGroupBy(gid: string, dir: -1 | 1, toEnd: boolean): void {
  const before = getState().elements;
  const next = moveGroup(before, gid, dir, toEnd);
  if (next.every((e, i) => e === before[i])) return;
  pushUndo();
  setState((s) => ({ ...s, elements: next }));
}

/** Deletes a group and everything in it, as the bin on a shape's row deletes that shape. */
function deleteGroup(gid: string): void {
  const doomed = new Set(membersOf(getState().elements, gid).map((e) => e.id));
  if (!doomed.size) return;
  pushUndo();
  collapsedGroups.delete(gid);
  setState((s) => {
    const groupNames = { ...s.groupNames };
    delete groupNames[gid];
    return {
      ...s,
      elements: s.elements.filter((e) => !doomed.has(e.id)),
      groupNames,
      selection: selectOnly(s.selection.elementIds.filter((id) => !doomed.has(id))),
      ui: {
        ...s.ui,
        expandedElementId: doomed.has(s.ui.expandedElementId ?? "") ? null : s.ui.expandedElementId,
      },
    };
  });
}

function deletePrimitive(id: string): void {
  pushUndo();
  setState((s) => ({
    ...s,
    elements: s.elements.filter((e) => e.id !== id),
    selection: selectOnly(s.selection.elementIds.filter((x) => x !== id)),
    ui: {
      ...s.ui,
      expandedElementId: s.ui.expandedElementId === id ? null : s.ui.expandedElementId,
    },
  }));
}

bindPrimitiveFields(primitiveListEl, () => primitiveList.sync(getState()));
