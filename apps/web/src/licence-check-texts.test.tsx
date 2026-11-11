import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { isKey, makeI18n, type Key } from './i18n.ts';
import { proHeldKey } from './pages/Plans.tsx';

// 1.2: the words for the licence checks of the official app: a relay that asks for the office's activation token, and
// the Pro module's own check of the licence (its pages pause, the data stays).
const LANGS = ['ar', 'en', 'ku'] as const;
const all = (key: Key) => LANGS.map((l) => makeI18n(l, 'western', () => {}, () => {}).t(key));
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ARABIC_SCRIPT = /[؀-ۿ]/;

it('says in Arabic, English and Kurdish that the office\'s licence needs to check in with the portal when the relay asks', () => {
  for (const code of ['activation_required', 'activation_stale']) {
    const key = `rl_e_${code}`;
    expect(isKey(key), key).toBe(true);
    const [ar, en, ku] = all(key as Key);
    expect(new Set([ar, en, ku]).size, key).toBe(3);
    expect(en).toMatch(/licence needs to check in with the portal/);
    // right-to-left texts in their own script, the product names kept as they are
    expect(ar).toMatch(ARABIC_SCRIPT);
    expect(ku).toMatch(ARABIC_SCRIPT);
    expect(ar).toContain('Qasa Relay');
    expect(ku).toContain('Qasa Relay');
  }
  // Settings → Office network shows the relay's reason by its code
  expect(src('./pages/Settings.tsx')).toContain("const errorKey = relay?.lastError ? ('rl_e_' + relay.lastError) : null;");
});

it('tells why Pro pages are paused on this PC, with the way back, and only when the Pro module says so', () => {
  expect(proHeldKey(null)).toBeNull();
  expect(proHeldKey({ heldBack: false, reason: null })).toBeNull();
  expect(proHeldKey({ heldBack: true, reason: 'integrity' })).toBe('ac_proHeldFiles');
  for (const reason of ['activation', 'clock', 'licence', 'trial', 'machine', 'addon', 'error', null]) {
    expect(proHeldKey({ heldBack: true, reason })).toBe('ac_proHeld');
  }
  for (const key of ['ac_proHeld', 'ac_proHeldFiles'] as const) {
    const [ar, en, ku] = all(key);
    expect(new Set([ar, en, ku]).size, key).toBe(3);
    expect(ar).toMatch(ARABIC_SCRIPT);
    expect(ku).toMatch(ARABIC_SCRIPT);
    // never a threat to the data
    expect(en).toMatch(/All your data is safe\./);
  }
  expect(all('ac_proHeld')[1]).toMatch(/check in with the portal.*Check now/);
  expect(all('ac_proHeldFiles')[1]).toMatch(/Microsoft Store or qasaerp\.com/);
  // the Plan page asks the Pro module (a build without it answers 404, and nothing is shown)
  expect(src('./pages/Plans.tsx')).toContain("request<ProLicenceCheck>('GET', '/api/pro/licence-check')");
});
