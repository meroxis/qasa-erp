import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PLAN_IDS, PLAN_PRICE_IQD, PLANS, type Feature } from '@qasa/core';
import { isKey, makeI18n, type Key } from '../i18n.ts';
import { ROWS } from './Plans.tsx';

// The Starter plan on the Plan page and in Settings: four plans, Starter's own column, and what it leaves to Pro.
const LANGS = ['ar', 'en', 'ku'] as const;
const i18n = (lang: (typeof LANGS)[number]) => makeI18n(lang, 'western', () => {}, () => {});
const all = (key: Key) => LANGS.map((l) => i18n(l).t(key));
const row = (label: string) => ROWS.find((r) => r.label === label)!;
const STARTER = PLAN_IDS.indexOf('starter');

it('shows four plans, each with a name in every language; Starter is written like Pro and Business', () => {
  expect(PLAN_IDS).toEqual(['free', 'starter', 'pro', 'business']);
  for (const id of PLAN_IDS) expect(isKey(`plan_${id}`), id).toBe(true);
  expect(all('plan_starter')).toEqual(['Starter', 'Starter', 'Starter']);
  expect(all('plan_pro')).toEqual(['Pro', 'Pro', 'Pro']);
  for (const r of ROWS) expect(r.cells, r.label).toHaveLength(PLAN_IDS.length);
});

it('prices a year of Starter at 165,000 IQD, next to Pro and Business', () => {
  expect(row('f_price').cells).toEqual(['plan_free', { price: 165_000 }, { price: 350_000 }, { price: 1_000_000 }]);
  expect(PLAN_PRICE_IQD.starter).toBe(165_000);
  expect(i18n('en').t('v_priceYear', { n: i18n('en').int(PLAN_PRICE_IQD.starter) })).toBe('165,000 IQD');
  expect(i18n('ar').t('v_priceYear', { n: i18n('ar').int(PLAN_PRICE_IQD.starter) })).toBe('165,000 د.ع');
  expect(all('f_price')).toEqual(['السعر في السنة', 'Price per year', 'نرخی ساڵێک']);
});

it('gives Starter 2 users, 1 company and the office network, and leaves Qasa Relay and the cloud backup to Pro', () => {
  expect(row('f_users').cells).toEqual([{ limit: 1 }, { limit: 2 }, { limit: 5 }, { limit: null }]);
  expect(row('f_companies').cells).toEqual([{ limit: 1 }, { limit: 1 }, { limit: 3 }, { limit: null }]);
  expect(row('f_warehouses').cells).toEqual([{ limit: 1 }, { limit: null }, { limit: null }, { limit: null }]);
  expect(row('f_network').cells).toEqual([false, true, true, true]);
  expect(row('f_relay').cells).toEqual([false, false, true, true]);
  expect(row('f_cloudBackup').cells).toEqual([false, false, true, true]);
  // the automatic daily copies to a folder stay
  expect(row('f_backup').cells).toEqual([false, true, true, true]);
  for (const label of ['f_dbServer', 'f_realEstate', 'f_branches', 'f_online']) expect(row(label).cells[STARTER], label).toBe(false);
});

it('ticks in the table exactly what the plans themselves include', () => {
  const featureOf: Record<string, Feature> = {
    f_network: 'officeNetwork', f_relay: 'relay', f_installments: 'installments', f_pipeline: 'pipeline', f_phoneApp: 'phoneApp',
    f_websiteApi: 'websiteApi', f_cloudBackup: 'cloudBackup', f_bankReconciliation: 'bankReconciliation', f_payroll: 'payroll',
    f_yearEnd: 'finalAccountsExport', f_backup: 'autoBackup', f_dbServer: 'databaseServer', f_mobileShop: 'mobileShop',
    f_autoParts: 'autoParts', f_pharmacy: 'pharmacy', f_loyalty: 'loyalty', f_engineeringWorks: 'engineeringWorks',
    f_electricalSolar: 'electricalSolar', f_generators: 'generators', f_realEstate: 'realEstate', f_branches: 'branches', f_online: 'onlineEdition'
  };
  for (const [label, feature] of Object.entries(featureOf)) {
    expect(row(label).cells, label).toEqual(PLAN_IDS.map((id) => PLANS[id].features.includes(feature)));
  }
});

it('says on Starter that Qasa Relay and the cloud backup come with Pro, in every language', () => {
  for (const key of ['rl_needsPro', 'rl_e_plan_no_relay', 'err_plan_no_relay', 'cl_needsPro', 'err_plan_limit_cloudBackup', 'tour_starterAdds'] as Key[]) {
    expect(isKey(key), key).toBe(true);
    const texts = all(key);
    expect(new Set(texts).size, key).toBe(3);
    for (const text of texts) expect(text, key).toContain('Pro');
  }
  for (const text of all('rl_needsPro')) expect(text).toContain('Qasa Relay');
  expect(new Set(all('tour_plan_starter')).size).toBe(3);
  // the texts that name the plans a feature needs include Starter where Starter has the feature, and not for Qasa Relay
  for (const key of ['netNeedsPro', 'bkNeedsPro', 'getPlan'] as Key[]) for (const text of all(key)) expect(text, key).toContain('Starter');
  for (const key of ['rl_e_licence_invalid', 'err_relay_needs_licence'] as Key[]) for (const text of all(key)) expect(text, key).not.toContain('Starter');
  // a full user list on any plan no longer reads as if the plan were Free
  expect(i18n('en').t('err_plan_limit_users')).toContain('Starter 2');
});

it('offers no Relay switch and no cloud sign-in on a plan without them', () => {
  const settings = readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8');
  const relay = settings.slice(settings.indexOf('function RelaySection'), settings.indexOf('function DatabaseServer') > 0 ? settings.indexOf('function DatabaseServer') : undefined);
  // the note comes before, and instead of, the switch
  expect(relay.indexOf('status.relayAvailable === false')).toBeGreaterThan(0);
  expect(relay.indexOf("t('rl_needsPro')")).toBeLessThan(relay.indexOf("t('rl_turnOn')"));
  expect(settings).toContain("{!status.provider && !status.available && <div className=\"alert\">{t('cl_needsPro')}");
});
