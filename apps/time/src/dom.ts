/** Building the parts of the page drawn from data: results, people, suggestions, the timeline. */

import { copyText, iconSvg } from "@tools/ui";

type Child = Node | string | false | undefined | null;

/** An element with attributes (`class`, `aria-*`, `data-*`, …) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

/** A copy button for a value, flashing when copied; `onFail` when the clipboard refuses. */
export function copyButton(
  label: string,
  value: () => string,
  onFail: () => void
): HTMLButtonElement {
  const button = h(
    "button",
    { type: "button", class: "ui-btn ui-icon-btn", "aria-label": label },
    iconSvg("copy")
  );
  button.addEventListener("click", async () => {
    if (!(await copyText(value(), button))) onFail();
  });
  return button;
}

/** Pressed state for a set of buttons that pick one value. */
export function press(buttons: Iterable<HTMLElement>, attribute: string, value: string): void {
  for (const button of buttons)
    button.setAttribute("aria-pressed", String(button.dataset[attribute] === value));
}
