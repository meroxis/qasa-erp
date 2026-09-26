import type { Names } from './lang.ts';

export type Nature = 'debit' | 'credit';
export type AccountClass = 1 | 2 | 3 | 4;

export interface Account {
  code: string;
  name: Names;
  /** Code of the parent account, or null for the four top-level classes. */
  parentCode: string | null;
  /** Only accounts without children can receive journal lines. */
  postable: boolean;
  /** Standard accounts from the unified chart cannot be deleted. */
  system: boolean;
}

/** 1 Assets · 2 Liabilities & capital · 3 Uses (expenses) · 4 Resources (revenue). */
export function accountClass(code: string): AccountClass {
  const first = Number(code[0]);
  if (first === 1 || first === 2 || first === 3 || first === 4) return first;
  throw new Error(`Invalid account code: ${code}`);
}

/** Assets and expenses normally carry debit balances; liabilities, capital and revenue carry credit balances. */
export function natureOf(code: string): Nature {
  const cls = accountClass(code);
  return cls === 1 || cls === 3 ? 'debit' : 'credit';
}

/** Parent = the existing account whose code is the longest proper prefix of this code. */
export function findParentCode(code: string, existing: Iterable<string>): string | null {
  let best: string | null = null;
  for (const candidate of existing) {
    if (candidate.length < code.length && code.startsWith(candidate) && (!best || candidate.length > best.length)) best = candidate;
  }
  return best;
}

export type AccountCodeError =
  | 'code_format'
  | 'code_exists'
  | 'parent_missing'
  | 'parent_has_entries'
  | 'not_under_parent';

/**
 * Validates the code of a new sub-account.
 * Rules: digits only, must start with the parent code and be longer than it,
 * must not already exist, and the parent must not already hold journal lines
 * (otherwise those lines would sit on a non-postable account).
 */
export function validateNewAccountCode(
  code: string,
  parentCode: string,
  ctx: { exists(code: string): boolean; hasEntries(code: string): boolean }
): AccountCodeError | null {
  if (!/^[1-4]\d{0,11}$/.test(code)) return 'code_format';
  if (!ctx.exists(parentCode)) return 'parent_missing';
  if (!code.startsWith(parentCode) || code.length <= parentCode.length) return 'not_under_parent';
  if (ctx.exists(code)) return 'code_exists';
  if (ctx.hasEntries(parentCode)) return 'parent_has_entries';
  return null;
}

/** Builds Account records (with parent and postable flags) from a flat list of codes and names. */
export function buildAccounts(rows: { code: string; name: Names; system: boolean }[]): Account[] {
  const codes = rows.map((r) => r.code);
  const parents = new Set<string>();
  const withParent = rows.map((r) => {
    const parentCode = findParentCode(r.code, codes);
    if (parentCode) parents.add(parentCode);
    return { ...r, parentCode };
  });
  return withParent
    .map((r) => ({ code: r.code, name: r.name, parentCode: r.parentCode, system: r.system, postable: !parents.has(r.code) }))
    .sort((a, b) => compareCodes(a.code, b.code));
}

/** Orders codes as a tree: 1, 11, 111, 112, 12, 13, 131, … */
export function compareCodes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
