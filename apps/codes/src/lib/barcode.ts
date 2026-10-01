export type BarcodeKind = "code128" | "ean13" | "upca";
export interface Barcode {
  modules: boolean[];
  text: string;
  kind: BarcodeKind;
  symbols?: number[];
}
/** Standard Code 128 run widths (ISO/IEC 15417), checked against ZXing's CODE_PATTERNS. */
const WIDTHS =
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(
    " "
  );
const L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];
export function checkDigit(digits: string): string {
  let sum = 0;
  for (let i = digits.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3)
    sum += Number(digits[i]) * weight;
  return String((10 - (sum % 10)) % 10);
}
export function encodeBarcode(value: string, kind: BarcodeKind): Barcode {
  if (kind === "code128") {
    if (!/^[\x20-\x7e]{1,80}$/.test(value))
      throw new Error("Code 128 supports 1–80 printable ASCII characters here.");
    const numeric = /^\d+$/.test(value) && value.length % 2 === 0;
    const symbols = [numeric ? 105 : 104];
    if (numeric)
      for (let i = 0; i < value.length; i += 2) symbols.push(Number(value.slice(i, i + 2)));
    else for (const character of value) symbols.push(character.charCodeAt(0) - 32);
    symbols.push(symbols.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103, 106);
    const modules: boolean[] = [];
    for (const code of symbols)
      for (const [index, width] of [...WIDTHS[code]].entries())
        modules.push(...Array<boolean>(Number(width)).fill(index % 2 === 0));
    return { modules, text: value, kind, symbols };
  }
  const length = kind === "ean13" ? 13 : 12;
  let text = value.trim();
  if (!new RegExp("^\\d{" + (length - 1) + "," + length + "}$").test(text))
    throw new Error(
      (kind === "ean13" ? "EAN-13" : "UPC-A") +
        " needs " +
        (length - 1) +
        " digits (calculate checksum) or " +
        length +
        " digits (validate checksum)."
    );
  if (text.length === length - 1) text += checkDigit(text);
  else if (text.at(-1) !== checkDigit(text.slice(0, -1)))
    throw new Error("The barcode check digit is incorrect.");
  const ean = kind === "upca" ? "0" + text : text;
  const invert = (bits: string) => [...bits].map((bit) => (bit === "0" ? "1" : "0")).join("");
  let bits = "101";
  for (let i = 1; i <= 6; i++) {
    const pattern = L[Number(ean[i])];
    bits +=
      PARITY[Number(ean[0])][i - 1] === "L" ? pattern : [...invert(pattern)].reverse().join("");
  }
  bits += "01010";
  for (let i = 7; i < 13; i++) bits += invert(L[Number(ean[i])]);
  bits += "101";
  return { modules: [...bits].map((bit) => bit === "1"), text, kind };
}
