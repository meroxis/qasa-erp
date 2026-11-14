import { expect, it } from 'vitest';
import { isKey, makeI18n, type Key } from './i18n.ts';
import { AR_DUAL, COUNT_TEXT, COUNT_VAR, countOf } from './i18n/counts.ts';

// 1.4.1: texts of a count read right for one ("1 item at or below its minimum", never "1 items") and, in Arabic, for two
// (the dual), in every language. The forms live in i18n/counts.ts and t() picks one from the count.
const i18n = (lang: 'ar' | 'en' | 'ku', digits: 'western' | 'eastern' = 'western') => makeI18n(lang, digits, () => {}, () => {});
const modules = import.meta.glob('./i18n/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

it('says the home page\'s low stock line in the singular for one item, in the dual for two in Arabic', () => {
  const en = i18n('en');
  expect(en.t('ro_count', { n: 1 })).toBe('1 item at or below its minimum');
  expect(en.t('ro_count', { n: '1' })).toBe('1 item at or below its minimum');
  expect(en.t('ro_count', { n: 2 })).toBe('2 items at or below their minimum');
  expect(en.t('ro_count', { n: 11 })).toBe('11 items at or below their minimum');
  expect(i18n('ar').t('ro_count', { n: 1 })).toBe('مادة واحدة عند حدها الأدنى أو تحته');
  expect(i18n('ar').t('ro_count', { n: 2 })).toBe('مادتان عند حدهما الأدنى أو تحته');
  expect(i18n('ar').t('ro_count', { n: 5 })).toBe('5 مادة عند حدها الأدنى أو تحته');
  expect(i18n('ku').t('ro_count', { n: 1 })).toBe('1 کاڵا گەیشتووەتە کەمترین بڕی خۆی یان لەوە کەمترە');
  expect(i18n('ku').t('ro_count', { n: 2 })).toBe('2 کاڵا گەیشتوونەتە کەمترین بڕی خۆیان یان لەوە کەمترن');
  // the count as the screen formats it (i18n.int) in Eastern digits is still one
  const ar = i18n('ar', 'eastern');
  expect(ar.t('ro_count', { n: ar.int(1) })).toBe('مادة واحدة عند حدها الأدنى أو تحته');
  expect(i18n('ku', 'eastern').t('ro_count', { n: i18n('ku', 'eastern').int(1) })).toBe('١ کاڵا گەیشتووەتە کەمترین بڕی خۆی یان لەوە کەمترە');
});

it('reads a count from a number or from digits as shown, and nothing else', () => {
  expect(countOf(1)).toBe(1);
  expect(countOf('١')).toBe(1);
  expect(countOf('۲')).toBe(2);
  expect(countOf('1,000')).toBe(1000);
  expect(countOf('⁦1⁩')).toBe(1);
  expect(countOf('INV-1')).toBeUndefined();
  expect(countOf('')).toBeUndefined();
  expect(countOf(undefined)).toBeUndefined();
});

it('keeps a count in the placeholder each text names: a reminder for one month names the subscriber in {n}', () => {
  const en = i18n('en');
  expect(en.t('gen_waText', { n: 'Mer', a: '5,000 IQD', m: 1, c: 'Raz' })).toContain('(1 month)');
  expect(en.t('gen_waText', { n: 'Mer', a: '5,000 IQD', m: 3, c: 'Raz' })).toContain('(3 months)');
  expect(en.t('ly_expiring', { p: 1, d: '01/12/2026' })).toBe('1 point lapses on 01/12/2026');
  expect(en.t('so_err_too_many_attempts', { s: 1 })).toBe('Too many tries; try again in 1 second.');
  expect(en.t('sl_everyN', { n: 1 })).toBe('Every month');
  expect(en.t('sl_sysUnits', { n: 3 })).toBe('3 units');
  expect(en.t('trialEnds', { d: '01/12/2026', n: 1 })).toBe('The trial ends on 01/12/2026 (1 day left).');
  expect(en.t('br_invoicesCount', { n: 1 })).toBe('1 invoice');
  expect(en.t('md_rowsN', { n: 1 })).toBe('1 row');
  expect(en.t('re_unitsN', { n: 1 })).toBe('1 unit');
  // two counts in one line are said as "label: count"
  expect(en.t('ex_alert', { e: 1, n: 1, d: 30 })).toBe('Batches expired: 1; expiring within 30 days: 1');
  expect(en.t('st_added', { c: 1, s: 0, b: 1 })).toBe('Added — categories: 1, subcategories: 0, brands: 1.');
});

it('gives every form for one and every dual a text of its own key, with the same placeholders', () => {
  const ar = i18n('ar');
  for (const [key, forms] of Object.entries(COUNT_TEXT)) {
    const base = key.slice(0, -'__one'.length);
    expect(isKey(base), key).toBe(true);
    const many = (['ar', 'en', 'ku'] as const).map((l) => i18n(l).t(base as Key));
    // English and Kurdish keep every placeholder; Arabic may say the number in words ("مادة واحدة")
    // (only "Every month" drops its number in English and Kurdish)
    if (base === 'sl_everyN') continue;
    expect(placeholders(forms[1]), key).toEqual(placeholders(many[1]!));
    expect(placeholders(forms[2]), key).toEqual(placeholders(many[2]!));
    const count = COUNT_VAR[base] ?? 'n';
    expect(placeholders(forms[0]).every((p) => placeholders(many[0]!).includes(p)), key).toBe(true);
    expect(forms[0].includes(`{${count}}`) || /واحد/.test(forms[0]) || forms[0] === 'كل شهر', key).toBe(true);
    expect(forms.every((f) => f.trim().length > 0), key).toBe(true);
    // the Kurdish form is written with Kurdish letters
    expect(/[ىيك]/.test(forms[2]), key).toBe(false);
  }
  for (const [key, dual] of Object.entries(AR_DUAL)) {
    expect(isKey(key), key).toBe(true);
    expect(isKey(`${key}__one`), `${key} has a form for one`).toBe(true);
    const count = COUNT_VAR[key] ?? 'n';
    // the dual says the number in its own word, and keeps every other placeholder
    expect(placeholders(dual), key).toEqual(placeholders(ar.t(key as Key)).filter((p) => p !== count));
  }
  for (const [key, name] of Object.entries(COUNT_VAR)) expect(i18n('en').t(key as Key), key).toContain(`{${name}}`);
});

// The audit: any English text that puts a count before a plural noun ("{n} days", "{n} more rows") has its form for one.
// Texts whose count is never one, or is not a count at all, are named here with the reason.
const NOT_A_COUNT_OF_ONE: Record<string, string> = {
  startTrial: 'the free month is always 30 days'
};

it('has a form for one for every English count text', () => {
  const missing: string[] = [];
  for (const [file, exports] of Object.entries(modules)) {
    if (file.endsWith('counts.ts')) continue;
    for (const table of Object.values(exports)) {
      if (!table || typeof table !== 'object') continue;
      for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
        if (!Array.isArray(value) || typeof value[1] !== 'string') continue;
        const count = COUNT_VAR[key] ?? 'n';
        // "{n} is ready" is a number's name, not a count
        if (!new RegExp(`\\{${count}\\} (more )?(?!is\\b|was\\b|has\\b)[a-z]+s\\b`).test(value[1])) continue;
        if (!isKey(`${key}__one`) && !NOT_A_COUNT_OF_ONE[key]) missing.push(`${file} ${key}: ${value[1]}`);
      }
    }
  }
  // the texts in i18n.ts itself
  const en = i18n('en');
  for (const key of ['trialEnds', 'nudgeText', 'bkCopies', 'bl_unfinished_entries', 'bl_unfinished_documents', 'dbHasCompany', 'lateDays', 'err_plan_user_limit', 'usersOverLimit'] as Key[]) {
    expect(en.t(key, { n: 1, d: 'd', name: 'Mer', m: 1, k: 1 }), key).not.toMatch(/\b1 (users|days|sales invoices|copies|vouchers|invoices|entries)\b/);
  }
  expect(missing).toEqual([]);
});

it('has no "(s)" plural left in English', () => {
  const left: string[] = [];
  for (const [file, exports] of Object.entries(modules)) {
    for (const table of Object.values(exports)) {
      if (!table || typeof table !== 'object') continue;
      for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
        if (Array.isArray(value) && typeof value[1] === 'string' && /\w\(s\)/.test(value[1])) left.push(`${file} ${key}`);
      }
    }
  }
  expect(left).toEqual([]);
  expect(i18n('en').t('usersOverLimit', { n: 3, m: 4, k: 3 })).toContain('allows 3 users');
});
