import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coreApi } from '../src/api';
import { LANGS, translate } from '../src/i18n';
import { lookupBarcodeFor, namesFor, NOTHING_FOUND, photoAfterLookup, readLookup, SOURCE_NAMES, type ChosenPhoto } from '../src/item-lookup';
import { OfficeLink } from '../src/link';
import { generateKeyPair } from '../src/protocol';
import { featuresOf, needsNewerOffice, OFFER_OF, type Me } from '../src/roles';
import { fakeOffice } from './fake-office';

// Phone app 1.2: a new item's picture and names by its barcode, through an office (Qasa ERP 2.1 on) that offers it.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COKE = '5449000000996';
const ANSWER = {
  found: true, source: 'openfoodfacts', brand: 'Coca-Cola', quantity: '330 ml', licence: 'CC BY-SA 3.0', pageUrl: `https://world.openfoodfacts.org/product/${COKE}`,
  names: [{ lang: 'ar', text: 'كوكاكولا' }, { lang: 'en', text: 'Coca-Cola' }, { lang: 'en', text: 'Coca-Cola 330 ml' }],
  image: { mime: 'image/jpeg', data: '/9j/4AAQSkZJRg==' }
};
const me = (roles: string[], permissions: string[], offers?: string[]): Me =>
  ({ signInRequired: true, user: { id: 'u', name: 'Las', roles, permissions }, ...(offers ? { phoneLink: { v: 2, offers } } : {}) });

describe('who sees it', () => {
  it('only with an office that offers it, and only whoever may add items', () => {
    expect(OFFER_OF.itemLookup).toBe('itemLookup');
    expect(featuresOf(me(['storekeeper'], ['stock'], ['itemLookup'])).has('itemLookup')).toBe(true);
    expect(featuresOf(me(['admin'], ['admin'], ['itemLookup'])).has('itemLookup')).toBe(true);
    expect(featuresOf({ signInRequired: false, user: null, phoneLink: { v: 2, offers: ['itemLookup'] } }).has('itemLookup')).toBe(true);
    expect(featuresOf(me(['sales'], ['sales'], ['itemLookup'])).has('itemLookup')).toBe(false);
  });

  it('an office without it (Qasa ERP before 2.1, or phone link 1.1): hidden, the add-item screen as it always was', () => {
    for (const offers of [undefined, [], ['expense', 'share', 'transfer', 'receive']]) {
      const keeper = featuresOf(me(['storekeeper'], ['stock'], offers));
      expect(keeper.has('itemLookup')).toBe(false);
      expect(keeper.has('newItem')).toBe(true);
    }
    // the owner is told the office PC needs an update for it, by name
    expect(needsNewerOffice(me(['admin'], ['admin'], ['approvals', 'rate', 'dayClose', 'expense', 'share', 'transfer', 'receive', 'countAdd']))).toEqual(['itemLookup']);
    for (const lang of LANGS) expect(translate(lang, 'featItemLookup').length).toBeGreaterThan(5);
  });
});

describe('reading what the office answered', () => {
  it('names (at most four, each once) and the picture, with the database it came from', () => {
    expect(readLookup(ANSWER)).toEqual({
      found: true, source: 'openfoodfacts',
      names: [{ lang: 'ar', text: 'كوكاكولا' }, { lang: 'en', text: 'Coca-Cola' }, { lang: 'en', text: 'Coca-Cola 330 ml' }],
      picture: { mime: 'image/jpeg', base64: '/9j/4AAQSkZJRg==' }
    });
    const many = readLookup({ ...ANSWER, names: [...ANSWER.names, { lang: 'en', text: ' Coca-Cola ' }, { lang: 'ku', text: 'کۆکاکۆلا' }, { lang: 'en', text: 'Sixth' }] });
    expect(many.names.map((n) => n.text)).toEqual(['كوكاكولا', 'Coca-Cola', 'Coca-Cola 330 ml', 'کۆکاکۆلا']);
    expect(namesFor(many.names, 'ku').map((n) => n.lang)).toEqual(['ku', 'ar', 'en', 'en']);
    expect(namesFor(many.names, 'en')[0]).toEqual({ lang: 'en', text: 'Coca-Cola' });
  });

  it('nothing found, the setting off, a refusal or an answer that is something else: nothing', () => {
    for (const body of [{ found: false, reason: 'off' }, { found: false, reason: 'not_found' }, { error: 'forbidden' }, null, 'x', [], { found: true }, { found: true, source: 'someone', names: ANSWER.names }]) {
      expect(readLookup(body)).toBe(NOTHING_FOUND);
    }
  });

  it('what is not what it should be is dropped: another kind of picture, bytes that are no base64, a name that is no text', () => {
    expect(readLookup({ ...ANSWER, image: { mime: 'image/svg+xml', data: 'PHN2Zz4=' } }).picture).toBeNull();
    expect(readLookup({ ...ANSWER, image: { mime: 'image/jpeg', data: 'data:text/html,<script>' } }).picture).toBeNull();
    expect(readLookup({ ...ANSWER, image: { mime: 'image/jpeg', data: 'A'.repeat(600_000) } }).picture).toBeNull();
    expect(readLookup({ ...ANSWER, image: 'https://evil.example/x.jpg' }).picture).toBeNull();
    expect(readLookup({ ...ANSWER, names: [{ lang: 'fr', text: 'Coca' }, { lang: 'en', text: 42 }, { lang: 'en', text: '  ' }, 'x'] }).names).toEqual([]);
    expect(readLookup({ ...ANSWER, names: [{ lang: 'en', text: 'x'.repeat(500) }] }).names[0]!.text).toHaveLength(200);
    // a name alone, or a picture alone, is still something found
    expect(readLookup({ ...ANSWER, image: null }).found).toBe(true);
    expect(readLookup({ ...ANSWER, names: [] }).found).toBe(true);
    expect(readLookup({ ...ANSWER, names: [], image: null })).toBe(NOTHING_FOUND);
  });
});

describe('the picture that is saved', () => {
  const found = readLookup(ANSWER);
  const own: ChosenPhoto = { from: 'own', uri: 'file:///photo.jpg', base64: 'T1dO' };

  it('the found picture is used, unless the person took or chose their own', () => {
    expect(photoAfterLookup(found, null)).toEqual({ from: 'lookup', uri: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', base64: '/9j/4AAQSkZJRg==' });
    expect(photoAfterLookup(found, own)).toBe(own);
    expect(photoAfterLookup({ ...found, picture: null }, null)).toBeNull();
    expect(photoAfterLookup(NOTHING_FOUND, own)).toBe(own);
  });

  it('goes with its barcode only when it is the found one (the office then keeps where it came from)', () => {
    expect(lookupBarcodeFor(photoAfterLookup(found, null), COKE)).toBe(COKE);
    expect(lookupBarcodeFor(own, COKE)).toBeUndefined();
    expect(lookupBarcodeFor(null, COKE)).toBeUndefined();
    expect(lookupBarcodeFor(photoAfterLookup(found, null), 'ABC-1')).toBeUndefined();
  });

  it('the credit names the database, in every language', () => {
    expect(SOURCE_NAMES.openfoodfacts).toBe('Open Food Facts');
    for (const lang of LANGS) {
      const line = translate(lang, 'pictureFrom', { s: SOURCE_NAMES.openbeautyfacts });
      expect(line).toContain('Open Beauty Facts');
      expect(line).toContain('CC BY-SA');
      for (const key of ['chooseFromGallery', 'removePhoto', 'lookingPicture', 'noPictureFound', 'useThisPicture', 'suggestedNames'] as const) expect(translate(lang, key).length, key).toBeGreaterThan(3);
    }
  });
});

describe('what the phone sends', () => {
  const linkTo = (o: ReturnType<typeof fakeOffice>) => new OfficeLink({ office: o.office, phone: generateKeyPair(), name: 'Phone', socket: o.socket, reconnect: false });

  it('asks its office only, with the barcode and nothing else; no answer or a refusal is “nothing found”, never an error', async () => {
    const o = fakeOffice({ reply: (m) => (m.p === '/api/items/lookup' ? { s: 200, b: ANSWER } : { s: 200, b: {} }) });
    const link = linkTo(o);
    try {
      const api = coreApi(link);
      expect((await api.lookupItem(COKE)).picture).toEqual({ mime: 'image/jpeg', base64: '/9j/4AAQSkZJRg==' });
      const sent = o.seen.find((m) => m.p === '/api/items/lookup')!;
      expect(sent).toMatchObject({ m: 'POST', p: '/api/items/lookup', b: { barcode: COKE } });
      expect(Object.keys(sent.b as object)).toEqual(['barcode']);
    } finally {
      link.close();
    }
    const refusing = fakeOffice({ reply: () => ({ s: 403, b: { error: 'forbidden' } }) });
    const second = linkTo(refusing);
    try {
      expect(await coreApi(second).lookupItem(COKE)).toBe(NOTHING_FOUND);
    } finally {
      second.close();
    }
  });

  it('a picture is saved as before, and the found one with its barcode beside it', async () => {
    const o = fakeOffice({ reply: () => ({ s: 200, b: {} }) });
    const link = linkTo(o);
    try {
      const api = coreApi(link);
      await api.setImage('i-1', 'T1dO');
      await api.setImage('i-1', '/9j/4AAQ', COKE);
      const puts = o.seen.filter((m) => m.m === 'PUT');
      expect(puts.map((m) => m.b)).toEqual([{ data: 'T1dO' }, { data: '/9j/4AAQ', lookupBarcode: COKE }]);
    } finally {
      link.close();
    }
  });
});

describe('the add-item screen', () => {
  const screen = readFileSync(join(root, 'src/screens/items.tsx'), 'utf8');

  it('looks up only where the office offers it, never waits for it, and fills a name only when its chip is pressed', () => {
    expect(screen).toContain("const looksUp = can('itemLookup');");
    expect(screen).toContain('if (!looksUp) return;');
    expect(screen).toContain('setPhoto((current) => photoAfterLookup(found, current));');
    expect(screen).toContain('onPress={() => setName(n.text)}');
    expect(screen).not.toMatch(/setName\(found/);
    // saving does not depend on the lookup
    expect(screen).toContain("disabled={!name.trim() || minor === null}");
  });

  it('keeps the manual path: a photo, a picture from the gallery (the system picker, no new permission), and removing it', () => {
    expect(screen).toContain("label={photo?.from === 'own' ? t('retake') : t('takePhoto')}");
    expect(screen).toContain("ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 })");
    expect(screen).toContain("label={t('removePhoto')} onPress={() => setPhoto(null)}");
    expect(screen).toContain("t('pictureFrom', { s: SOURCE_NAMES[found.source] })");
    const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as { expo: { plugins: unknown[]; android: { permissions: string[]; blockedPermissions: string[] } } };
    expect(app.expo.plugins).toContainEqual(['expo-image-picker', expect.objectContaining({ microphonePermission: false })]);
    expect(app.expo.android.permissions.sort()).toEqual(['android.permission.CAMERA', 'android.permission.USE_BIOMETRIC', 'android.permission.VIBRATE']);
    for (const p of ['android.permission.RECORD_AUDIO', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE']) expect(app.expo.android.blockedPermissions).toContain(p);
  });

  it('the phone never talks to the databases itself', () => {
    for (const file of ['src/item-lookup.ts', 'src/api.ts', 'src/screens/items.tsx']) expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(/https?:\/\/[a-z.]*open[a-z]*facts\.org/);
  });
});
