import { expect, test } from "bun:test";
import { formatBytes } from "./dom.js";

test("file sizes use one format and round across unit boundaries", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(850)).toBe("850 B");
  expect(formatBytes(1023)).toBe("1023 B");
  expect(formatBytes(1024)).toBe("1 KB");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(6861)).toBe("6.7 KB");
  expect(formatBytes(1024 * 1024 - 10)).toBe("1 MB");
  expect(formatBytes(3 * 1024 * 1024)).toBe("3 MB");
});
