import { z } from 'zod';
import type { Names } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { readSetting, writeSetting } from './settings.ts';
import type { ApiExtension } from './routes.ts';

/**
 * The accounts features post to that the unified chart may not have (2.0, accounting review #3): notes receivable for
 * cheques, consignment goods held, gift vouchers sold, old gold and gold owed to suppliers. A feature uses, in order:
 *
 * 1. the account the company chose for it (its setting, Settings → Accounts → "Accounts features post to");
 * 2. its standard code when that account is a standard one (the chart's own, or one a feature made: system = 1) — the
 *    choice is then written down, so it is kept by its setting from now on;
 * 3. its standard code made now under its parent, when the parent holds no entries (a standard account, and the choice
 *    written down).
 *
 * An account of the same code the company made itself is never taken: it is the company's (a "263 Rent payable" would
 * otherwise get the gift vouchers posted into it). The feature then refuses with its "account missing" error until the
 * accountant chooses one. A customer or supplier can't be put on any of these accounts either.
 *
 * Changing the choice (books review #13): refused while the account in use holds a balance, and a stock account (a
 * warehouse's, the fuel stock) is never chosen.
 *
 * Existing companies: an account a feature made before (always system = 1) keeps working, and its setting is written
 * the first time it is used; one the company had made itself with the same code before 2.0 was already being posted
 * into by the feature, so it keeps working only if the setting points at it (the accountant's choice).
 */

export interface FeatureAccountDef {
  setting: string;
  code: string;
  parent: string;
  /** what the chosen account must start with */
  root: string;
  names: Names;
  /** the feature's error when it has no account */
  missing: string;
}

export const FEATURE_ACCOUNTS = {
  notesReceivable: {
    setting: 'banking_notes_receivable', code: '162', parent: '16', root: '16', missing: 'bk_notes_receivable_missing',
    names: { ar: 'أوراق القبض', en: 'Notes receivable', ku: 'بەڵگەنامەکانی وەرگرتن' }
  },
  consignment: {
    setting: 'consignment_account', code: '268', parent: '26', root: '26', missing: 'cs_account_missing',
    names: { ar: 'بضاعة أمانة لدينا', en: 'Consignment goods held', ku: 'کاڵای ئەمانەت لای ئێمە' }
  },
  giftVouchers: {
    setting: 'gift_voucher_account', code: '263', parent: '26', root: '2', missing: 'gv_account_missing',
    names: { ar: 'قسائم هدايا مباعة', en: 'Gift vouchers sold', ku: 'کوپۆنی دیاری فرۆشراو' }
  },
  oldGold: {
    setting: 'gold_scrap_account', code: '1378', parent: '137', root: '13', missing: 'gold_account_missing',
    names: { ar: 'ذهب كسر (مستعمل)', en: 'Old gold', ku: 'زێڕی کۆن' }
  },
  goldOwed: {
    setting: 'gold_owed_account', code: '264', parent: '26', root: '26', missing: 'gold_account_missing',
    names: { ar: 'ذهب مستحق للموردين', en: 'Gold owed to suppliers', ku: 'زێڕی قەرزی دابینکەران' }
  }
} as const satisfies Record<string, FeatureAccountDef>;

export type FeatureAccountKey = keyof typeof FEATURE_ACCOUNTS;

/** The account a feature posts to now (made if it may be). Inside the feature's transaction. */
export function featureAccount(db: Db, key: FeatureAccountKey, user: string, names?: Names): string {
  const def: FeatureAccountDef = FEATURE_ACCOUNTS[key];
  const accounts = loadAccounts(db);
  const chosen = readSetting(db, def.setting);
  if (chosen && accounts.some((a) => a.code === chosen && a.postable)) return chosen;
  const own = accounts.find((a) => a.code === def.code);
  if (own) {
    // a standard account (the chart's, or one a feature made) is taken; the company's own account of that code never is
    if (!own.postable || !own.system) throw conflict(def.missing, { code: def.code });
    writeSetting(db, def.setting, def.code);
    return def.code;
  }
  if (!accounts.some((a) => a.code === def.parent)) throw conflict(def.missing, { code: def.code });
  if (db.prepare('SELECT 1 FROM entry_lines WHERE account_code = ? LIMIT 1').get(def.parent)) throw conflict(def.missing, { code: def.code });
  const n = names ?? def.names;
  db.prepare('INSERT INTO accounts (code, name_ar, name_en, name_ku, "system", created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(def.code, n.ar, n.en, n.ku, new Date().toISOString());
  writeSetting(db, def.setting, def.code);
  audit(db, user, 'create', 'account', def.code, { name: n, standard: true, for: key });
  return def.code;
}

/**
 * The accounts features post to now: chosen, or their standard ones in use. A customer's or supplier's account is
 * never one of them (their balances would mix).
 */
export function featureAccountCodes(db: Db): Set<string> {
  const out = new Set<string>();
  const accounts = loadAccounts(db);
  for (const def of Object.values(FEATURE_ACCOUNTS) as FeatureAccountDef[]) {
    const chosen = readSetting(db, def.setting);
    if (chosen) out.add(chosen);
    else if (accounts.some((a) => a.code === def.code && a.system)) out.add(def.code);
  }
  return out;
}

export interface FeatureAccountView { key: FeatureAccountKey; code: string | null; standard: string; root: string }

export function featureAccountsView(db: Db): FeatureAccountView[] {
  const accounts = loadAccounts(db);
  return (Object.entries(FEATURE_ACCOUNTS) as [FeatureAccountKey, FeatureAccountDef][]).map(([key, def]) => {
    const chosen = readSetting(db, def.setting);
    const code = chosen && accounts.some((a) => a.code === chosen && a.postable) ? chosen
      : accounts.some((a) => a.code === def.code && a.system && a.postable) ? def.code : null;
    return { key, code, standard: def.code, root: def.root };
  });
}

/** A warehouse's stock account, or the fuel stock the petrol station posts to (chosen in its settings, or the one it made). */
function isStockAccount(db: Db, code: string): boolean {
  if (db.prepare('SELECT 1 FROM warehouses WHERE account_code = ? LIMIT 1').get(code)) return true;
  let fuelStock: unknown;
  try { fuelStock = (JSON.parse(readSetting(db, 'fuel_settings') ?? '{}') as { stockAccount?: unknown }).stockAccount; } catch { fuelStock = undefined; }
  if (fuelStock === code) return true;
  return code === FUEL_STOCK_STANDARD && !!db.prepare('SELECT 1 FROM accounts WHERE code = ? AND "system" = 1').get(code);
}

/** The petrol station's standard fuel stock account (fuel.ts names it; a test holds the two together). */
export const FUEL_STOCK_STANDARD = '1379';

/** Whether an account holds a balance, in any currency: entries in the books and those waiting (a refused one is in none). */
function accountHolds(db: Db, code: string): boolean {
  const rows = db.prepare(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b, COALESCE(SUM(l.base_debit - l.base_credit), 0) AS base
                           FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                           WHERE l.account_code = ? AND NOT EXISTS (SELECT 1 FROM voucher_approvals vp WHERE vp.entry_id = e.id AND vp.state = 'rejected')
                           GROUP BY e.currency`).all(code) as { b: number; base: number }[];
  return rows.some((r) => Number(r.b) !== 0 || Number(r.base) !== 0);
}

/** The accountant chooses the account a feature posts to: postable, of the right kind, and no customer's or supplier's. */
export function chooseFeatureAccount(db: Db, key: FeatureAccountKey, code: string, user: string): FeatureAccountView[] {
  const def: FeatureAccountDef = FEATURE_ACCOUNTS[key];
  const account = loadAccounts(db).find((a) => a.code === code);
  if (!account || !account.postable || !code.startsWith(def.root)) throw invalid([{ code: 'feature_account_invalid', accountCode: code } as { code: string }]);
  if (db.prepare('SELECT 1 FROM parties WHERE account_code = ? LIMIT 1').get(code)) throw invalid([{ code: 'feature_account_party', accountCode: code } as { code: string }]);
  const others = (Object.entries(FEATURE_ACCOUNTS) as [FeatureAccountKey, FeatureAccountDef][]).filter(([k]) => k !== key);
  if (others.some(([, d]) => readSetting(db, d.setting) === code)) throw invalid([{ code: 'feature_account_taken', accountCode: code } as { code: string }]);
  // a warehouse's stock account, or the petrol station's fuel stock, is its stock's value and nothing else: old gold (the
  // one feature account among the stock accounts) posted there would no longer agree with the stock it is the value of
  if (isStockAccount(db, code)) throw invalid([{ code: 'feature_account_stock', accountCode: code } as { code: string }]);
  // what the feature holds now (vouchers not yet used, goods held, gold owed, cheques in hand) stays where it was
  // posted: with the account changed, what is paid, used or settled after would come out of an account it never went
  // into. The account is changed once it holds nothing (or the balance is moved first, by an entry)
  const current = featureAccountsView(db).find((v) => v.key === key)?.code ?? null;
  if (current && current !== code && accountHolds(db, current)) throw invalid([{ code: 'feature_account_in_use', accountCode: current } as { code: string }]);
  transaction(db, () => {
    writeSetting(db, def.setting, code);
    audit(db, user, 'update', 'feature_account', key, { accountCode: code });
  });
  return featureAccountsView(db);
}

/** Reading is open to those who read the books' settings; choosing is an admin's (as every change not listed). */
export const featureAccountsApi: ApiExtension = {
  rules: { 'GET /api/feature-accounts': 'admin' },
  routes(db, { actorOf }) {
    return [
      { method: 'GET', path: '/api/feature-accounts', handler: async () => featureAccountsView(db) },
      {
        method: 'PUT', path: '/api/feature-accounts/:key',
        handler: async (req) => {
          const key = (req.params as { key?: string }).key;
          if (!key || !(key in FEATURE_ACCOUNTS)) throw new AppError(404, 'not_found', { what: 'feature_account' });
          const body = z.object({ accountCode: z.string().min(1).max(12) }).safeParse(req.body);
          if (!body.success) throw invalid([{ code: 'feature_account_invalid' }]);
          return chooseFeatureAccount(db, key as FeatureAccountKey, body.data.accountCode, actorOf(req).name);
        }
      }
    ];
  }
};
