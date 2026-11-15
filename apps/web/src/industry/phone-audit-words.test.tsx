import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeI18n } from '../i18n.ts';
import { auditAction, auditEntity } from './audit-words.ts';

// Phone app 1.1: the phone link (Pro) writes a line for every change a phone makes, "phone_change" on the phone. The
// link writes with its own handle on the books (this.db), which the audit-words test does not read: the words are
// checked here, in the three languages, and against what the link writes when the Pro module is here.

describe('changes made from a phone, in the audit log', () => {
  it('are named in Arabic, English and Kurdish', () => {
    for (const lang of ['ar', 'en', 'ku'] as const) {
      const m = makeI18n(lang, 'western', () => {}, () => {});
      expect(auditAction(m, 'phone_change'), lang).not.toBe('phone_change');
      expect(auditEntity(m, 'phone'), lang).not.toBe('phone');
      if (lang !== 'en') expect(`${auditAction(m, 'phone_change')} ${auditEntity(m, 'phone')}`, lang).not.toMatch(/[a-z_]{3,}/);
    }
    const en = makeI18n('en', 'western', () => {}, () => {});
    expect(`${auditAction(en, 'phone_change')} · ${auditEntity(en, 'phone')}`).toBe('Change from a phone · Phone');
  });

  it('are the words the phone link writes (pro/, where it is present)', () => {
    const link = fileURLToPath(new URL('../../../../pro/src/phone/phone.ts', import.meta.url));
    if (!existsSync(link)) return;
    expect(readFileSync(link, 'utf8')).toMatch(/audit\(this\.db, device\.name, 'phone_change', 'phone', device\.id,/);
  });
});
