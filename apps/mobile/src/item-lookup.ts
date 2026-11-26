/**
 * A new item's picture and names by its barcode (phone app 1.2, with an office of Qasa ERP 2.0 on that offers it):
 * the office looks the barcode up in the open product databases (Open Food Facts and its sister projects) when its
 * admin has switched that on, and answers with name suggestions and the picture. The phone itself asks nobody but
 * its office; what comes back is somebody else's text and bytes, so it is read here field by field and anything that
 * is not what it should be is dropped. Nothing is filled in by itself: a name only when its chip is pressed, and the
 * picture can be unticked or replaced by a photo or a picture from the gallery.
 */

/** The databases a picture can come from, by the office's word for each, with the name that is credited. */
export const SOURCE_NAMES = {
  openfoodfacts: 'Open Food Facts',
  openbeautyfacts: 'Open Beauty Facts',
  openproductsfacts: 'Open Products Facts',
  openpetfoodfacts: 'Open Pet Food Facts'
} as const;
export type LookupSource = keyof typeof SOURCE_NAMES;

export interface LookupName { lang: 'ar' | 'en' | 'ku'; text: string }
export interface LookupPicture { mime: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }
export interface ItemLookup {
  found: boolean;
  names: LookupName[];
  picture: LookupPicture | null;
  source: LookupSource | null;
}

export const NOTHING_FOUND: ItemLookup = { found: false, names: [], picture: null, source: null };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** The largest picture taken from an answer, as base64 (an item's picture is at most 400 KB at the office). */
const MAX_BASE64 = Math.ceil((400 * 1024 * 4) / 3) + 4;
const MAX_NAMES = 4;

/**
 * What the office answered (POST /api/items/lookup), as the screen uses it. Anything unexpected (an office that
 * answers differently, a refusal, the setting off) is "nothing found": the screen then stays as it always was.
 */
export function readLookup(body: unknown): ItemLookup {
  if (!isRecord(body) || body.found !== true) return NOTHING_FOUND;
  const source = typeof body.source === 'string' && body.source in SOURCE_NAMES ? body.source as LookupSource : null;
  if (!source) return NOTHING_FOUND;
  const names: LookupName[] = [];
  for (const n of Array.isArray(body.names) ? body.names : []) {
    if (!isRecord(n) || (n.lang !== 'ar' && n.lang !== 'en' && n.lang !== 'ku') || typeof n.text !== 'string') continue;
    const text = n.text.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (text && !names.some((x) => x.text === text) && names.length < MAX_NAMES) names.push({ lang: n.lang, text });
  }
  const image = isRecord(body.image) ? body.image : null;
  const mime = image && (image.mime === 'image/jpeg' || image.mime === 'image/png' || image.mime === 'image/webp') ? image.mime : null;
  const data = image && typeof image.data === 'string' && image.data.length > 0 && image.data.length <= MAX_BASE64 && /^[A-Za-z0-9+/]+={0,2}$/.test(image.data) ? image.data : null;
  const picture: LookupPicture | null = mime && data ? { mime, base64: data } : null;
  return names.length || picture ? { found: true, names, picture, source } : NOTHING_FOUND;
}

/** The names in the order the phone offers them: the app's own language first. */
export const namesFor = (names: readonly LookupName[], lang: string): LookupName[] => [...names.filter((n) => n.lang === lang), ...names.filter((n) => n.lang !== lang)];

/** The picture that will be saved with the item, and whether it is the found one (saved with its source, for the credit). */
export type ChosenPhoto = { from: 'own'; uri: string; base64: string } | { from: 'lookup'; uri: string; base64: string };

/**
 * The photo once the lookup has answered: the found picture, unless the person already took or chose one of their
 * own (theirs stays). `current` back: nothing changes.
 */
export function photoAfterLookup(found: ItemLookup, current: ChosenPhoto | null): ChosenPhoto | null {
  if (!found.picture || current?.from === 'own') return current;
  return { from: 'lookup', uri: `data:${found.picture.mime};base64,${found.picture.base64}`, base64: found.picture.base64 };
}

/** What is sent with the picture when the item is saved: the barcode only when the picture is the found one. */
export const lookupBarcodeFor = (photo: ChosenPhoto | null, barcode: string): string | undefined =>
  (photo?.from === 'lookup' && /^\d{8,14}$/.test(barcode) ? barcode : undefined);
