import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { GetPhoneApp, PHONE_APP, PHONE_APP_READY, PhoneAppVersion, phoneAppOutdated, PhonesCard } from './Settings.tsx';
import { ROWS } from './Plans.tsx';
import { UI_TEXT } from '../i18n/ui.ts';
import { PHONE_TEXT } from '../i18n/phone.ts';
import { encodeQr, qrSvgPath } from '../industry/qr.ts';

// 1.4.2 ships the phone app (an Android APK from qasaerp.com/phone/): Settings → Office network → Phones offers the
// download and the pairing, behind the plan rules (Starter, Pro, Business); the plans page no longer marks it "soon".
const fixture = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, lang: 'ar' as 'ar' | 'en' | 'ku' }));
vi.mock('react', () => ({
  useState<T>(initial: T) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = initial;
    return [fixture.states[i], () => {}];
  },
  useEffect() {}, createContext: () => ({}), useContext: () => ({})
}));
vi.mock('../components.tsx', () => ({
  AccountCombo: 'AccountCombo', ErrorBox: 'ErrorBox', Icon: 'Icon', Modal: 'Modal', downloadCsv: () => {}, useToast: () => () => {},
  useData: () => ({ plan: null }), useBuildHas: () => true
}));
vi.mock('../i18n.ts', () => ({ isKey: () => true, useI18n: () => ({ t: (s: string) => s, lang: fixture.lang, digitsOf: String, date: String, int: String }) }));
vi.mock('../router.ts', () => ({ href: (s: string) => s }));

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...flatten(node.props.children)];
}
const status = { available: true, listening: true, port: 8789, addresses: [], devices: [], users: [{ id: 'u1', name: 'Raz' }], counts: [], signInRequired: true };
const render = (ready?: boolean) => {
  fixture.cursor = 0;
  return JSON.stringify(flatten(PhonesCard(ready === undefined ? {} : { ready })).map((n) => [n.type, n.props.children ?? '']));
};

beforeEach(() => { fixture.states = [status]; fixture.lang = 'ar'; });

const cardNodes = (ready?: boolean) => {
  fixture.cursor = 0;
  return flatten(PhonesCard(ready === undefined ? {} : { ready }));
};

it('offers the phone app and the pairing in 1.4.2, with no "soon" mark', () => {
  expect(PHONE_APP_READY).toBe(true);
  const card = render();
  for (const shown of ['ph_add', 'ph_actsAs', 'ph_help']) expect(card, shown).toContain(shown);
  for (const hidden of ['ph_soonNote', '"soon"']) expect(card, hidden).not.toContain(hidden);
  expect(cardNodes().some((n) => n.type === GetPhoneApp)).toBe(true);
});

it('offers the download and the pairing only on a plan with the phone app (Starter, Pro, Business)', () => {
  fixture.states = [{ ...status, available: false }];
  const card = render();
  expect(card).toContain('ph_needsPro');
  expect(card).not.toContain('ph_add');
  expect(cardNodes().some((n) => n.type === GetPhoneApp)).toBe(false);
});

it('still says "coming" with no pairing and no download when the flag is off', () => {
  const card = render(false);
  expect(card).toContain('ph_soonNote');
  for (const hidden of ['ph_add', 'ph_help']) expect(card, hidden).not.toContain(hidden);
  expect(cardNodes(false).some((n) => n.type === GetPhoneApp)).toBe(false);
});

it('links the download page, as text and as a QR code, with the steps and both fingerprints', () => {
  expect(PHONE_APP.url).toBe('https://qasaerp.com/phone/');
  expect(PHONE_APP.apkSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(PHONE_APP.certSha256).toMatch(/^[0-9a-f]{64}$/);
  const nodes = flatten(GetPhoneApp());
  const text = JSON.stringify(nodes.map((n) => [n.props.children ?? '']));
  for (const key of ['ph_getApp', 'ph_get1', 'ph_get2', 'ph_get3', 'ph_get4', 'ph_check', 'ph_apkSha', 'ph_certSha']) expect(text, key).toContain(key);
  expect(text).toContain(PHONE_APP.apkSha256);
  expect(text).toContain(PHONE_APP.certSha256);
  const link = nodes.find((n) => n.type === 'a');
  expect(link?.props.href).toBe(PHONE_APP.url);
  expect(link?.props.rel).toMatch(/noopener/);
  // the QR code is the download page's address, drawn by the app's own encoder
  expect(nodes.find((n) => n.type === 'path')?.props.d).toBe(qrSvgPath(encodeQr(PHONE_APP.url, 'M'), 4).path);
});

it("opens the download page in the app's language: Arabic at /phone/, English at /en/phone/, Kurdish at /ku/phone/", () => {
  expect(PHONE_APP.urls).toEqual({ ar: 'https://qasaerp.com/phone/', en: 'https://qasaerp.com/en/phone/', ku: 'https://qasaerp.com/ku/phone/' });
  for (const lang of ['ar', 'en', 'ku'] as const) {
    fixture.lang = lang;
    const nodes = flatten(GetPhoneApp());
    const url = PHONE_APP.urls[lang];
    const link = nodes.find((n) => n.type === 'a');
    expect(link?.props.href, lang).toBe(url);
    expect(link?.props.children, lang).toBe(url);
    expect(nodes.find((n) => n.type === 'path')?.props.d, lang).toBe(qrSvgPath(encodeQr(url, 'M'), 4).path);
  }
});

it('offers the phone app 1.0.2 (without ML Kit\'s own usage reports to Google, says its version), signed with the Qasa release key', () => {
  expect(PHONE_APP.version).toBe('1.0.2');
  expect(PHONE_APP.apkSha256).toBe('51386e6e007acbdcd668190ad676e1fbf7036e434f5fce4a7ea1f233fb0a6578');
  // neither 1.0.0 (built before the required PIN) nor 1.0.1 (it still had ML Kit's usage reports to Google)
  expect(PHONE_APP.apkSha256).not.toBe('6c8dc54af7a4845fe449fcec575f6364e6b6d75136cbd892ca1cd9f6c6239fc9');
  expect(PHONE_APP.apkSha256).not.toBe('636e0025a5d0e909d14c3305b225bd7ea8a61fa69d3c2cefc759502f5438194b');
  // the same key as every build before: phones update from 1.0.0 and 1.0.1 without uninstalling
  expect(PHONE_APP.certSha256).toBe('6d8fb6a65d85d9f82b026b5ef6aa00acfd956cef63d555cf6fffd3596a4b3129');
});

it('shows the app version each phone said, "1.0.1 or older" for one that says none, and a note when a newer app is out (1.4.3)', () => {
  // the version offered here is what an older app is measured against; an app that says none is 1.0.1 or older
  expect(phoneAppOutdated('1.0.1')).toBe(true);
  expect(phoneAppOutdated(null)).toBe(true);
  expect(phoneAppOutdated(PHONE_APP.version)).toBe(false);
  expect(phoneAppOutdated('1.0.10')).toBe(false);
  expect(phoneAppOutdated('1.1')).toBe(false);
  expect(phoneAppOutdated('1.0.9', '1.0.10')).toBe(true);
  expect(phoneAppOutdated('2.0.0', '1.9.9')).toBe(false);

  const phone = { id: 'd-1', name: 'Samsung', userId: 'u1', userName: 'Raz', pairedAt: '2026-11-15T10:00:00Z', lastSeen: null, online: true };
  const shown = (device: Parameters<typeof PhoneAppVersion>[0]['device']) => JSON.stringify(flatten(PhoneAppVersion({ device })).map((n) => [n.type, n.props.children ?? '']));
  const current = shown({ ...phone, appVersion: PHONE_APP.version, appBuild: 3 });
  expect(current).toContain(PHONE_APP.version);
  for (const hidden of ['ph_versionOld', 'ph_newer']) expect(current).not.toContain(hidden);
  // an app before 1.0.2 says nothing of itself: "1.0.1 or older", and the note
  const old = shown({ ...phone, appVersion: null, appBuild: null });
  for (const key of ['ph_versionOld', 'ph_newer']) expect(old).toContain(key);
  expect(shown({ ...phone, appVersion: '1.0.1', appBuild: 2 })).toContain('ph_newer');
  // an office PC that keeps no versions (an older Pro module) says nothing of them
  const unknown = shown(phone);
  for (const hidden of ['ph_versionOld', 'ph_newer']) expect(unknown).not.toContain(hidden);
  // never a refusal: only a note
  for (const text of PHONE_TEXT.ph_newer) expect(text).toContain('qasaerp.com/phone');
  for (const text of PHONE_TEXT.ph_versionOld) expect(text).toContain('1.0.1');

  // the card's list of phones has the column
  fixture.states = [{ ...status, devices: [{ ...phone, appVersion: null, appBuild: null }] }];
  const card = cardNodes();
  expect(JSON.stringify(card.map((n) => [n.props.children ?? '']))).toContain('ph_appVersion');
  expect(card.some((n) => n.type === PhoneAppVersion)).toBe(true);
});

it('says how to install the APK in each language, and no longer sends people to Google Play', () => {
  for (const text of PHONE_TEXT.ph_getApp) expect(text).toContain('Android');
  expect(PHONE_TEXT.ph_get2[1]).toMatch(/Install unknown apps/);
  for (const text of PHONE_TEXT.ph_get2) expect(text).toMatch(/Android/);
  for (const text of PHONE_TEXT.ph_step1) {
    expect(text).toContain('qasaerp.com/phone');
    expect(text).not.toMatch(/Google Play/);
  }
  // step 2 names the phone app's own button (apps/mobile/src/i18n.ts, "pair")
  expect(PHONE_TEXT.ph_step2[1]).toContain('"Scan the pairing code"');
  expect(PHONE_TEXT.ph_get4[1]).toContain('"Add a phone"');
});

it('lists the phone app on the plans page without "soon", and the tour still does not sell it', () => {
  for (const key of ['tour_plan_pro', 'tour_proAdds'] as const) {
    const [ar, en, ku] = UI_TEXT[key];
    expect(en, key).not.toMatch(/phone/i);
    expect(ar, key).not.toMatch(/الهاتف|الموبايل/);
    expect(ku, key).not.toMatch(/مۆبایل/);
  }
  expect(ROWS.find((r) => r.label === 'f_phoneApp')?.soon).toBeFalsy();
});

it('names the plans the phone app is part of as the plan table has them: Starter, Pro and Business', () => {
  for (const key of ['ph_needsPro', 'err_plan_limit_phoneApp'] as const) {
    for (const text of PHONE_TEXT[key]) expect(text, key).toMatch(/Starter.*Pro.*Business/);
  }
});

it('says in the tour, as on the plans page, that the online edition is coming soon', () => {
  expect(ROWS.find((r) => r.label === 'f_online')?.soon).toBe(true);
  const [ar, en, ku] = UI_TEXT.tour_plan_business;
  expect(en).toMatch(/online edition is coming soon/);
  expect(ar).toMatch(/النسخة الإلكترونية قادمة قريباً/);
  expect(ku).toMatch(/وەشانی ئۆنلاین بەم زووانە دێت/);
  // what ships in 1.0 is still said plainly
  for (const [text, branches] of [[ar, 'الفروع'], [en, 'branches'], [ku, 'لقەکان']] as const) expect(text).toContain(branches);
  // so does the line the Pro tour adds about Business
  const [arAdds, enAdds, kuAdds] = UI_TEXT.tour_businessAdds;
  // whole sentences: the online edition "is coming soon" (with its verb), as on the plans page
  expect(enAdds).toBe('Business adds branches and real estate; the online edition is coming soon.');
  expect(arAdds).toMatch(/؛ والنسخة الإلكترونية قادمة قريباً\.$/);
  expect(kuAdds).toMatch(/؛ وەشانی ئۆنلاین بەم زووانە دێت\.$/);
  for (const [text, branches] of [[arAdds, 'الفروع'], [enAdds, 'branches'], [kuAdds, 'لقەکان']] as const) expect(text).toContain(branches);
});
