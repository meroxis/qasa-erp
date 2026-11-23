import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Lang } from '@qasa/core';
import type { Permission } from '../api.ts';
import { DataContext } from '../components.tsx';
import { I18nContext, makeI18n, type Key } from '../i18n.ts';
import { PRODUCT_LOOKUP_TEXT } from '../i18n/product-lookup.ts';
import { may } from '../may.ts';
import { NewItemPicture, type PreparedPicture } from './ItemImage.tsx';
import {
  BulkStatusView, LookupAsk, LookupResultView, LookupSettingView, lookupShows, PictureCredit, pictureAfterLookup, ProductLookupPanel, ProductLookupSettingCard, FindPicturesButton
} from './ProductLookup.tsx';
import type { LookupSettings, ProductLookupResult } from './product-lookup-api.ts';

vi.mock('../api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api.ts')>()), request: vi.fn(() => new Promise(() => {})) }));

// 2.1: a new item's picture and name looked up by its barcode. The form's states, in Arabic, English and Kurdish.

const LANGS: Lang[] = ['ar', 'en', 'ku'];
const i18nOf = (lang: Lang) => makeI18n(lang, 'western', () => {}, () => {});
const textOf = (lang: Lang, key: Key, vars?: Record<string, string | number>) => i18nOf(lang).t(key, vars);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const wrap = (node: ReactNode, lang: Lang, permissions: Permission[] = ['stock']) => renderToStaticMarkup(
  <I18nContext.Provider value={i18nOf(lang)}>
    <DataContext.Provider value={{ settings: null, permissions } as never}>{node}</DataContext.Provider>
  </I18nContext.Provider>
);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const COKE = '5449000000996';
const ON: LookupSettings = { enabled: true, asked: true, available: true };
const NEVER_ASKED: LookupSettings = { enabled: false, asked: false, available: true };
const FOUND: ProductLookupResult = {
  found: true, source: 'openfoodfacts', brand: 'Coca-Cola', quantity: '330 ml', licence: 'CC BY-SA 3.0', pageUrl: `https://world.openfoodfacts.org/product/${COKE}`,
  names: [{ lang: 'ar', text: 'كوكاكولا' }, { lang: 'en', text: 'Coca-Cola' }, { lang: 'en', text: 'Coca-Cola 330 ml' }],
  image: { mime: 'image/jpeg', data: '/9j/4AAQ' }
};
const OWN: PreparedPicture = { data: 'T1dO', mime: 'image/webp' };
const FROM_LOOKUP: PreparedPicture = { data: '/9j/4AAQ', mime: 'image/jpeg', lookupBarcode: COKE, source: 'openfoodfacts' };

describe('what the form shows under the barcode', () => {
  const both = { look: true, setUp: true };
  const adds = { look: true, setUp: false };

  it('nothing while the setting is not known, where there is none (an older office, the demo), or for a barcode that is the shop’s own', () => {
    expect(lookupShows(null, COKE, both, null)).toBe('nothing');
    expect(lookupShows({ enabled: false, asked: false, available: false }, COKE, both, null)).toBe('nothing');
    expect(lookupShows(ON, null, both, null)).toBe('nothing');
    expect(lookupShows(NEVER_ASKED, null, both, null)).toBe('nothing');
  });

  it('asks an admin once; nobody else, and never again after an answer', () => {
    expect(lookupShows(NEVER_ASKED, COKE, both, null)).toBe('ask');
    expect(lookupShows(NEVER_ASKED, COKE, adds, null)).toBe('nothing');
    expect(lookupShows({ enabled: false, asked: true, available: true }, COKE, both, null)).toBe('nothing');
  });

  it('with the setting on: looking, then what was found (for the barcode on the form now)', () => {
    expect(lookupShows(ON, COKE, adds, { code: COKE, state: 'looking' })).toBe('looking');
    expect(lookupShows(ON, COKE, adds, { code: COKE, state: 'done', result: FOUND })).toBe('result');
    expect(lookupShows(ON, COKE, adds, { code: COKE, state: 'done', result: { found: false, reason: 'not_found' } })).toBe('result');
    expect(lookupShows(ON, COKE, adds, { code: COKE, state: 'done', result: { found: false, reason: 'unreachable' } })).toBe('result');
    // an answer for another barcode, the shop's own code, the setting switched off meanwhile, someone who may not add items
    expect(lookupShows(ON, COKE, adds, { code: '96385074', state: 'done', result: FOUND })).toBe('nothing');
    expect(lookupShows(ON, COKE, adds, { code: COKE, state: 'done', result: { found: false, reason: 'own' } })).toBe('nothing');
    expect(lookupShows(ON, COKE, adds, { code: COKE, state: 'done', result: { found: false, reason: 'off' } })).toBe('nothing');
    expect(lookupShows(ON, COKE, { look: false, setUp: false }, { code: COKE, state: 'done', result: FOUND })).toBe('nothing');
    expect(lookupShows(ON, COKE, adds, null)).toBe('nothing');
  });

  it('who may: looking up needs the stock permission, the setting and the search over every item an admin', () => {
    expect(may(['stock'], 'productLookup')).toBe(true);
    expect(may(['sales'], 'productLookup')).toBe(false);
    for (const action of ['productLookupSetup', 'productLookupAll'] as const) {
      expect(may(['admin'], action)).toBe(true);
      expect(may(['stock'], action)).toBe(false);
    }
  });
});

describe('the form’s picture after a lookup', () => {
  it('the found picture is used, with its barcode and source', () => {
    expect(pictureAfterLookup(FOUND, null, COKE)).toEqual(FROM_LOOKUP);
    // one found for the barcode before is replaced
    expect(pictureAfterLookup(FOUND, { ...FROM_LOOKUP, lookupBarcode: '96385074' }, COKE)).toEqual(FROM_LOOKUP);
  });

  it('a picture the person chose themselves stays; nothing found changes nothing', () => {
    expect(pictureAfterLookup(FOUND, OWN, COKE)).toBeUndefined();
    expect(pictureAfterLookup({ ...FOUND, image: null }, null, COKE)).toBeUndefined();
    expect(pictureAfterLookup({ found: false, reason: 'not_found' }, null, COKE)).toBeUndefined();
    expect(pictureAfterLookup({ found: false, reason: 'unreachable' }, OWN, COKE)).toBeUndefined();
  });
});

describe('the states, in three languages', () => {
  it('every text is there in Arabic, English and Kurdish, with the same placeholders', () => {
    for (const [key, texts] of Object.entries(PRODUCT_LOOKUP_TEXT)) {
      expect(texts, key).toHaveLength(3);
      const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      for (const text of texts) {
        expect(text.trim().length, key).toBeGreaterThan(0);
        expect(holes(text), key).toBe(holes(texts[1]!));
      }
      // Kurdish is Sorani in Arabic letters, and not the Arabic text again
      expect(texts[2], key).not.toBe(texts[0]);
      expect(texts[2], key).toMatch(/[؀-ۿ]|^CC/);
    }
  });

  it.each(LANGS)('%s: the question says what is sent and to whom, and offers both answers', (lang) => {
    const html = wrap(<LookupAsk busy={false} error={null} onAnswer={() => {}} />, lang);
    for (const key of ['plk_askTitle', 'plk_explain', 'plk_changeLater', 'plk_turnOn', 'plk_notNow'] as const) expect(html, key).toContain(esc(textOf(lang, key)));
    expect(html).toContain('Open Food Facts');
  });

  it.each(LANGS)('%s: a picture found is shown ticked with its source, and the names as buttons', (lang) => {
    const html = wrap(<LookupResultView code={COKE} result={FOUND} picture={FROM_LOOKUP} onPicture={() => {}} onName={() => {}} />, lang);
    expect(html).toContain('src="data:image/jpeg;base64,/9j/4AAQ"');
    expect(html).toMatch(/<input type="checkbox"[^>]*checked=""/);
    expect(html).toContain(esc(textOf(lang, 'plk_useThis')));
    expect(html).toContain(esc(textOf(lang, 'plk_from', { s: 'Open Food Facts' })));
    expect(html).toContain('CC BY-SA');
    expect(html).toContain(esc(textOf(lang, 'plk_names')));
    for (const name of ['كوكاكولا', 'Coca-Cola', 'Coca-Cola 330 ml']) expect(html).toContain(`>${name}</button>`);
    // names are buttons to press: nothing is written into the form by itself
    expect((html.match(/<button type="button"/g) ?? []).length).toBe(3);
  });

  it.each(LANGS)('%s: with the person’s own picture the found one is offered unticked', (lang) => {
    const html = wrap(<LookupResultView code={COKE} result={FOUND} picture={OWN} onPicture={() => {}} onName={() => {}} />, lang);
    expect(html).toContain(esc(textOf(lang, 'plk_useThis')));
    expect(html).not.toMatch(/<input type="checkbox"[^>]*checked=""/);
  });

  it.each(LANGS)('%s: nothing found, or names without a picture: one quiet line, and none once a picture is chosen', (lang) => {
    for (const reason of ['not_found', 'unreachable', 'busy'] as const) {
      const html = wrap(<LookupResultView code={COKE} result={{ found: false, reason }} picture={null} onPicture={() => {}} onName={() => {}} />, lang);
      expect(html, reason).toContain(esc(textOf(lang, 'plk_none')));
      expect(html, reason).not.toContain('<img');
      expect(html, reason).not.toContain('alert');
    }
    const namesOnly = wrap(<LookupResultView code={COKE} result={{ ...FOUND, image: null }} picture={null} onPicture={() => {}} onName={() => {}} />, lang);
    expect(namesOnly).toContain(esc(textOf(lang, 'plk_noneNames')));
    expect(namesOnly).toContain('>Coca-Cola</button>');
    const chosen = wrap(<LookupResultView code={COKE} result={{ found: false, reason: 'not_found' }} picture={OWN} onPicture={() => {}} onName={() => {}} />, lang);
    expect(chosen).not.toContain(esc(textOf(lang, 'plk_none')));
  });

  it('a name from outside is shown as text, never as markup', () => {
    const html = wrap(<LookupResultView code={COKE} result={{ ...FOUND, names: [{ lang: 'en', text: '<img src=x onerror=alert(1)>' }] }} picture={null} onPicture={() => {}} onName={() => {}} />, 'en');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it.each(LANGS)('%s: the setting in Settings: off by default, with what is sent in plain words', (lang) => {
    const off = wrap(<LookupSettingView known={{ enabled: false, asked: false, available: true }} busy={false} error={null} onChange={() => {}} />, lang, ['admin']);
    for (const key of ['plk_title', 'plk_setting', 'plk_explain', 'plk_offNote'] as const) expect(off, key).toContain(esc(textOf(lang, key)));
    expect(off).not.toMatch(/checked=""/);
    expect(wrap(<LookupSettingView known={ON} busy={false} error={null} onChange={() => {}} />, lang, ['admin'])).toMatch(/checked=""/);
    const demo = wrap(<LookupSettingView known={{ enabled: false, asked: false, available: false }} busy={false} error={null} onChange={() => {}} />, lang, ['admin']);
    expect(demo).toContain(esc(textOf(lang, 'plk_unavailable')));
    expect(demo).toMatch(/<input type="checkbox" disabled=""/);
  });

  it.each(LANGS)('%s: the search over every item says how far it is and how it ended', (lang) => {
    const running = wrap(<BulkStatusView status={{ running: true, total: 40, done: 12, added: 7, ended: null, startedAt: 'x' }} />, lang);
    expect(running).toContain('<progress value="12" max="40"');
    expect(running).toContain(esc(textOf(lang, 'plk_progress', { done: 12, total: 40, added: 7 })));
    expect(running).toContain(esc(textOf(lang, 'plk_running')));
    const ends = { done: 'plk_endDone', stopped: 'plk_endStopped', off: 'plk_endOff', unreachable: 'plk_endUnreachable' } as const;
    for (const [ended, key] of Object.entries(ends) as [keyof typeof ends, Key][]) {
      expect(wrap(<BulkStatusView status={{ running: false, total: 40, done: 12, added: 7, ended, startedAt: 'x' }} />, lang), ended).toContain(esc(textOf(lang, key)));
    }
    expect(wrap(<BulkStatusView status={{ running: false, total: 0, done: 0, added: 0, ended: 'done', startedAt: 'x' }} />, lang)).toContain(esc(textOf(lang, 'plk_nothingToFind')));
    expect(wrap(<BulkStatusView status={{ running: false, total: 0, done: 0, added: 0, ended: null, startedAt: null }} />, lang)).toBe('');
  });

  it.each(LANGS)('%s: the credit names the databases the pictures came from, and is absent for the shop’s own', (lang) => {
    expect(wrap(<PictureCredit sources={['openfoodfacts', 'openbeautyfacts']} />, lang)).toContain(esc(textOf(lang, 'plk_credit', { s: 'Open Food Facts, Open Beauty Facts' })));
    expect(wrap(<PictureCredit sources={[]} />, lang)).toBe('');
    expect(textOf(lang, 'plk_credit', { s: 'Open Food Facts' })).toContain('CC BY-SA');
  });
});

describe('before anything is known the form is as it was', () => {
  it('the panel, the setting card and the button draw nothing until the server has answered (the form never waits)', () => {
    expect(wrap(<ProductLookupPanel barcode={COKE} picture={null} onPicture={() => {}} onName={() => {}} />, 'en', ['admin', 'stock'])).toBe('');
    expect(wrap(<ProductLookupSettingCard />, 'en', ['admin'])).toBe('');
    expect(wrap(<FindPicturesButton />, 'en', ['admin'])).toBe('');
  });

  it('the manual path is still there: choose a picture, change it, remove it (and the camera on a phone or tablet)', () => {
    const empty = wrap(<NewItemPicture value={null} onChange={() => {}} />, 'en');
    expect(empty).toContain(textOf('en', 'md_addPicture'));
    expect(empty).toContain('type="file"');
    const chosen = wrap(<NewItemPicture value={OWN} onChange={() => {}} />, 'en');
    expect(chosen).toContain(textOf('en', 'md_changePicture'));
    expect(chosen).toContain(`aria-label="${textOf('en', 'md_removePicture')}"`);
    const source = read('./ItemImage.tsx');
    expect(source).toContain('capture="environment"');
    expect(source).toContain("t('plk_takePhoto')");
    expect(source).toContain("t('plk_chooseFile')");
  });
});

describe('where it is wired in', () => {
  it('the item form, the quick form (invoices and the till), Settings, the items list, the price checker and About', () => {
    const itemForm = read('../pages/Items.tsx');
    expect(itemForm).toContain('{!item && <ProductLookupPanel barcode={barcode} picture={picture} onPicture={setPicture}');
    expect(itemForm).toContain('saveItemPicture(saved.id, picture.data, picture.lookupBarcode)');
    expect(itemForm).toContain('<FindPicturesButton />');
    const quick = read('./QuickItemForm.tsx');
    expect(quick).toContain('<ProductLookupPanel barcode={fields.barcode} picture={picture} onPicture={setPicture}');
    expect(quick).toContain('<NewItemPicture value={picture} onChange={setPicture} size={64} />');
    expect(quick).toContain('saveItemPicture(item.id, picture.data, picture.lookupBarcode)');
    expect(read('../pages/Settings.tsx')).toContain('<ProductLookupSettingCard />');
    expect(read('../pages/PriceCheckerScreen.tsx')).toContain("t('plk_credit', { s: creditNames(credited) })");
    expect(read('./PrintDocument.tsx')).toContain("L.t('plk_credit', { s: creditNames(pictureSources) })");
    expect(read('./LegalPanel.tsx')).toContain("t('lg_openData')");
  });

  it('the page itself asks only the app’s own server: no address of the databases is in the web app', () => {
    for (const file of ['./ProductLookup.tsx', './product-lookup-api.ts', './ItemImage.tsx']) {
      expect(read(file), file).not.toMatch(/https?:\/\/[a-z.]*open[a-z]*facts\.org/);
    }
    expect(read('./product-lookup-api.ts')).toContain("'/api/items/lookup'");
  });
});
