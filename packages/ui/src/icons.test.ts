import { describe, expect, test } from "bun:test";
import { ICONS, withIcons } from "./icons.js";

describe("withIcons", () => {
  test("fills an empty svg, keeping its attributes and adding the viewBox", () => {
    const html = withIcons('<button><svg class="glyph" data-ui-icon="help"></svg></button>');
    expect(html).toBe(
      `<button><svg class="glyph" data-ui-icon="help" viewBox="0 0 24 24">${ICONS.help}</svg></button>`
    );
  });

  test("fills a sprite symbol, and leaves a viewBox it already has", () => {
    const html = withIcons(
      '<symbol id="icon-copy" viewBox="0 0 24 24" data-ui-icon="copy">\n</symbol>'
    );
    expect(html).toBe(
      `<symbol id="icon-copy" viewBox="0 0 24 24" data-ui-icon="copy">${ICONS.copy}</symbol>`
    );
  });

  test("leaves every other svg alone", () => {
    const html = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg><svg data-ui-icon="x">kept</svg>';
    expect(withIcons(html)).toBe(html);
  });

  test("an unknown icon fails the build", () => {
    expect(() => withIcons('<svg data-ui-icon="nope"></svg>')).toThrow(/Unknown icon "nope"/);
  });

  test("every icon draws in currentColor", () => {
    for (const markup of Object.values(ICONS)) expect(markup).toContain("currentColor");
  });
});
