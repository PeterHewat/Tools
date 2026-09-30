import { describe, expect, test } from "bun:test";
import {
  documentFile,
  documentFileName,
  libraryFile,
  isSvgFile,
  libraryFileName,
  readDocumentFile,
  svgDocument,
} from "./document-files.js";
import { readProject, serializeProject } from "./io.js";
import { createInitialState } from "./state.js";

const data = serializeProject(createInitialState());

describe("document files", () => {
  test("a single document reads back as one", () => {
    const text = JSON.stringify(documentFile({ name: "Logo", data }));
    expect(readDocumentFile(text)).toEqual([{ name: "Logo", data: readProject(data) }]);
  });

  test("a library reads back as all of its documents, in order", () => {
    const text = JSON.stringify(
      libraryFile([
        { name: "One", data },
        { name: "Two", data },
      ])
    );
    expect(readDocumentFile(text).map((d) => d.name)).toEqual(["One", "Two"]);
  });

  test("tags travel with a document, cleaned; none are written when there are none", () => {
    const text = JSON.stringify(documentFile({ name: "Logo", tags: ["icons", "Icons "], data }));
    expect(readDocumentFile(text)[0]!.tags).toEqual(["icons"]);
    expect(documentFile({ name: "Logo", tags: [], data })).not.toHaveProperty("tags");
    const lib = JSON.stringify(libraryFile([{ name: "One", tags: ["a"], data }]));
    expect(readDocumentFile(lib)[0]!.tags).toEqual(["a"]);
  });

  test("a document without a name is still imported, as Untitled", () => {
    const text = JSON.stringify({ ...documentFile({ name: "x", data }), name: " " });
    expect(readDocumentFile(text)[0]!.name).toBe("Untitled");
  });

  test("anything else is refused with a reason", () => {
    expect(() => readDocumentFile("not json")).toThrow("not valid JSON");
    expect(() => readDocumentFile(JSON.stringify({ tag: "other" }))).toThrow("not an SVG app");
    const newer = JSON.stringify(
      documentFile({ name: "x", data: { ...data, version: 99 as typeof data.version } })
    );
    expect(() => readDocumentFile(newer)).toThrow("newer version");
  });

  test("file names are safe everywhere", () => {
    expect(documentFileName('a/b:c*"d')).toBe("abcd.svg.json");
    expect(libraryFileName(new Date("2026-09-26T10:00:00Z"))).toBe(
      "SVG library 2026-09-26.svg.json"
    );
  });
});

describe("SVG files", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32">' +
    '<rect x="1" y="2" width="10" height="5" fill="#ff0000"/></svg>';

  test("are told from document files and pictures by name or type", () => {
    expect(isSvgFile({ name: "Logo.SVG", type: "" })).toBe(true);
    expect(isSvgFile({ name: "drop", type: "image/svg+xml" })).toBe(true);
    expect(isSvgFile({ name: "Logo.svg.json", type: "application/json" })).toBe(false);
    expect(isSvgFile({ name: "photo.png", type: "image/png" })).toBe(false);
  });

  test("becomes a document named after the file, at the file's size", () => {
    const doc = svgDocument("Logo.svg", svg);
    expect(doc.name).toBe("Logo");
    expect(doc.data.artboard).toEqual({ width: 64, height: 32 });
    expect(doc.data.elements.map((e) => e.type)).toEqual(["rect"]);
    // What it stores reads back as any stored document does.
    expect(readProject(doc.data).elements).toHaveLength(1);
  });

  test("anything that is not SVG is refused", () => {
    expect(() => svgDocument("x.svg", "hello")).toThrow();
  });
});
