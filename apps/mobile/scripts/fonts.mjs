// The phone app's fonts, the desktop app's own: Noto Sans Arabic (Arabic and Kurdish) and IBM Plex Sans (English and
// numbers), SIL Open Font License 1.1, from the @fontsource packages the desktop app ships (THIRD_PARTY_NOTICES.md).
// Android and iOS read TrueType, not the web's WOFF: this unpacks each WOFF (its tables, zlib-compressed one by one)
// back into the TrueType file it was made from. The results are committed in assets/fonts, so the app builds without
// the monorepo's packages; run this again after updating @fontsource in the monorepo.
//   node scripts/fonts.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const fontsource = join(here, '..', '..', '..', 'node_modules', '@fontsource');
const out = join(here, '..', 'assets', 'fonts');

/** WOFF 1.0 (https://www.w3.org/TR/WOFF/) to the sfnt (TrueType/OpenType) it holds. */
export function woffToSfnt(woff) {
  if (woff.readUInt32BE(0) !== 0x774f4646) throw new Error('not a WOFF file');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const at = 44 + i * 20;
    const tag = woff.subarray(at, at + 4);
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const checksum = woff.readUInt32BE(at + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(raw) : Buffer.from(raw);
    if (data.length !== origLength) throw new Error(`table ${tag} has the wrong length`);
    tables.push({ tag, checksum, data, offset });
  }
  let power = 1;
  while (power * 2 <= numTables) power *= 2;
  const header = Buffer.alloc(12 + numTables * 16);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(power * 16, 6);
  header.writeUInt16BE(Math.log2(power), 8);
  header.writeUInt16BE(numTables * 16 - power * 16, 10);
  // the records sorted by tag (as in the WOFF directory), the data in the order the original font had it
  const chunks = [header];
  let position = header.length;
  const placed = new Map();
  for (const t of [...tables].sort((a, b) => a.offset - b.offset)) {
    placed.set(t, position);
    const padded = Buffer.alloc((t.data.length + 3) & ~3);
    t.data.copy(padded);
    chunks.push(padded);
    position += padded.length;
  }
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    t.tag.copy(header, at);
    header.writeUInt32BE(t.checksum, at + 4);
    header.writeUInt32BE(placed.get(t), at + 8);
    header.writeUInt32BE(t.data.length, at + 12);
  });
  return Buffer.concat(chunks);
}

const FONTS = [
  ['noto-sans-arabic', 'noto-sans-arabic-arabic-400-normal.woff', 'NotoSansArabic-Regular.ttf'],
  ['noto-sans-arabic', 'noto-sans-arabic-arabic-600-normal.woff', 'NotoSansArabic-SemiBold.ttf'],
  ['noto-sans-arabic', 'noto-sans-arabic-arabic-700-normal.woff', 'NotoSansArabic-Bold.ttf'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff', 'IBMPlexSans-Regular.ttf'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff', 'IBMPlexSans-SemiBold.ttf'],
  ['ibm-plex-sans', 'ibm-plex-sans-latin-700-normal.woff', 'IBMPlexSans-Bold.ttf']
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(fontsource)) {
    console.log('@fontsource is not installed in the monorepo (npm ci at the root): keeping assets/fonts as they are');
  } else {
    mkdirSync(out, { recursive: true });
    for (const [pkg, file, name] of FONTS) {
      writeFileSync(join(out, name), woffToSfnt(readFileSync(join(fontsource, pkg, 'files', file))));
      console.log(`assets/fonts/${name}`);
    }
    copyFileSync(join(fontsource, 'noto-sans-arabic', 'LICENSE'), join(out, 'NotoSansArabic-OFL.txt'));
    copyFileSync(join(fontsource, 'ibm-plex-sans', 'LICENSE'), join(out, 'IBMPlexSans-OFL.txt'));
  }
}
