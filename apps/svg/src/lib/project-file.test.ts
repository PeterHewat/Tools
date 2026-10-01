import { describe, expect, test } from "bun:test";
import { createDocument, readProject, serializeProject, cleanElement } from "./project-file.js";
import { createPath, createPoint, createRect, createImage, createText } from "./model.js";
import { formatExportSvg } from "./svg-export.js";

const project = () =>
  serializeProject({ ...createDocument(), elements: [createRect(0, 0, 20, 10)] });

describe("project structural validation", () => {
  test("missing path geometry is refused even beside a usable shape", () => {
    const raw = { ...project(), elements: [...project().elements, { id: "path-a", type: "path" }] };
    expect(() => readProject(raw)).toThrow(/damaged/);
    expect(cleanElement(raw.elements[1])).toBeNull();
  });

  test("valid version-1 geometry survives reading and export", () => {
    const raw = project();
    raw.elements.push(
      createPath([createPoint(0, 0), createPoint(5, 5)], false),
      createText(1, 2, "hi")
    );
    const opened = readProject(raw);
    expect(opened.elements).toEqual(raw.elements);
    expect(formatExportSvg(opened)).toBe(formatExportSvg(raw));
  });

  test.each([
    { x: "1" },
    { width: -1 },
    { y: Infinity },
    { rotation: NaN },
    { dash: [1, -2] },
    { name: {} },
    { hidden: "false" },
  ])("refuses invalid shape fields %j", (patch) => {
    const raw = project();
    Object.assign(raw.elements[0], patch);
    expect(() => readProject(raw)).toThrow(/damaged/);
  });

  test.each([
    { points: [null] },
    { points: [{ x: 0, y: 1 }] },
    { points: [{ ...createPoint(0, 0), hIn: { x: NaN, y: 0 } }] },
    { subpaths: [0] },
    { subpaths: [1, 1] },
    { subpaths: [0.5] },
    { subpaths: [2] },
    { closed: "false" },
  ])("refuses invalid anchors and subpaths %j", (patch) => {
    const raw = project();
    raw.elements = [Object.assign(createPath([createPoint(0, 0), createPoint(2, 2)]), patch)];
    expect(() => readProject(raw)).toThrow(/damaged/);
  });

  test.each([
    { grid: { step: 0, visible: true, snap: false } },
    { grid: { step: 1, visible: "true", snap: false } },
    { guides: { x: [NaN], y: [] } },
    { guides: { x: [], y: {} } },
    { groupNames: [] },
    { groupNames: { "group-a": 123 } },
    { groupHues: { "group-a": Infinity } },
    { version: 1.5 },
  ])("refuses invalid document fields %j", (patch) => {
    expect(() => readProject({ ...project(), ...patch })).toThrow();
  });

  test("duplicate identities are refused", () => {
    const raw = project();
    raw.elements.push(structuredClone(raw.elements[0]));
    expect(() => readProject(raw)).toThrow(/damaged/);
  });

  test("invalid image transforms are refused", () => {
    const raw = project();
    raw.images = [{ ...createImage("data:image/png;base64,AAAA", "a.png"), scaleX: NaN }];
    expect(() => readProject(raw)).toThrow(/damaged/);
  });
});
