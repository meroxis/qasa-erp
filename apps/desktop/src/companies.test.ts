import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canAddCompany, PLANS, resolvePlan } from '@qasa/core';
import {
  addCompany, backupFileName, chooseCompany, cleanName, companyDirOf, damagedFileChoices, isCompanyId, MAIN_COMPANY,
  newCompanyId, parseRegistry, readRegistry, renameCompany, writeRegistry, type Registry
} from './companies.ts';

const NOW = '2026-11-07T10:00:00.000Z';
const base = (): Registry => parseRegistry(null, 'شركة الأولى', NOW);
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('company ids and folders', () => {
  it('works a folder out of an id only, never out of a path', () => {
    expect(companyDirOf('/data/Qasa ERP', MAIN_COMPANY)).toBe('/data/Qasa ERP');
    expect(companyDirOf('/data/Qasa ERP', 'c0a1b2c3d')).toBe(join('/data/Qasa ERP', 'companies', 'c0a1b2c3d'));
    for (const bad of ['../x', 'c0A1B2C3D', '..', 'c0a1b2c3d/../../x', '', 'c123', 'C0a1b2c3d', 'c0a1b2c3d\\..']) {
      expect(isCompanyId(bad)).toBe(false);
      expect(() => companyDirOf('/data/Qasa ERP', bad)).toThrow();
    }
  });

  it('makes ids from random bytes', () => {
    expect(newCompanyId(new Uint8Array([1, 2, 254, 255]))).toBe('c0102feff');
    expect(isCompanyId(newCompanyId(new Uint8Array([9, 9, 9, 9])))).toBe(true);
  });
});

describe('names', () => {
  it('trims, drops control and direction characters, keeps any language, caps at 80', () => {
    expect(cleanName('  شركة   البناء \n')).toBe('شركة البناء');
    expect(cleanName('Qasa‮gnp.exe')).toBe('Qasa gnp.exe');
    expect(cleanName('کۆمپانیای سلێمانی')).toBe('کۆمپانیای سلێمانی');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect([...cleanName('ب'.repeat(200))!].length).toBe(80);
  });

  it('turns a name into a backup file name that is never a path', () => {
    expect(backupFileName('شركة البناء', '2026-11-07-10-00-00')).toBe('شركة-البناء-2026-11-07-10-00-00.sqlite');
    expect(backupFileName('../../Windows/evil', '2026-11-07')).toBe('Windowsevil-2026-11-07.sqlite');
    expect(backupFileName('///', '2026')).toBe('company-2026.sqlite');
  });
});

describe('the list of companies', () => {
  it('always has the first company and checks what the file says', () => {
    expect(base()).toEqual({ current: MAIN_COMPANY, list: [{ id: MAIN_COMPANY, name: 'شركة الأولى', createdAt: NOW }] });
    const parsed = parseRegistry({
      current: '../x',
      list: [{ id: 'c00000001', name: 'B', createdAt: '2026-01-01' }, { id: 'c00000001', name: 'dup' }, { id: '../evil', name: 'x' }, 'junk']
    }, 'A', NOW);
    expect(parsed.current).toBe(MAIN_COMPANY);
    expect(parsed.list.map((c) => c.id)).toEqual([MAIN_COMPANY, 'c00000001']);
  });

  it('adds companies up to the plan limit', () => {
    let r = base();
    r = addCompany(r, { id: 'c00000001', name: 'Second', now: NOW, limit: 3 });
    r = addCompany(r, { id: 'c00000002', name: 'Third', now: NOW, limit: 3 });
    expect(() => addCompany(r, { id: 'c00000003', name: 'Fourth', now: NOW, limit: 3 })).toThrow('company_limit');
    expect(() => addCompany(base(), { id: 'c00000001', name: 'x', now: NOW, limit: 1 })).toThrow('company_limit');
    expect(addCompany(r, { id: 'c00000003', name: 'Fourth', now: NOW, limit: null }).list).toHaveLength(4);
    expect(() => addCompany(r, { id: 'c00000001', name: 'again', now: NOW, limit: null })).toThrow('company_exists');
    expect(() => addCompany(r, { id: 'c00000009', name: ' ', now: NOW, limit: null })).toThrow('company_name_invalid');
    expect(() => addCompany(r, { id: MAIN_COMPANY, name: 'x', now: NOW, limit: null })).toThrow();
  });

  it('renames and chooses only listed companies', () => {
    const r = addCompany(base(), { id: 'c00000001', name: 'Second', now: NOW, limit: null });
    expect(renameCompany(r, 'c00000001', ' New ').list[1]!.name).toBe('New');
    expect(() => renameCompany(r, 'c00000002', 'x')).toThrow('company_not_found');
    expect(chooseCompany(r, 'c00000001').current).toBe('c00000001');
    expect(() => chooseCompany(r, 'c00000002')).toThrow('company_not_found');
  });

  it('reads and writes companies.json, and a damaged file falls back to the first company', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-companies-'));
    dirs.push(dir);
    expect(readRegistry(dir, 'A', NOW).list).toHaveLength(1);
    const r = chooseCompany(addCompany(readRegistry(dir, 'A', NOW), { id: 'c00000001', name: 'B', now: NOW, limit: null }), 'c00000001');
    writeRegistry(dir, r);
    expect(readRegistry(dir, 'A', NOW)).toEqual(r);
    writeFileSync(join(dir, 'companies.json'), '{not json');
    expect(readRegistry(dir, 'A', NOW).current).toBe(MAIN_COMPANY);
  });
});

describe('plan limits for companies', () => {
  it('Free 1, the free first month and Pro 3, Business unlimited', () => {
    expect(PLANS.free.limits.companies).toBe(1);
    expect(PLANS.pro.limits.companies).toBe(3);
    expect(PLANS.business.limits.companies).toBeNull();
    const trial = resolvePlan({ license: null, trialStarted: '2026-11-01', today: '2026-11-07' });
    expect(trial).toMatchObject({ plan: 'business', source: 'trial', limits: { companies: 3, users: null } });
    expect(canAddCompany(PLANS.free.limits, 1)).toBe(false);
    expect(canAddCompany(trial.limits, 2)).toBe(true);
    expect(canAddCompany(trial.limits, 3)).toBe(false);
    expect(canAddCompany(PLANS.business.limits, 500)).toBe(true);
  });
});

describe('a company file that cannot be opened at the start', () => {
  it('Enter means Try again, never setting the file aside; Escape quits', () => {
    for (const main of [true, false]) {
      const { choices, defaultId, cancelId } = damagedFileChoices(main);
      expect(choices[defaultId]).toBe('retry');
      expect(choices[cancelId]).toBe('quit');
    }
    expect(damagedFileChoices(true).choices).toEqual(['retry', 'aside', 'quit']);
    expect(damagedFileChoices(false).choices).toEqual(['retry', 'aside', 'first', 'quit']);
  });
});
