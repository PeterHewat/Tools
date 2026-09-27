/**
 * The document as a tree you can fold: objects and arrays expand and collapse, and each row
 * shows its key, then its value or how many children it holds.
 *
 * Rows are created only when their parent is first expanded, and a container shows its children
 * a chunk at a time, so opening a huge array costs one chunk. Which rows are open is remembered
 * by child position, so the tree keeps its shape when the text is edited and parsed again.
 *
 * Keyboard use follows the ARIA tree pattern: arrows move and fold, Enter shows the row's value
 * in the text, Home / End jump to the ends.
 */
import type { JsonNode } from "./lib/ast.js";
import { childrenOf, type PathSegment } from "./lib/path.js";

export interface TreeHandlers {
  /** A row was selected. */
  select(path: PathSegment[], node: JsonNode): void;
  /** A row was opened (double-click or Enter), to be shown in the text. */
  open(node: JsonNode): void;
}

export interface TreeView {
  /** Shows a document, or a message when there is none. Keeps open rows and the selection. */
  show(root: JsonNode | null, message: string): void;
  /** Opens the rows down to a value, by child positions, and selects it. */
  reveal(indices: readonly number[]): void;
  expandAll(): void;
  collapseAll(): void;
  focus(): void;
}

interface Item {
  el: HTMLElement;
  row: HTMLElement;
  node: JsonNode;
  path: PathSegment[];
  indices: number[];
  parent: Item | null;
  kids: HTMLElement | null;
  children: Item[];
  all: ReturnType<typeof childrenOf> | null;
  more: HTMLElement | null;
}

/** Children shown per "Show more". */
const CHUNK = 200;
/** Expand all stops opening rows past this many, rather than freeze on a huge document. */
const EXPAND_ALL_LIMIT = 5000;
/** Long strings are cut in the row; the full value is in the text. */
const MAX_SHOWN = 200;

const VALUE_CLASS: Record<string, string> = {
  string: "t-string",
  number: "t-number",
  boolean: "t-literal",
  null: "t-literal",
};

function countOf(node: JsonNode): number {
  return node.kind === "object"
    ? node.members.length
    : node.kind === "array"
      ? node.items.length
      : 0;
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  return el;
}

export function createTree(container: HTMLElement, handlers: TreeHandlers): TreeView {
  const byRow = new WeakMap<Element, Item>();
  /** Open rows and the selected row, keyed by child positions ("0/3/1"). */
  const open = new Set<string>([""]);
  let selectedKey: string | null = null;
  let root: Item | null = null;
  let selected: Item | null = null;

  const keyOf = (item: Item) => item.indices.join("/");

  function makeItem(
    node: JsonNode,
    seg: PathSegment | null,
    parent: Item | null,
    index: number
  ): Item {
    const el = document.createElement("div");
    el.className = "ti";
    el.setAttribute("role", "treeitem");
    const row = document.createElement("div");
    row.className = "row";
    row.tabIndex = -1;
    const level = parent ? parent.indices.length + 1 : 0;
    row.style.setProperty("--level", String(level));
    el.setAttribute("aria-level", String(level + 1));

    const count = countOf(node);
    const fold = span("tw", count ? "▸" : "");
    fold.setAttribute("aria-hidden", "true"); // the row's aria-expanded says it already
    row.append(fold);
    if (seg !== null) {
      row.append(
        typeof seg === "number" ? span("t-index", String(seg)) : span("t-key", JSON.stringify(seg)),
        span("t-punct", ": ")
      );
    }
    if (node.kind === "object" || node.kind === "array") {
      const [opener, closer] = node.kind === "object" ? ["{", "}"] : ["[", "]"];
      row.append(
        span("t-punct", `${opener}${count ? ` ${count.toLocaleString()} ` : ""}${closer}`)
      );
    } else {
      const raw = node.raw.length > MAX_SHOWN ? `${node.raw.slice(0, MAX_SHOWN)}…` : node.raw;
      row.append(span(VALUE_CLASS[node.kind], raw));
    }
    el.append(row);

    const item: Item = {
      el,
      row,
      node,
      path: parent && seg !== null ? [...parent.path, seg] : [],
      indices: parent ? [...parent.indices, index] : [],
      parent,
      kids: null,
      children: [],
      all: null,
      more: null,
    };
    byRow.set(row, item);
    if (count) {
      el.setAttribute("aria-expanded", "false");
      if (open.has(keyOf(item))) expand(item);
    }
    if (selectedKey !== null && keyOf(item) === selectedKey) select(item, false);
    return item;
  }

  /** Shows more of a container's children: the next chunk, or at least up to `upTo`. */
  function renderMore(item: Item, upTo = -1): void {
    const all = (item.all ??= childrenOf(item.node));
    const from = item.children.length;
    const to = Math.min(all.length, Math.max(from + CHUNK, upTo + 1));
    const fragment = document.createDocumentFragment();
    for (let k = from; k < to; k++) {
      const child = makeItem(all[k].node, all[k].seg, item, k);
      item.children.push(child);
      fragment.append(child.el);
    }
    item.more?.remove();
    item.more = null;
    if (to < all.length) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "more";
      more.style.setProperty("--level", String(item.indices.length + 1));
      more.textContent = `Show ${Math.min(CHUNK, all.length - to).toLocaleString()} more (${(all.length - to).toLocaleString()} hidden)`;
      more.addEventListener("click", () => renderMore(item));
      item.more = more;
      fragment.append(more);
    }
    item.kids!.append(fragment);
  }

  function expand(item: Item): void {
    if (!countOf(item.node)) return;
    if (!item.kids) {
      item.kids = document.createElement("div");
      item.kids.setAttribute("role", "group");
      item.el.append(item.kids);
      renderMore(item);
    }
    item.kids.hidden = false;
    item.el.setAttribute("aria-expanded", "true");
    open.add(keyOf(item));
  }

  function collapse(item: Item): void {
    if (!item.kids || item.kids.hidden) return;
    item.kids.hidden = true;
    item.el.setAttribute("aria-expanded", "false");
    open.delete(keyOf(item));
  }

  const isOpen = (item: Item) => !!item.kids && !item.kids.hidden;

  function select(item: Item, notify = true, focus = false): void {
    if (selected && selected !== item) {
      selected.row.classList.remove("sel");
      selected.row.tabIndex = -1;
      selected.el.removeAttribute("aria-selected");
    }
    selected = item;
    selectedKey = keyOf(item);
    item.row.classList.add("sel");
    item.row.tabIndex = 0;
    item.el.setAttribute("aria-selected", "true");
    if (focus) item.row.focus({ preventScroll: true });
    if (notify) {
      item.row.scrollIntoView({ block: "nearest" });
      handlers.select(item.path, item.node);
    }
  }

  function visibleRows(): Item[] {
    return [...container.querySelectorAll<HTMLElement>(".row")]
      .filter((row) => row.offsetParent !== null)
      .map((row) => byRow.get(row)!);
  }

  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest(".row");
    const item = row && byRow.get(row);
    if (!item) return;
    if (target.closest(".tw")) {
      if (isOpen(item)) collapse(item);
      else expand(item);
    }
    select(item, true, true);
  });

  container.addEventListener("dblclick", (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest(".row");
    const item = row && byRow.get(row);
    if (item && !target.closest(".tw")) handlers.open(item.node);
  });

  container.addEventListener("keydown", (e) => {
    if (!selected || !(e.target as HTMLElement).closest(".row")) return;
    const item = selected;
    const move = (to: Item | undefined | null) => to && select(to, true, true);
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        const rows = visibleRows();
        const at = rows.indexOf(item);
        move(rows[at + (e.key === "ArrowDown" ? 1 : -1)]);
        break;
      }
      case "ArrowRight":
        if (!countOf(item.node)) return;
        if (isOpen(item)) move(item.children[0]);
        else expand(item);
        break;
      case "ArrowLeft":
        if (isOpen(item)) collapse(item);
        else move(item.parent);
        break;
      case "Home":
        move(root);
        break;
      case "End":
        move(visibleRows().at(-1));
        break;
      case "Enter":
        handlers.open(item.node);
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  return {
    show(node, message) {
      selected = null;
      container.replaceChildren();
      if (!node) {
        root = null;
        container.append(span("tree-empty", message));
        return;
      }
      root = makeItem(node, null, null, 0);
      expand(root);
      container.append(root.el);
      if (!selected) select(root, false);
    },

    reveal(indices) {
      if (!root) return;
      let item = root;
      for (const k of indices) {
        expand(item);
        if (item.children.length <= k) renderMore(item, k);
        const child = item.children[k];
        if (!child) break;
        item = child;
      }
      select(item, false);
      item.row.scrollIntoView({ block: "center" });
      handlers.select(item.path, item.node);
    },

    expandAll() {
      if (!root) return;
      const stack = [root];
      let shown = 0;
      while (stack.length && shown < EXPAND_ALL_LIMIT) {
        const item = stack.pop()!;
        expand(item);
        shown += item.children.length;
        for (let k = item.children.length - 1; k >= 0; k--) {
          if (countOf(item.children[k].node)) stack.push(item.children[k]);
        }
      }
    },

    collapseAll() {
      if (!root) return;
      for (const row of container.querySelectorAll(".row")) {
        const item = byRow.get(row);
        if (item && item !== root) collapse(item);
      }
      open.clear();
      open.add("");
      if (selected && selected.row.offsetParent === null) select(root);
    },

    focus() {
      (selected ?? root)?.row.focus({ preventScroll: true });
    },
  };
}
