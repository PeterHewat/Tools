import {
  bindTimeFields,
  bindToolHelp,
  byId,
  debounce,
  readDraft,
  registerServiceWorker,
  showMessage,
  writeDraft,
} from "@tools/ui";
import type { App, View } from "./app.js";
import { convertView } from "./convert.js";
import { durationView } from "./duration-view.js";
import { press } from "./dom.js";
import { meetView, SHARE_PREFIX } from "./meet.js";
import { readPrefs, writePrefs } from "./prefs.js";

bindToolHelp("time");
registerServiceWorker();

type ViewName = "convert" | "meet" | "duration";
const NAMES: readonly ViewName[] = ["meet", "convert", "duration"];

/** The tab's draft: every view's fields, and which view is open. Other apps may write it too. */
const DRAFT = 1;
const draft = readDraft("time", DRAFT);
const prefs = readPrefs();
/** Filled once every view is made; a save asked for while they are being made waits for it. */
const views = {} as Record<ViewName, View>;
// A share link opens on the people it holds.
let current: ViewName = location.hash.startsWith(SHARE_PREFIX)
  ? "meet"
  : (NAMES.find((name) => name === draft.value.view) ?? "meet");

function save(): void {
  // An incompatible draft stays as it was: this tab works without saving over it.
  if (draft.error || !views.duration) return;
  const value = {
    view: current,
    ...views.convert.values(),
    ...views.meet.values(),
    ...views.duration.values(),
  };
  if (!writeDraft("time", DRAFT, value)) {
    const status = byId("draft-status");
    status.hidden = false;
    showMessage(status, "Draft could not be remembered (storage unavailable or over 2 MB).", true);
  }
}
const saveSoon = debounce(save, 300);
// A reload or a closed tab just after an edit still keeps it.
window.addEventListener("pagehide", save);

const app: App = {
  prefs,
  saved: draft.error ? {} : draft.value,
  save: saveSoon,
  savePrefs: () => writePrefs(prefs),
  clipboardFailed(where) {
    showMessage(where, "Clipboard unavailable: select the text and copy it.", true);
  },
  show(view) {
    // Asked while the views are still being made (a share link): they open on it.
    if (views.duration) show(view);
    else current = view;
  },
};

Object.assign(views, {
  convert: convertView(app),
  meet: meetView(app),
  duration: durationView(app),
});

const viewButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-view]")];
const viewSelect = byId<HTMLSelectElement>("view-select");
function show(name: ViewName): void {
  current = name;
  press(viewButtons, "view", name);
  // The page's styles show this view (see the head of index.html).
  document.documentElement.dataset.timeView = name;
  viewSelect.value = name;
  for (const view of NAMES) {
    views[view].shown(view === name);
  }
  saveSoon();
}
for (const button of viewButtons)
  button.addEventListener("click", () => show(button.dataset.view as ViewName));
viewSelect.addEventListener("change", () => show(viewSelect.value as ViewName));

bindTimeFields();

if (draft.error) {
  const status = byId("draft-status");
  status.hidden = false;
  showMessage(status, draft.error, true);
}
show(current);
