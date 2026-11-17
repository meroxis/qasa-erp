import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { isKey, makeI18n } from './i18n.ts';
import { PETROL_TEXT } from './i18n/petrol.ts';

// The petrol station's texts: every one in Arabic, English and Kurdish; the words the owner's accountants use (Kurdish
// پۆست for posting, قەرزدار / قەرزدەر for debit and credit, تانکی, لیتر, شەفت; Arabic خزان, صهريج, وصل الاستلام); and a
// message for every refusal the server's petrol station gives.

const entries = Object.entries(PETROL_TEXT) as [string, readonly [string, string, string]][];

it('has every text in the three languages, with the same placeholders', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const [key, [ar, en, ku]] of entries) {
    for (const text of [ar, en, ku]) expect(text.trim(), key).not.toBe('');
    expect(placeholders(ar), key).toBe(placeholders(en));
    expect(placeholders(ku), key).toBe(placeholders(en));
    // Arabic and Kurdish are not left in English
    expect(ar, key).not.toMatch(/\b(the|and|tank|litre|shift)\b/i);
    expect(ku, key).not.toMatch(/\b(the|and|tank|litre|shift)\b/i);
  }
});

it('writes Kurdish with the accountants\' words: posting پۆست, debit قەرزدار, credit قەرزدەر, and the station\'s own', () => {
  const ku = (key: keyof typeof PETROL_TEXT) => PETROL_TEXT[key][2];
  for (const [key, [, en, k]] of entries) {
    // the words replaced on 2026-11-17 are not used again
    expect(k, key).not.toMatch(/تەرحیل|مەدین|دائین/);
    if (/\bpost(s|ed|ing)?\b/i.test(en)) expect(k, key).toMatch(/پۆست/);
    if (/\btanks?\b/i.test(en) && !/\btanker/i.test(en)) expect(k, key).toMatch(/تانکی/);
  }
  expect(ku('ps_postingHelp')).toMatch(/قەرزدار/);
  expect(ku('ps_postingHelp')).toMatch(/قەرزدەر/);
  expect(ku('ps_close')).toBe('شەفت دابخە و پۆست بکە');
  expect(ku('ps_closed')).toContain('پۆستکراو');
  expect(ku('ps_litresN')).toBe('{n} لیتر');
  expect(ku('ps_payCredit')).toContain('قەرز');
  expect(ku('ps_payCash')).toContain('نەقد');
  expect(ku('ps_cashAccount')).toBe('قاسە');
  expect(ku('ps_attendant')).toBe('کارمەند');
  expect(ku('ps_stockAccount')).toContain('کۆگا');
  expect(ku('ps_dip')).toContain('پێوانە');
});

it('writes Arabic with the station\'s words: خزان, صهريج, وصل الاستلام, عجز and زيادة', () => {
  const ar = (key: keyof typeof PETROL_TEXT) => PETROL_TEXT[key][0];
  expect(ar('ps_tank')).toBe('الخزان');
  expect(ar('ps_delivery')).toContain('صهريج');
  expect(ar('ps_noteNo')).toContain('وصل الاستلام');
  expect(ar('ps_dip')).toContain('قياس الخزان');
  expect(ar('ps_short')).toBe('العجز');
  expect(ar('ps_over')).toBe('الزيادة');
});

it('has a message for every refusal of the server\'s petrol station, in each language', () => {
  const server = readFileSync(fileURLToPath(new URL('../../../packages/server/src/fuel.ts', import.meta.url)), 'utf8');
  const codes = new Set([...server.matchAll(/'(fuel_[a-z_]+)'/g)].map((m) => m[1]!)
    .filter((c) => !/^fuel_(settings|type|tank|pump|nozzle|shift|delivery|dip|types|tanks|pumps|nozzles|shifts|deliveries|dips|readings|moves|stock)$/.test(c)));
  // the chart's problems come from the core with the fuel_ prefix put on them
  for (const p of ['chart_too_short', 'chart_too_long', 'chart_row_invalid', 'chart_not_rising', 'chart_over_capacity']) codes.add(`fuel_${p}`);
  expect(codes.size).toBeGreaterThan(30);
  const missing = [...codes].filter((c) => !isKey(`err_${c}`));
  expect(missing).toEqual([]);
  for (const lang of ['ar', 'en', 'ku'] as const) {
    const m = makeI18n(lang, 'western', () => {}, () => {});
    expect(m.t('err_fuel_closing_below_opening', { n: '2/1' }), lang).toContain('2/1');
    expect(m.t('err_entry_belongs_to_fuel'), lang).not.toBe('err_entry_belongs_to_fuel');
  }
});
