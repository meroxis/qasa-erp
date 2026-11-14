import { expect, it } from 'vitest';

// Sorani is written with Kurdish letters: ی and ک, never the Arabic ى, ي or ك (they look alike, but they break search
// and sorting and read as a mistake). Checks every module text file (apps/web/src/i18n/*.ts).
const modules = import.meta.glob('./i18n/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;

it('writes every Kurdish module text with Kurdish letters', () => {
  const wrong: string[] = [];
  for (const [file, exports] of Object.entries(modules)) {
    for (const table of Object.values(exports)) {
      if (!table || typeof table !== 'object') continue;
      for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
        const ku = Array.isArray(value) ? value[2] : undefined;
        if (typeof ku === 'string' && /[ىيك]/.test(ku)) wrong.push(`${file} ${key}: ${ku}`);
      }
    }
  }
  expect(Object.keys(modules).length).toBeGreaterThan(10);
  expect(wrong).toEqual([]);
});

// Privacy is تایبەتێتی; تایبەتمەندی means a feature, so «سیاسەتی تایبەتمەندی» would read as "feature policy".
it('calls privacy تایبەتێتی in Kurdish, never تایبەتمەندی (feature)', () => {
  const wrong: string[] = [];
  let checked = 0;
  for (const [file, exports] of Object.entries(modules)) {
    for (const table of Object.values(exports)) {
      if (!table || typeof table !== 'object') continue;
      for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
        if (!Array.isArray(value) || typeof value[1] !== 'string' || !/privacy/i.test(value[1].replace(/\{\w+\}/g, ''))) continue;
        checked++;
        const ku = String(value[2]);
        if (!ku.includes('تایبەتێتی') || ku.includes('تایبەتمەندی')) wrong.push(`${file} ${key}: ${ku}`);
      }
    }
  }
  expect(checked).toBeGreaterThan(0);
  expect(wrong).toEqual([]);
  const legal = modules['./i18n/legal.ts']!.LEGAL_TEXT as Record<string, readonly string[]>;
  expect(legal.lg_privacy![2]).toBe('سیاسەتی تایبەتێتی');
});

// بڕ is a quantity; بڕی پارە is an amount of money; کۆگا is a warehouse and بڕی کۆگا what is in it. A wording pass once
// wrote the amount's words on quantity labels and "stock" on the warehouse: each label here keeps its own word.
it('keeps quantity, amount, warehouse and stock apart in Kurdish', async () => {
  const main = (await import('./i18n.ts')).makeI18n('ku', 'western', () => {}, () => {});
  expect(main.t('qty')).toBe('بڕ');
  expect(main.t('br_qty')).toBe('بڕ');
  expect(main.t('pos_qty')).toBe('بڕ');
  expect(main.t('amount')).toBe('بڕی پارە');
  expect(main.t('pos_warehouse')).toBe('کۆگا');
  expect(main.t('pos_stock')).toBe('بڕی کۆگا');
  expect(main.t('err_md_qty_invalid', { n: '3' })).not.toContain('پارە');
  expect(main.t('err_md_amount_invalid', { n: '3' })).toContain('پارە');
  expect(main.t('subtotal')).not.toBe(main.t('total'));
  expect(main.t('dep_refund')).not.toBe(main.t('cancel'));
  let checked = 0;
  for (const exports of Object.values(modules)) {
    for (const table of Object.values(exports)) {
      if (!table || typeof table !== 'object') continue;
      for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
        if (!Array.isArray(value) || typeof value[1] !== 'string' || typeof value[2] !== 'string') continue;
        const en = value[1].trim().toLowerCase();
        if (en === 'qty' || en === 'quantity') { checked++; expect(value[2], key).not.toContain('پارە'); }
        if (en === 'warehouse') { checked++; expect(value[2], key).toBe('کۆگا'); }
      }
    }
  }
  expect(checked).toBeGreaterThan(3);
});

// The screens made for 1.4 use the words of the Kurdish pass: ڕەسید for a balance, قەید for an entry, تەرحیل for posting.
it('writes the 1.4 screens with the words of the rest of the app', () => {
  const old = /باڵانس|نەختینە|سندوق|قەرزدار|قەرزدەر/;
  const wrong: string[] = [];
  for (const file of ['./i18n/items14.ts', './i18n/sales14.ts', './i18n/shell14.ts', './i18n/print14.ts']) {
    for (const table of Object.values(modules[file]!)) {
      if (!table || typeof table !== 'object') continue;
      for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
        const ku = Array.isArray(value) ? value[2] : undefined;
        if (typeof ku !== 'string') continue;
        if (old.test(ku)) wrong.push(`${file} ${key}: ${ku}`);
        // "posted" is تەرحیل and an entry is قەید: تۆمار stays for recording something that is not a journal entry
        const en = String((value as string[])[1]);
        if (/\bposted\b|\bpost\b|\bentr(y|ies)\b/i.test(en) && /تۆمار/.test(ku)) wrong.push(`${file} ${key}: ${ku}`);
      }
    }
  }
  expect(wrong).toEqual([]);
  const text = (file: string, table: string, key: string) => (modules[file]![table] as Record<string, readonly string[]>)[key]![2];
  expect(text('./i18n/print14.ts', 'PRINT14_TEXT', 'pd_h_previousBalance')).toBe('ڕەسیدی پێشوو');
  expect(text('./i18n/print14.ts', 'PRINT14_TEXT', 'pd_balanceHint')).toContain('تەرحیلکراو');
  expect(text('./i18n/sales14.ts', 'SALES14_TEXT', 's14_notYours')).toContain('قەید');
  // the Settings tile and its section call the posting accounts the same
  expect(text('./i18n/settings-sections.ts', 'SETTINGS_SECTION_TEXT', 'ss_companyHelp')).toContain('هەژمارەکانی تەرحیلی پسوولە');
});
