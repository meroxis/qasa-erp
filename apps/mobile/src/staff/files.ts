import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { FONT_SOURCES } from '../fonts';
import type { PdfFonts } from './pdf';
import { shareExpired } from './share';

/**
 * The files the staff's 1.1 features leave on the phone, and where they go: a receipt's photo from the camera and its
 * smaller copy (deleted as soon as the photo is kept in the outbox, and swept at every start), and the last PDF shared
 * (kept in the app's own cache until the next share, the next start, or SHARE_KEEP_MS after the share, so the app it
 * was handed to can still read it when the user sends it). Nothing is written anywhere else; Android backup is off.
 */

/** Where the camera and the image manipulator leave their pictures (this app's own cache). */
const TEMP_DIRS = ['Camera', 'ImageManipulator'];
const shareDir = () => new Directory(Paths.cache, 'share');

let sharedAt: number | null = null;

/** Deletes one file the app made for a moment (a photo before it was made small): ignored when it is gone already. */
export function deleteTemporary(uri: string | null | undefined): void {
  if (!uri || !uri.startsWith('file://')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch { /* gone already */ }
}

function emptyShareFolder(): void {
  try {
    const dir = shareDir();
    if (dir.exists) dir.delete();
  } catch { /* nothing to remove */ }
  sharedAt = null;
}

/** At start: the camera's and the manipulator's leftovers, and the last PDF shared. */
export function cleanTemporaryFiles(): void {
  for (const name of TEMP_DIRS) {
    try {
      const dir = new Directory(Paths.cache, name);
      if (dir.exists) dir.delete();
    } catch { /* nothing to remove */ }
  }
  emptyShareFolder();
}

/** The app is back on the screen: the last PDF shared goes once it was shared long enough ago. */
export function sweepShared(now = Date.now()): void {
  if (shareExpired(sharedAt, now)) emptyShareFolder();
}

let fonts: Promise<PdfFonts | null> | null = null;

/** The app's own fonts for the PDF (read once from the app's assets); null when they can't be read (system fonts then). */
export function pdfFonts(): Promise<PdfFonts | null> {
  if (!fonts) {
    const read = async (source: number) => {
      const asset = await Asset.fromModule(source).downloadAsync();
      return asset.localUri ? new File(asset.localUri).base64() : null;
    };
    fonts = Promise.all([
      read(FONT_SOURCES['NotoSansArabic-Regular']), read(FONT_SOURCES['NotoSansArabic-Bold']),
      read(FONT_SOURCES['IBMPlexSans-Regular']), read(FONT_SOURCES['IBMPlexSans-Bold'])
    ]).then(([arabicRegular, arabicBold, latinRegular, latinBold]) =>
      arabicRegular && arabicBold && latinRegular && latinBold ? { arabicRegular, arabicBold, latinRegular, latinBold } : null
    ).catch(() => null);
  }
  return fonts;
}

/**
 * Makes the PDF of `html` (A4) and hands it to Android's share sheet as `<ref>.pdf`. The previous PDF goes first; this
 * one stays until the next share, the next start, or SHARE_KEEP_MS after now.
 */
export async function sharePdf(html: string, ref: string, dialogTitle: string): Promise<void> {
  emptyShareFolder();
  // A4 in points; the page's own print rules (pdf.ts) set its margins
  const made = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const dir = shareDir();
  dir.create({ intermediates: true, idempotent: true });
  const target = new File(dir, `${ref}.pdf`);
  try {
    await new File(made.uri).move(target);
  } finally {
    // (moved: nothing left; not moved: the print engine's copy goes, nothing is shared)
    deleteTemporary(made.uri);
  }
  sharedAt = Date.now();
  await Sharing.shareAsync(target.uri, { mimeType: 'application/pdf', dialogTitle, UTI: 'com.adobe.pdf' });
}
