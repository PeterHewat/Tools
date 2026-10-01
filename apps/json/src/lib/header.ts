import { bindDock, bindMenu, bindThemeToggle, byId } from "@tools/ui";

/** Header menus and docks own their layout behavior; document actions stay in the controller. */
export function bindHeader(): void {
  const more = byId("more");
  const moreBtn = byId<HTMLButtonElement>("more-btn");
  const fileButtons = ["open", "download", "copy", "clear"].map((id) =>
    byId<HTMLButtonElement>(id)
  );
  const findButton = byId<HTMLButtonElement>("find-open");
  const menu = bindMenu(moreBtn, more, {
    onOpen: () =>
      more.replaceChildren(
        ...[
          ...fileButtons,
          ...(getComputedStyle(findButton).display === "none" ? [findButton] : []),
        ].map((button) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "ui-menu-item";
          item.disabled = button.disabled;
          item.append(
            button.querySelector("svg")!.cloneNode(true),
            button.title.replace(/ —.*/, "")
          );
          item.addEventListener("click", () => {
            menu.close();
            button.click();
          });
          return item;
        })
      ),
  });
  bindDock(byId("help"), byId("help-btn"), { key: "tools.json.help" }).restore();
  bindThemeToggle(byId("theme-toggle"));
}
