import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isKey, makeI18n } from '../i18n.ts';
import { auditAction, auditEntity, auditRef } from './audit-words.ts';

// The audit log shows the app's names, never the server's own words: every action and entity the server (and the Pro
// module, where it is present) writes to the log has its words in the three languages.

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const sources = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'node_modules') sources(p, out); }
    else if (/\.ts$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
};
const code = [...sources(join(root, 'packages/server/src')), ...sources(join(root, 'pro/src'))].map((f) => readFileSync(f, 'utf8')).join('\n');
/** audit(db, who, 'action', 'entity', …) as the code writes it; an action built from a step is spelled out. */
const STEPS: Record<string, string[]> = { 'po.${action}': ['po.send', 'po.cancel', 'po.reopen'], 'quote_${action}': ['quote_send', 'quote_accept', 'quote_reject', 'quote_reopen', 'quote_cancel'] };
const written = [...code.matchAll(/audit\(\s*db,\s*[^,]+,\s*['`]([a-z_.${}]+)['`],\s*'([a-z_]+)'/g)].map((m) => ({ action: m[1]!, entity: m[2]! }));
const actions = [...new Set(written.flatMap((w) => STEPS[w.action] ?? [w.action]))].sort();
const entities = [...new Set(written.map((w) => w.entity))].sort();

describe('the audit log in words', () => {
  it('finds what the server writes to the log', () => {
    expect(actions.length).toBeGreaterThan(60);
    expect(entities.length).toBeGreaterThan(30);
    expect(actions).toEqual(expect.arrayContaining(['create', 'post', 'request_approval', 'po.send', 'price_list.set', 'quote_accept']));
    expect(entities).toEqual(expect.arrayContaining(['entry', 'invoice', 'print_design', 'purchase_order']));
  });

  it('has a name for every action and every entity, in Arabic, English and Kurdish', () => {
    expect(actions.filter((a) => !isKey(`a_${a.replace(/\./g, '_')}`))).toEqual([]);
    expect(entities.filter((e) => !isKey(`e_${e}`))).toEqual([]);
    for (const lang of ['ar', 'en', 'ku'] as const) {
      const m = makeI18n(lang, 'western', () => {}, () => {});
      for (const a of actions) expect(auditAction(m, a), `${lang} ${a}`).not.toBe(a);
      for (const e of entities) expect(auditEntity(m, e), `${lang} ${e}`).not.toBe(e);
      // Arabic and Kurdish show no word of the server's (Latin letters, an underscore); a product name is no such word
      if (lang !== 'en') {
        for (const text of [...actions.map((a) => auditAction(m, a)), ...entities.map((e) => auditEntity(m, e))]) {
          expect(text.replace(/Excel/g, ''), `${lang} ${text}`).not.toMatch(/[a-z_]{3,}/);
        }
      }
    }
  });

  it('says which one in words too: the kind of paper of a print design, a record by the start of its id, and no setting key', () => {
    const ku = makeI18n('ku', 'western', () => {}, () => {});
    const en = makeI18n('en', 'western', () => {}, () => {});
    // «دیزاینی چاپ voucher» was the server's word beside the Kurdish name
    expect(`${auditEntity(ku, 'print_design')} ${auditRef(ku, 'print_design', 'voucher')!.text}`).toBe('دیزاینی چاپ سەنەدی وەرگرتن و پارەدان');
    expect(auditRef(ku, 'print_design', 'sale')).toEqual({ text: 'پسوولەی فرۆشتن', plain: true });
    expect(auditRef(en, 'print_design', 'pos')).toEqual({ text: 'POS receipt', plain: true });
    expect(auditRef(en, 'print_design', 'something_else')).toBeNull();
    expect(auditEntity(ku, 'serials')).toBe('ژمارە زنجیرەییەکان');
    // a record: the start of its id; a period and a year as they are
    expect(auditRef(en, 'invoice', '7c9e6679-7425-40de-944b-e07fc1f90ae7')).toEqual({ text: '7c9e6679', plain: false });
    expect(auditRef(en, 'period', '2026-11')).toEqual({ text: '2026-11', plain: false });
    expect(auditRef(en, 'year', '2026')).toEqual({ text: '2026', plain: false });
    // the server's own words that have no name here are not shown: the entity's name says it
    for (const [entity, id] of [['settings', 'brief_phone'], ['settings', 'batches'], ['print_profile', 'company'], ['company_logo', 'company'], ['payroll_settings', 'payroll']] as const) {
      expect(auditRef(en, entity, id), `${entity} ${id}`).toBeNull();
    }
    expect(auditRef(en, 'settings', null)).toBeNull();
    // dots in an action are read as the key's underscores
    expect(auditAction(en, 'po.send')).toBe('Purchase order sent');
    expect(auditAction(ku, 'price_list.set')).toBe('لیستی نرخی کڕیار دانرا');
  });

  it('is what the page shows, under one name with its tile: «تۆماری وردبینی»', () => {
    const page = readFileSync(fileURLToPath(new URL('../pages/Settings.tsx', import.meta.url)), 'utf8');
    expect(page).toContain('auditAction(i18n, r.action)');
    expect(page).toContain('auditEntity(i18n, r.entity)');
    expect(page).not.toMatch(/const (actionLabel|entityLabel) =/);
    const ku = makeI18n('ku', 'western', () => {}, () => {});
    expect(ku.t('auditLog')).toBe('تۆماری وردبینی');
    expect(ku.t('ss_periodsHelp')).toContain(ku.t('auditLog'));
    const texts = readdirSync(fileURLToPath(new URL('../i18n/', import.meta.url))).map((f) => readFileSync(fileURLToPath(new URL(`../i18n/${f}`, import.meta.url)), 'utf8')).join('\n')
      + readFileSync(fileURLToPath(new URL('../i18n.ts', import.meta.url)), 'utf8');
    expect(texts).not.toContain('تۆماری چالاکییەکان');
  });
});
