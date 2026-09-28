import { describe, expect, test } from "bun:test";
import { createEditor, type EditorOptions } from "./index.js";

const make = (text: string, options: EditorOptions = {}) => {
  const parent = document.createElement("div");
  document.body.append(parent);
  return createEditor(parent, { text, language: "json", ...options });
};

const DOC = '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": true\n  }\n}';

describe("createEditor", () => {
  test("holds and replaces the text", () => {
    const ed = make("abc");
    expect(ed.text).toBe("abc");
    ed.setText("abXc");
    expect(ed.text).toBe("abXc");
    expect(ed.lineCount).toBe(1);
  });

  test("setText reports a change from code, not from the user", () => {
    const seen: boolean[] = [];
    const ed = make("abc", { onChange: (user) => seen.push(user) });
    ed.setText("abcd");
    expect(seen).toEqual([false]);
  });

  test("a rewrite keeps the caret where the text did not change", () => {
    const ed = make("hello world");
    ed.select(2);
    ed.setText("hello there world");
    expect(ed.selection.head).toBe(2);
  });

  test("position and line are 1-based", () => {
    const ed = make(DOC);
    const at = DOC.indexOf('"c"');
    expect(ed.position(at)).toEqual({ line: 7, column: 5 });
    expect(ed.line(7)).toBe('    "c": true');
  });

  test("foldAll leaves the root open, and select unfolds what hides the selection", () => {
    const ed = make(DOC);
    ed.foldAll();
    const folded = () => ed.dom.querySelectorAll(".cm-foldPlaceholder").length;
    expect(folded()).toBe(2);
    const at = DOC.indexOf('"c"');
    ed.select(at, at + 3, { scroll: false });
    expect(folded()).toBe(1);
    ed.unfoldAll();
    expect(folded()).toBe(0);
  });

  test("canFold and hasFolds say whether Fold all and Unfold all have anything to do", () => {
    const ed = make(DOC);
    expect([ed.canFold, ed.hasFolds]).toEqual([true, false]);
    ed.foldAll();
    expect([ed.canFold, ed.hasFolds]).toEqual([false, true]);
    ed.unfoldAll();
    expect([ed.canFold, ed.hasFolds]).toEqual([true, false]);
    // Only the value that holds the document spans lines: nothing Fold all would fold.
    expect(make('{\n  "a": [1, 2]\n}').canFold).toBe(false);
    expect(make("").canFold).toBe(false);
    // A brace inside a comment bends the JSON grammar's tree; the array still folds.
    expect(make('{\n  /* see {x} */\n  "a": [\n    1\n  ]\n}').canFold).toBe(true);
  });

  test("fold placeholders say what they hold", () => {
    const ed = make(DOC);
    ed.foldAll();
    const labels = [...ed.dom.querySelectorAll(".cm-foldPlaceholder")].map((e) => e.textContent);
    expect(labels).toEqual(["… 2 items", "… 1 key"]);
  });

  test("error marks the line in the gutter", () => {
    const ed = make(DOC);
    ed.setError({ from: DOC.indexOf("true"), message: "nope" });
    const mark = ed.dom.querySelector(".cm-error-mark");
    expect(mark?.textContent).toBe("true");
    expect(mark?.getAttribute("title")).toBe("nope");
    ed.setError(null);
    expect(ed.dom.querySelector(".cm-error-mark")).toBeNull();
  });

  test("marks and line labels", () => {
    const ed = make("one\ntwo\nthree", { language: null });
    ed.setMarks([{ start: 4, end: 7, current: true }]);
    expect(ed.dom.querySelector(".cm-find-current")?.textContent).toBe("two");
    ed.setLineLabels([10, null, 12]);
    const numbers = [...ed.dom.querySelectorAll(".cm-lineNumbers .cm-gutterElement")]
      .map((e) => e.textContent)
      .filter((t) => t !== null);
    expect(numbers).toContain("12");
    expect(numbers).not.toContain("3");
  });

  test("a line lexer colours tokens with t- classes", () => {
    const ed = make('"k": 1', {
      colours: (line) => [
        { kind: "key", text: line.slice(0, 3) },
        { kind: "plain", text: line.slice(3, 5) },
        { kind: "number", text: line.slice(5) },
      ],
    });
    expect(ed.dom.querySelector(".t-key")?.textContent).toBe('"k"');
    expect(ed.dom.querySelector(".t-number")?.textContent).toBe("1");
  });
});
