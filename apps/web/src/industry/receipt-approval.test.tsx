import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError } from '../api.ts';
import { errorMessages } from '../components.tsx';
import { I18nContext, makeI18n, type Key } from '../i18n.ts';
import { ReceiptApproval, receiptDoneText } from './ReceiptApproval.tsx';

// 1.4.1: a receipt that a document made (an installment, a job's deposit, a solar system paid in cash, a unit's
// deposit, a generator collection) may wait for approval. Each document says so beside the receipt, and the message
// after making one says that it counts once approved.
const LANGS = ['ar', 'en', 'ku'] as const;
const en = makeI18n('en', 'western', () => {}, () => {});
const all = (key: Key) => LANGS.map((l) => makeI18n(l, 'western', () => {}, () => {}).t(key));
const render = (node: ReactNode) => renderToStaticMarkup(<I18nContext.Provider value={en}>{node}</I18nContext.Provider>);

it('marks a waiting receipt, and a rejected one with who rejected it and why, and nothing for an approved one', () => {
  expect(render(<ReceiptApproval of={{ approval: 'waiting' }} />)).toBe(`<span class="chip warn">${en.t('da_waiting')}</span>`);
  const rejected = render(<ReceiptApproval of={{ approval: 'rejected', rejectedBy: 'Mer', reason: 'Not in the safe' }} />);
  expect(rejected).toContain(en.t('s14_rejected'));
  expect(rejected).toContain('Rejected by Mer: Not in the safe');
  expect(render(<ReceiptApproval of={{ approval: null }} />)).toBe('');
  // an older server sends no approval at all: as approved
  expect(render(<ReceiptApproval of={{}} />)).toBe('');
});

it('says after making one that it counts once approved, else the usual message', () => {
  expect(receiptDoneText(en.t, { approval: 'waiting' }, 'Payment collected')).toBe(en.t('da_savedWaiting'));
  expect(receiptDoneText(en.t, { approval: null }, 'Payment collected')).toBe('Payment collected');
  expect(receiptDoneText(en.t, undefined, 'Payment collected')).toBe('Payment collected');
});

it('has every text in Arabic, English and Kurdish, and says why a unit with a waiting deposit is neither sold nor released', () => {
  for (const key of ['da_waiting', 'da_waitingAmount', 'da_savedWaiting', 'dep_waitingNote', 'err_deposit_waiting'] as Key[]) {
    expect(new Set(all(key)).size, key).toBe(3);
  }
  expect(en.t('da_waitingAmount', { a: '300,000 IQD' })).toBe('Waiting for approval: 300,000 IQD');
  expect(errorMessages(new ApiError(409, 'deposit_waiting', null), en)).toEqual([en.t('err_deposit_waiting')]);
});

it('says why a solar system with a waiting receipt is not sold yet, and the Sell button waits for it (1.4.1)', () => {
  expect(new Set(all('err_job_receipt_waiting' as Key)).size).toBe(3);
  expect(errorMessages(new ApiError(409, 'job_receipt_waiting', null), en)).toEqual([en.t('err_job_receipt_waiting' as Key)]);
  const solar = readFileSync(new URL('../pages/Solar.tsx', import.meta.url), 'utf8');
  expect(solar).toContain("disabled={!!j.waiting} title={j.waiting ? t('err_job_receipt_waiting') : undefined}");
  // the server refuses the sale too (pro/src/solar/service.ts), with the same code
});
