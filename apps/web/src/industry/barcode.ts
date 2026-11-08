/**
 * Barcodes for printed labels, drawn as SVG (no font or library needed, prints sharp at any size).
 *
 * - EAN-13 when the code is 13 digits with a correct check digit (or 12 digits: the check digit is added) — what shop
 *   scanners and the goods already on Iraqi shelves use.
 * - Code 128 for anything else (item codes like "P-1", short numbers): set B for text, set C for long runs of digits,
 *   so a long number stays short on the label.
 *
 * Both give a list of bar and space widths in modules (narrowest bar = 1), starting with a bar.
 */

export type BarcodeKind = 'ean13' | 'code128';

export interface Barcode {
  kind: BarcodeKind;
  /** the text printed under the bars (EAN-13 with its check digit) */
  text: string;
  /** widths in modules, bar, space, bar, … */
  widths: number[];
  /** modules in all, without the quiet zones */
  modules: number;
}

/* ---------- EAN-13 ---------- */

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** The EAN-13 check digit of the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** True when the text is a whole, correct EAN-13 (13 digits, right check digit). */
export function isEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

function bitsToWidths(bits: string): number[] {
  const widths: number[] = [];
  let run = 1;
  for (let i = 1; i <= bits.length; i++) {
    if (bits[i] === bits[i - 1]) run++;
    else { widths.push(run); run = 1; }
  }
  return widths;
}

export function encodeEan13(code: string): Barcode {
  const full = /^\d{12}$/.test(code) ? code + ean13CheckDigit(code) : code;
  if (!isEan13(full)) throw new Error('ean13_invalid');
  const parity = EAN_PARITY[Number(full[0])]!;
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[Number(full[i])]!;
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(full[i])]!;
  bits += '101';
  return { kind: 'ean13', text: full, widths: bitsToWidths(bits), modules: bits.length };
}

/* ---------- Code 128 ---------- */

// each symbol: bar, space, bar, space, bar, space widths (11 modules); 106 is STOP (13 modules, 7 widths)
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

/** Code 128 takes printable ASCII (space to ~); anything else can't go on the label. */
export function code128Encodable(text: string): boolean {
  return text.length > 0 && text.length <= 48 && /^[\x20-\x7e]+$/.test(text);
}

/** Runs of digits worth printing in set C (pairs of digits, half the width). */
function digitRun(text: string, from: number): number {
  let n = 0;
  while (from + n < text.length && text.charCodeAt(from + n) >= 48 && text.charCodeAt(from + n) <= 57) n++;
  return n;
}

export function code128Values(text: string): number[] {
  if (!code128Encodable(text)) throw new Error('code128_invalid');
  const values: number[] = [];
  let set: 'B' | 'C';
  let i = 0;
  const lead = digitRun(text, 0);
  if ((lead >= 4 || lead === text.length) && lead >= 2 && lead % 2 === 0) { set = 'C'; values.push(START_C); }
  else { set = 'B'; values.push(START_B); }
  while (i < text.length) {
    const run = digitRun(text, i);
    if (set === 'B' && run >= 6) {
      // switch to C for an even number of the digits; an odd one left over is printed in B first
      if (run % 2 === 1) { values.push(text.charCodeAt(i) - 32); i++; }
      values.push(CODE_C);
      set = 'C';
      continue;
    }
    if (set === 'C') {
      if (run >= 2) { values.push(Number(text.slice(i, i + 2))); i += 2; continue; }
      values.push(CODE_B);
      set = 'B';
      continue;
    }
    values.push(text.charCodeAt(i) - 32);
    i++;
  }
  let check = values[0]!;
  for (let k = 1; k < values.length; k++) check += values[k]! * k;
  values.push(check % 103, STOP);
  return values;
}

export function encodeCode128(text: string): Barcode {
  const widths = code128Values(text).flatMap((v) => C128[v]!.split('').map(Number));
  return { kind: 'code128', text, widths, modules: widths.reduce((a, b) => a + b, 0) };
}

/** The barcode for an item: its barcode as EAN-13 when it is one, else Code 128 of the barcode or the item code. */
export function barcodeFor(code: string): Barcode | null {
  const clean = code.trim();
  if (!clean) return null;
  if (isEan13(clean) || /^\d{12}$/.test(clean)) return encodeEan13(clean);
  return code128Encodable(clean) ? encodeCode128(clean) : null;
}

/** One SVG path of all the bars, in modules (x) and units of the given height (y). */
export function barsPath(widths: number[], height: number): string {
  let x = 0;
  let d = '';
  widths.forEach((w, i) => {
    if (i % 2 === 0) d += `M${x} 0h${w}v${height}h${-w}Z`;
    x += w;
  });
  return d;
}
