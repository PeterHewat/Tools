import { byId } from "@tools/ui";
import { getState } from "./state.js";
import type { EditorState } from "./types.js";

/** The canvas needs no code editor until its source panel is shown. */
type SourceEditor = typeof import("./svg-source-editor.js");
let loaded: SourceEditor | null = null;
let loading: Promise<void> | null = null;
let focus: { id: string; field: string } | null = null;
let held = false;
/** A failed load waits for the Retry button instead of trying again on every change. */
let failed = false;
const host = byId("svg-editor");

function visible(): boolean {
  return host.checkVisibility();
}

function load(): void {
  if (loaded || loading || failed || !visible()) return;
  host.setAttribute("aria-busy", "true");
  loading = import("./svg-source-editor.js")
    .then((source) => {
      loaded = source;
      source.syncSvgEditor(getState());
      source.holdSvgFocus(held);
      source.setSvgFocus(focus);
    })
    .catch(() => {
      failed = true;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "ui-btn";
      retry.textContent = "Could not load SVG source. Retry";
      retry.addEventListener("click", () => {
        retry.remove();
        failed = false;
        load();
      });
      host.replaceChildren(retry);
    })
    .finally(() => {
      loading = null;
      host.removeAttribute("aria-busy");
    });
}

new ResizeObserver(load).observe(host);

export function syncSvgEditor(state: EditorState): void {
  if (loaded) loaded.syncSvgEditor(state);
  else load();
}

export function setSvgFocus(next: { id: string; field: string } | null): void {
  focus = next;
  loaded?.setSvgFocus(next);
}

export function holdSvgFocus(next: boolean): void {
  held = next;
  loaded?.holdSvgFocus(next);
}
