import { parseAmount, toWesternDigits, type CurrencyCode } from '@qasa/core';
import type { StatementLineInput } from './banking-api.ts';

/**
 * Reading a bank statement exported from the bank's site (Excel/CSV) or pasted from Excel: which column is which (by
 * the Arabic, English or Kurdish words banks print), and the dates and amounts in whatever form the bank wrote them.
 */

export type StatementColumn = 'date' | 'description' | 'reference' | 'amount' | 'in' | 'out';
export type ColumnMap = Partial<Record<StatementColumn, number>>;

const WORDS: Record<StatementColumn, string[]> = {
  date: ['التاريخ', 'تاريخ', 'تاريخ الحركة', 'تاريخ العملية', 'تاريخ القيد', 'date', 'transaction date', 'value date', 'posting date', 'بەروار'],
  description: ['البيان', 'الوصف', 'التفاصيل', 'تفاصيل', 'الشرح', 'description', 'details', 'narrative', 'particulars', 'memo', 'ڕوونکردنەوە', 'وردەکاری'],
  reference: ['المرجع', 'رقم المرجع', 'الرقم المرجعي', 'رقم الصك', 'رقم الشيك', 'reference', 'ref', 'ref no', 'cheque no', 'check no', 'cheque number', 'سەرچاوە', 'ژمارەی چەک'],
  amount: ['المبلغ', 'القيمة', 'amount', 'value', 'net', 'بڕ'],
  in: ['دائن', 'إيداع', 'ايداع', 'الإيداعات', 'وارد', 'credit', 'credits', 'deposit', 'deposits', 'money in', 'paid in', 'قەرزدەر', 'دانان'],
  out: ['مدين', 'سحب', 'السحوبات', 'صادر', 'debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'قەرزار', 'ڕاکێشان']
};

const norm = (s: string) => toWesternDigits(s).toLowerCase().replace(/[ًٌٍَُِّْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/[()_:.\-*#/]/g, ' ').replace(/\s+/g, ' ').trim();

/** The columns a header row most likely holds. "Amount" is used only when there are no separate in/out columns. */
export function guessStatementColumns(headers: string[]): ColumnMap {
  const cleaned = headers.map((h) => norm(h ?? ''));
  const map: ColumnMap = {};
  const taken = new Set<number>();
  const order: StatementColumn[] = ['date', 'reference', 'in', 'out', 'amount', 'description'];
  for (const pass of ['exact', 'contains'] as const) {
    for (const col of order) {
      if (map[col] !== undefined) continue;
      const words = WORDS[col].map(norm);
      const i = cleaned.findIndex((h, idx) => !taken.has(idx) && h !== '' && words.some((w) => (pass === 'exact' ? h === w : h.split(' ').includes(w) || h.startsWith(w + ' '))));
      if (i >= 0) { map[col] = i; taken.add(i); }
    }
  }
  if (map.in !== undefined && map.out !== undefined) delete map.amount;
  return map;
}

/** "2026-03-05", "05/03/2026", "5-3-26", "٠٥/٠٣/٢٠٢٦" or an Excel day number (46086) → "2026-03-05"; null otherwise. Day before month, as Iraqi banks print. */
export function parseStatementDate(text: string): string | null {
  const s = toWesternDigits(String(text ?? '')).trim();
  if (!s) return null;
  const iso = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCMonth() !== m - 1) return null;
    return date.toISOString().slice(0, 10);
  };
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) return iso(+m[3]!, +m[2]!, +m[1]!);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial < 20000 || serial > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}

/** "1,250,000", "-1,250.50", "(1,250)", "1,250 CR", "1,250-" → signed minor units; null when it isn't a number. */
export function parseStatementAmount(text: string, currency: CurrencyCode): number | null {
  let s = toWesternDigits(String(text ?? '')).trim().replace(/ /g, ' ');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/\b(dr|db)\b|مدين/i.test(s)) negative = true;
  s = s.replace(/\b(cr|dr|db|iqd|usd)\b|دائن|مدين|د\.ع|دينار|\$/gi, '').trim();
  if (s.startsWith('-') || s.startsWith('−')) { negative = !negative; s = s.slice(1); }
  else if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1); }
  else if (s.startsWith('+')) s = s.slice(1);
  const value = parseAmount(s.trim(), currency);
  if (value === null) return null;
  return negative ? -value : value;
}

export interface ParsedStatement {
  lines: StatementLineInput[];
  /** rows with no readable date or amount (totals, blank lines, balances carried forward) */
  skipped: number;
}

/** The statement's lines from the rows, by the chosen columns. Zero-amount rows are skipped. */
export function rowsToStatement(rows: string[][], map: ColumnMap, currency: CurrencyCode, hasHeader: boolean): ParsedStatement {
  const lines: StatementLineInput[] = [];
  let skipped = 0;
  const cell = (row: string[], col: StatementColumn) => (map[col] === undefined ? '' : String(row[map[col]!] ?? '').trim());
  for (const row of hasHeader ? rows.slice(1) : rows) {
    const date = parseStatementDate(cell(row, 'date'));
    let amount: number | null = null;
    if (map.amount !== undefined) amount = parseStatementAmount(cell(row, 'amount'), currency);
    else {
      const inn = cell(row, 'in') ? parseStatementAmount(cell(row, 'in'), currency) : 0;
      const out = cell(row, 'out') ? parseStatementAmount(cell(row, 'out'), currency) : 0;
      amount = inn === null || out === null ? null : Math.abs(inn) - Math.abs(out);
    }
    if (!date || amount === null || amount === 0) { skipped += 1; continue; }
    const reference = cell(row, 'reference');
    lines.push({ date, description: cell(row, 'description').slice(0, 500) || '—', ...(reference ? { reference: reference.slice(0, 100) } : {}), amount });
  }
  return { lines, skipped };
}

/** Pasted text from Excel is tab-separated; anything else is read as CSV. */
export function splitPasted(text: string, parseCsv: (t: string) => string[][]): string[][] {
  const trimmed = text.replace(/\r\n?/g, '\n').trim();
  if (!trimmed) return [];
  if (trimmed.includes('\t')) return trimmed.split('\n').map((l) => l.split('\t')).filter((r) => r.some((c) => c.trim() !== ''));
  return parseCsv(trimmed);
}
