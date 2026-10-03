import { byId, debounce, isPressed, setPressed } from "@tools/ui";
import type { Editor } from "@tools/editor";
import { findInText, MAX_MATCHES } from "./search.js";

type FindEditor = Pick<Editor, "selection" | "select" | "setMarks" | "focus">;

/** Owns the find controls and search state for the view currently on screen. */
export function bindFind(
  editors: readonly FindEditor[],
  current: () => { editor: FindEditor; text: string; mode: string }
) {
  const findOpenBtn = byId<HTMLButtonElement>("find-open");
  const findBar = byId("findbar");
  const findInput = byId<HTMLInputElement>("find-input");
  const findCount = byId("find-count");
  const findCase = byId<HTMLButtonElement>("find-case");
  const findPrev = byId<HTMLButtonElement>("find-prev");
  const findNext = byId<HTMLButtonElement>("find-next");

  // ---------- Find ----------

  /** Bumped whenever the text changes, so find results know when they are out of date. */
  let findVersion = 0;
  let findKey = "";
  let textMatches: number[] = [];
  let findIndex = -1;

  const findOpen = () => !findBar.classList.contains("hidden");

  /** Searches again when the query, the options, the view or the text changed. */
  function refreshFind(): void {
    const query = findInput.value;
    const key = [query, isPressed(findCase), current().mode, findVersion].join("\u0000");
    if (key === findKey) return;
    findKey = key;
    const matchCase = { matchCase: isPressed(findCase) };
    textMatches = findInText(searchedText(), query, matchCase);
    findIndex = Math.min(findIndex, textMatches.length - 1);
    showFindCount();
    showMarks();
  }

  /** What find searches: the document, or the conversion on screen. */
  const searchedText = () => current().text;

  function showFindCount(): void {
    const n = textMatches.length;
    const capped = n >= MAX_MATCHES ? "+" : "";
    findCount.textContent = !findInput.value
      ? ""
      : !n
        ? "No matches"
        : findIndex < 0
          ? `${n.toLocaleString()}${capped} matches`
          : `${(findIndex + 1).toLocaleString()} of ${n.toLocaleString()}${capped}`;
    findBar.classList.toggle("no-match", !!findInput.value && !n);
    // Nothing to step to: the arrows say so rather than doing nothing.
    findPrev.disabled = findNext.disabled = !n;
  }

  /** Marks the matches in the view shown; the current one stands out. */
  function showMarks(): void {
    const size = findInput.value.length;
    const marks = findOpen()
      ? textMatches.map((m, k) => ({ start: m, end: m + size, current: k === findIndex }))
      : [];
    for (const editor of editors) editor.setMarks(editor === current().editor ? marks : []);
  }

  /** Moves to the next (1) or previous (-1) match; 0 picks the first at or after the caret. */
  function findStep(delta: number): void {
    refreshFind();
    const n = textMatches.length;
    if (!n) {
      findIndex = -1;
      showFindCount();
      return;
    }
    if (findIndex < 0 || delta === 0) {
      const caret = current().editor.selection.from;
      const after = textMatches.findIndex((m) => m >= caret);
      findIndex = after < 0 ? 0 : after;
      if (delta < 0) findIndex = (findIndex - 1 + n) % n;
    } else {
      findIndex = (findIndex + delta + n) % n;
    }
    const start = textMatches[findIndex];
    current().editor.select(start, start + findInput.value.length, {
      focus: current().mode !== "json",
    });
    showFindCount();
    showMarks();
  }

  /** The search button: opens find, or closes it when it is already open. */
  function toggleFind(): void {
    if (findOpen()) closeFind();
    else openFind();
  }

  function openFind(): void {
    findBar.classList.remove("hidden");
    findOpenBtn.setAttribute("aria-expanded", "true");
    const { from, to } = current().editor.selection;
    const selected = to - from < 200 ? searchedText().slice(from, to) : "";
    if (selected && !selected.includes("\n")) findInput.value = selected;
    findInput.focus();
    findInput.select();
    findKey = "";
    refreshFind();
  }

  function closeFind(): void {
    findBar.classList.add("hidden");
    findOpenBtn.setAttribute("aria-expanded", "false");
    findSoon.cancel();
    for (const editor of editors) editor.setMarks([]);
    current().editor.focus();
  }

  const findSoon = debounce(() => findStep(0), 120);
  findInput.addEventListener("input", findSoon);
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      findSoon.cancel();
      findStep(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
    }
  });
  findCase.addEventListener("click", () => {
    setPressed(findCase, !isPressed(findCase));
    findStep(0);
  });
  findPrev.addEventListener("click", () => findStep(-1));
  findNext.addEventListener("click", () => findStep(1));
  byId("find-close").addEventListener("click", closeFind);
  findOpenBtn.addEventListener("click", toggleFind);
  // Ctrl+F opens this find rather than the browser's, which cannot see the lines of a long
  // document that are not drawn; F3 steps through matches like most editors.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openFind();
    } else if (e.key === "F3") {
      e.preventDefault();
      if (!findOpen()) openFind();
      else findStep(e.shiftKey ? -1 : 1);
    }
  });

  return {
    changed(): void {
      findVersion++;
    },
    refresh(): void {
      if (findOpen()) refreshFind();
    },
    marks: showMarks,
    viewChanged(): void {
      findIndex = -1;
      findKey = "";
      if (findOpen()) refreshFind();
      else showMarks();
    },
  };
}
