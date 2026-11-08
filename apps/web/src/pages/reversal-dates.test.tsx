import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { todayIso } from '@qasa/core';
import { reverseDefaultDate } from '../industry/ReverseModal.tsx';

// Cancelling or reversing something dated ahead: the dialog starts on today, or on the document's own date when that is
// later, and won't take an earlier day (the server refuses a reversal dated before what it reverses).
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

describe('the date a cancellation or reversal starts on', () => {
  it('is today, or the document\'s date when that is later', () => {
    const today = todayIso();
    expect(reverseDefaultDate()).toBe(today);
    expect(reverseDefaultDate('2020-01-01')).toBe(today);
    expect(reverseDefaultDate('2999-12-31')).toBe('2999-12-31');
  });

  it('is set that way, with the document\'s date as the earliest, in every cancel and reverse dialog', () => {
    const dialogs: [file: string, opens: string, input: string][] = [
      ['./Invoices.tsx', 'setCancelDate(reverseDefaultDate(v.date))', 'type="date" min={v.date} value={cancelDate}'],
      ['./StockDocs.tsx', 'setCancelDate(reverseDefaultDate(d.date))', 'type="date" min={d.date} value={cancelDate}'],
      ['./StockAdjustments.tsx', 'setCancelDate(reverseDefaultDate(d.date))', 'type="date" min={d.date} value={cancelDate}'],
      ['./EntryDetail.tsx', 'setReverseDate(reverseDefaultDate(e.date))', 'type="date" min={e.date} value={reverseDate}'],
      ['./FixedAssets.tsx', 'setUndoDate(reverseDefaultDate(a.disposal?.date))', 'type="date" min={a.disposal?.date} value={undoDate}'],
      ['./Banking.tsx', "step === 'undo' ? reverseDefaultDate(undoMin)", 'type="date" min={undoMin} value={date}']
    ];
    for (const [file, opens, input] of dialogs) {
      const text = source(file);
      expect(text, file).toContain(opens);
      expect(text, file).toContain(input);
    }
    // the Pro dialogs that use ReverseModal pass the date of what they reverse
    expect(source('./Generators.tsx')).toContain('min={run.date}');
    expect(source('./Payroll.tsx')).toContain('min={run.date}');
  });
});
