import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { BACKDROP_NAME, DEMOS, demoDocument, demosToAdd } from "./demos.js";
import { cleanTags } from "./doc-list.js";
import { formatExportSvg } from "./svg-export.js";
import { importSvgFile } from "./svg-import.js";
import { readProject } from "./project-file.js";

const dir = new URL("../../public/", import.meta.url);
const read = (file: string) => Bun.file(new URL(file, dir)).text();

describe("the demos", () => {
  test("every file is listed, and every listed file is there", () => {
    const files = readdirSync(new URL("demos/", dir))
      .filter((f) => f.endsWith(".svg"))
      .map((f) => `demos/${f}`);
    expect(DEMOS.map((d) => d.file).sort()).toEqual(["art.svg", ...files].sort());
  });

  test("the first is the drawing a first visit opens on: the index card's picture", () => {
    expect(DEMOS[0]!.file).toBe("art.svg");
  });

  test("names are distinct, and tags are as if typed", () => {
    expect(new Set(DEMOS.map((d) => d.name)).size).toBe(DEMOS.length);
    for (const d of DEMOS) expect(cleanTags(d.tags)).toEqual(d.tags);
  });

  for (const demo of DEMOS) {
    describe(demo.name, () => {
      test("is already in SVG's own format: exporting it gives the file back", async () => {
        const svg = await read(demo.file);
        const back = importSvgFile(svg, { keepIds: true });
        const again = formatExportSvg(
          {
            artboard: back.artboard!,
            background: back.background,
            elements: back.elements,
            groupNames: back.groupNames,
          },
          true
        );
        expect(again + "\n").toBe(svg);
      });

      test("becomes a document that opens, its backdrop first and locked", async () => {
        const doc = readProject(demoDocument(await read(demo.file)));
        expect(doc.elements.length).toBeGreaterThan(5);
        expect(doc.elements[0]!.name).toBe(BACKDROP_NAME);
        expect(doc.elements[0]!.locked).toBe(true);
        expect(doc.elements.filter((e) => e.locked)).toHaveLength(1);
      });
    });
  }

  test("a browser is given only the demos it has not had", () => {
    expect(demosToAdd([])).toEqual([...DEMOS]);
    expect(demosToAdd(DEMOS.map((d) => d.file))).toEqual([]);
    expect(demosToAdd([DEMOS[0]!.file]).map((d) => d.file)).not.toContain(DEMOS[0]!.file);
  });
});

const ART = await read("art.svg");

describe("the workbench", () => {
  const imported = importSvgFile(ART);

  test("imports whole, on its own artboard", () => {
    expect(imported.artboard).toEqual({ width: 320, height: 320 });
    expect(imported.elements.length).toBeGreaterThan(30);
  });

  test("reads like a layers list: every part of the desk is a named group", () => {
    expect(Object.values(imported.groupNames).sort()).toEqual([
      "desk",
      "laptop",
      "mug",
      "pencil",
      "plant",
      "ruler",
    ]);
  });

  test("shows off what it is there to show", () => {
    const types = new Set(imported.elements.map((e) => e.type));
    for (const t of ["polygon", "path", "ellipse", "rect"] as const) expect(types).toContain(t);
    expect(imported.elements.some((e) => e.fillEnabled && e.fillType === "linear")).toBe(true);
    expect(imported.elements.some((e) => e.type === "ellipse" && e.rotation)).toBe(true);
  });

  test("its backdrop is translucent, so it sits on a light page and a dark one", () => {
    const backdrop = imported.elements.find((e) => e.name === BACKDROP_NAME);
    expect(backdrop?.fillStops.every((s) => s.opacity < 0.5)).toBe(true);
  });
});
