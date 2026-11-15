import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ApiError } from './api.ts';
import { errorMessages } from './components.tsx';
import { isKey, makeI18n, type Key } from './i18n.ts';

// Qasa Relay hardening (1.4.2): the new refusals the office's link can show, the office server's key that is never kept
// in the clear, and a new office certificate, each in Arabic, English and Kurdish.
const LANGS = ['ar', 'en', 'ku'] as const;
const all = (key: Key) => LANGS.map((l) => makeI18n(l, 'western', () => {}, () => {}).t(key));
const en = makeI18n('en', 'western', () => {}, () => {});
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

it('has words in three languages for each new relay refusal, the unprotected server key and the new certificate', () => {
  const keys = [
    'rl_e_office_replaced', 'rl_e_too_many_dials', 'rl_e_relay_busy', 'err_network_secret_unprotected',
    'netNewCert', 'netNewCertHelp', 'netNewCertConfirm', 'netNewCertDone', 'a_network_certificate_renewed'
  ];
  expect(keys.filter((k) => !isKey(k))).toEqual([]);
  for (const k of keys) {
    const texts = all(k as Key);
    expect(new Set(texts).size, k).toBe(3);
    expect(texts.every((t) => t.trim() !== ''), k).toBe(true);
  }
  // the office network's switch says why it stays off when Windows can't protect the server key
  expect(errorMessages(new ApiError(409, 'network_secret_unprotected', null), en)).toEqual([en.t('err_network_secret_unprotected')]);
});

it('offers a new office certificate on the office network\'s card, asking first, for admins (the server checks again)', () => {
  const settings = src('./pages/Settings.tsx');
  expect(settings).toContain("request<NetworkStatus>('POST', '/api/network/certificate', {})");
  expect(settings).toMatch(/window\.confirm\(t\('netNewCertConfirm'\)\)/);
  // a phone's QR code comes off the screen as soon as a phone pairs with it
  expect(settings).toMatch(/setPairing\(null\);\s*setBefore\(null\);\s*toast\(t\('ph_paired'\)\)/);
});
