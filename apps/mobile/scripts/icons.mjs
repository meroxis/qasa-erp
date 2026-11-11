// The phone app's icons, drawn from the Qasa mark the desktop app uses (apps/web/public/favicon.svg): the navy
// magnifier with its three ticks on the orange square. Own drawing, no image tools: each pixel is sampled 4×4 against
// the shapes (a rounded square, a ring, rounded strokes) and written as a PNG with Node's zlib.
//   node scripts/icons.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets');

const ORANGE = [0xf2, 0xa3, 0x3a, 255];
const NAVY = [0x0f, 0x1e, 0x3d, 255];
const WHITE = [255, 255, 255, 255];

// ——— the mark, in the favicon's 28-unit square ———

const segment = (px, py, ax, ay, bx, by, r) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - r;
};
const ring = (px, py, cx, cy, r, w) => Math.abs(Math.hypot(px - cx, py - cy) - r) - w / 2;
const roundedSquare = (px, py, x, y, size, r) => {
  const qx = Math.abs(px - (x + size / 2)) - (size / 2 - r);
  const qy = Math.abs(py - (y + size / 2)) - (size / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

/** Inside the navy glyph (favicon units)? */
function glyph(x, y) {
  return ring(x, y, 14, 13.5, 6.5, 2.6) <= 0
    || segment(x, y, 18.3, 17.8, 22, 21.5, 1.3) <= 0
    || segment(x, y, 14, 4.8, 14, 7, 0.8) <= 0
    || segment(x, y, 5.3, 13.5, 7.5, 13.5, 0.8) <= 0
    || segment(x, y, 20.5, 13.5, 22.7, 13.5, 0.8) <= 0;
}

/**
 * One picture: `size` pixels square showing the units from `origin` across `span`; `paint(x, y)` gives the colour at a
 * point in favicon units (or null: transparent). Edges are smoothed by 16 samples a pixel.
 */
function draw(size, origin, span, paint) {
  const px = new Uint8Array(size * size * 4);
  const n = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const acc = [0, 0, 0, 0];
      for (let sj = 0; sj < n; sj++) {
        for (let si = 0; si < n; si++) {
          const c = paint(origin[0] + ((i + (si + 0.5) / n) / size) * span, origin[1] + ((j + (sj + 0.5) / n) / size) * span);
          if (!c) continue;
          // premultiplied, so a transparent sample adds nothing to the colour
          acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3];
        }
      }
      const o = (j * size + i) * 4;
      const a = acc[3] / (n * n);
      px[o + 3] = Math.round(a);
      if (acc[3] > 0) for (let k = 0; k < 3; k++) px[o + k] = Math.round(acc[k] / acc[3]);
    }
  }
  return px;
}

// ——— PNG (RGBA, 8 bits a channel) ———

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 8 + data.length);
  return out;
}

export function png(size, rgba, opaque = false) {
  const channels = opaque ? 3 : 4;
  const rows = Buffer.alloc(size * (size * channels + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * channels + 1)] = 0;
    for (let x = 0; x < size; x++) {
      for (let k = 0; k < channels; k++) rows[y * (size * channels + 1) + 1 + x * channels + k] = rgba[(y * size + x) * 4 + k];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

// the glyph's own box is about 4…23.5 across and 4…22.8 down: centred on (14, 13.4)
const centred = (span) => [14 - span / 2, 13.4 - span / 2];
const glyphOnly = (colour) => (x, y) => (glyph(x, y) ? colour : null);
const mark = (x, y) => (glyph(x, y) ? NAVY : roundedSquare(x, y, 1, 1, 26, 7) <= 0 ? ORANGE : null);

const PICTURES = [
  // the store icon and iOS: the full square (the system rounds it)
  ['icon.png', 1024, [-1, -1], 30, (x, y) => (glyph(x, y) ? NAVY : ORANGE), true],
  // Android's adaptive icon: the whole glyph inside the circle every launcher keeps (66 of 108 dp across), on the orange
  ['android-icon-foreground.png', 512, centred(42), 42, glyphOnly(NAVY)],
  ['android-icon-background.png', 512, [0, 0], 28, () => ORANGE, true],
  ['android-icon-monochrome.png', 432, centred(42), 42, glyphOnly(WHITE)],
  ['splash-icon.png', 1024, [-3, -3], 34, mark],
  ['favicon.png', 48, [0, 0], 28, mark]
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [name, size, origin, span, paint, opaque] of PICTURES) {
    writeFileSync(join(assets, name), png(size, draw(size, origin, span, paint), !!opaque));
    console.log(`assets/${name}`);
  }
}
