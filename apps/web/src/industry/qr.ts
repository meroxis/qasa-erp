/**
 * A small QR code encoder (ISO/IEC 18004): byte mode, error correction L or M, versions 1–40, the mask with the
 * lowest penalty. Written for Qasa ERP's invoice codes so the app needs no outside library; the structure follows
 * Project Nayuki's well-known reference implementation (MIT), rewritten here for byte mode only.
 */

export type QrEcc = 'L' | 'M';

// codewords of error correction per block, and number of blocks, by level and version (index 0 unused)
const ECC_PER_BLOCK: Record<QrEcc, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
};
const BLOCKS: Record<QrEcc, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
};
const FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0 };

function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (ver: number, ecc: QrEcc) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecc][ver]! * BLOCKS[ecc][ver]!;

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => { result[i]! ^= gfMultiply(coef, factor); });
  }
  return result;
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 17 - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** The QR code for `text` (UTF-8): a square of dark (true) and light modules, without the quiet zone. */
export function encodeQr(text: string, ecc: QrEcc = 'M'): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  for (; ; ver++) {
    if (ver > 40) throw new Error('qr_too_long');
    const bits = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
    if (bits <= dataCodewords(ver, ecc) * 8) break;
  }

  // the data: byte mode, the count, the bytes, a terminator and padding
  const bitList: number[] = [];
  const append = (value: number, len: number) => { for (let i = len - 1; i >= 0; i--) bitList.push((value >>> i) & 1); };
  append(0b0100, 4);
  append(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) append(b, 8);
  const capacity = dataCodewords(ver, ecc) * 8;
  append(0, Math.min(4, capacity - bitList.length));
  append(0, (8 - (bitList.length % 8)) % 8);
  for (let pad = 0xec; bitList.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bitList.length; i += 8) data.push(bitList.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));

  // error correction per block, then interleaved
  const numBlocks = BLOCKS[ecc][ver]!;
  const blockEccLen = ECC_PER_BLOCK[ecc][ver]!;
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const eccBytes = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(eccBytes));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) codewords.push(block[i]!);
    });
  }

  // the grid with its fixed patterns
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setFixed = (x: number, y: number, dark: boolean) => { modules[y]![x] = dark; fixed[y]![x] = true; };

  for (let i = 0; i < size; i++) {
    setFixed(6, i, i % 2 === 0);
    setFixed(i, 6, i % 2 === 0);
  }
  const finder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFixed(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align = alignmentPositions(ver);
  const last = align.length - 1;
  align.forEach((ay, i) => align.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFixed(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));

  const drawFormat = (mask: number) => {
    const value = (FORMAT_BITS[ecc] << 3) | mask;
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((value << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFixed(8, i, bit(i));
    setFixed(8, 7, bit(6));
    setFixed(8, 8, bit(7));
    setFixed(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFixed(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFixed(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFixed(8, size - 15 + i, bit(i));
    setFixed(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setFixed(a, b, dark);
      setFixed(b, a, dark);
    }
  }

  // the codewords in the zigzag
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fixed[y]![x] && i < codewords.length * 8) {
          modules[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }

  const masked = (mask: number, x: number, y: number) => {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y]![x] && masked(mask, x, y)) modules[y]![x] = !modules[y]![x];
  };

  // the mask that leaves the fewest long runs, 2×2 blocks and the most even dark/light balance
  const penalty = () => {
    let score = 0;
    for (let a = 0; a < size; a++) {
      let runRow = 1, runCol = 1;
      for (let b = 1; b < size; b++) {
        if (modules[a]![b] === modules[a]![b - 1]) runRow++; else { if (runRow >= 5) score += runRow - 2; runRow = 1; }
        if (modules[b]![a] === modules[b - 1]![a]) runCol++; else { if (runCol >= 5) score += runCol - 2; runCol = 1; }
      }
      if (runRow >= 5) score += runRow - 2;
      if (runCol >= 5) score += runCol - 2;
    }
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (modules[y]![x]) dark++;
        if (y + 1 < size && x + 1 < size) {
          const c = modules[y]![x];
          if (c === modules[y]![x + 1] && c === modules[y + 1]![x] && c === modules[y + 1]![x + 1]) score += 3;
        }
      }
    }
    const total = size * size;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return score;
  };
  let best = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const score = penalty();
    if (score < bestScore) { best = mask; bestScore = score; }
    applyMask(mask);
  }
  applyMask(best);
  drawFormat(best);
  return modules;
}

/** An SVG path ("M x y h1 v1 h-1 z" per dark module) for a QR code, with a quiet zone of `border` modules. */
export function qrSvgPath(modules: boolean[][], border = 4): { path: string; size: number } {
  const parts: string[] = [];
  modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) parts.push(`M${x + border} ${y + border}h1v1h-1z`); }));
  return { path: parts.join(''), size: modules.length + border * 2 };
}
