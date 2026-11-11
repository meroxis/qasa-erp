import { useState } from 'react';
import { formatAmount, isReversedRange, todayIso, type Names } from '@qasa/core';
import { api, type TrialBalanceReport } from '../api.ts';
import { AccountCombo, ErrorBox, Icon, downloadCsv, useData, useLoad } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { go, href } from '../router.ts';
import { printDocument } from '../industry/printing.ts';

export function yearStart(fiscalYearStart: string | undefined): string {
  const today = todayIso();
  const mmdd = fiscalYearStart ?? '01-01';
  const thisYear = `${today.slice(0, 4)}-${mmdd}`;
  return thisYear <= today ? thisYear : `${Number(today.slice(0, 4)) - 1}-${mmdd}`;
}

export function PeriodPicker({ from, to, onFrom, onTo }: { from: string; to: string; onFrom(v: string): void; onTo(v: string): void }) {
  const { t } = useI18n();
  return (
    <>
      <label className="field"><span>{t('from')}</span><input className="input" type="date" value={from} onChange={(e) => onFrom(e.target.value)} /></label>
      <label className="field"><span>{t('to')}</span><input className="input" type="date" value={to} onChange={(e) => onTo(e.target.value)} /></label>
    </>
  );
}

type TbKey = 'code' | 'account' | 'openingDebit' | 'openingCredit' | 'movementDebit' | 'movementCredit' | 'closingDebit' | 'closingCredit' | 'totals';

/** The trial balance as Excel rows: opening, movement in the period and closing balance, each as debit and credit. */
export function trialBalanceCsv(data: TrialBalanceReport, t: (k: TbKey) => string, nameOf: (n: Names) => string): string[][] {
  const iqd = (n: number) => formatAmount(n, 'IQD');
  return [
    [t('code'), t('account'), t('openingDebit'), t('openingCredit'), t('movementDebit'), t('movementCredit'), t('closingDebit'), t('closingCredit')],
    ...data.rows.map((r) => [r.code, nameOf(r.name), iqd(r.openingDebit), iqd(r.openingCredit), iqd(r.debit), iqd(r.credit), iqd(r.closingDebit), iqd(r.closingCredit)]),
    [t('totals'), '', iqd(data.openingDebitTotal), iqd(data.openingCreditTotal), iqd(data.totalDebit), iqd(data.totalCredit), iqd(data.balanceDebitTotal), iqd(data.balanceCreditTotal)]
  ];
}

export function TrialBalance() {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const [from, setFrom] = useState(() => yearStart(settings?.fiscalYearStart));
  const [to, setTo] = useState(todayIso());
  // From later than To is no period: say so, and don't ask the server for it
  const reversed = isReversedRange(from || undefined, to || undefined);
  const loaded = useLoad(() => (reversed ? Promise.resolve(null) : api.trialBalance(from || undefined, to || undefined).then((report) => ({ from, to, report }))), [from, to]);
  const { error } = loaded;
  // a report shows (and exports) only for the dates it was made for: while the next one loads, or when the range turns
  // invalid, the previous figures are gone at once instead of staying on screen (and in Export) under the new dates
  const data = !reversed && loaded.data && loaded.data.from === from && loaded.data.to === to ? loaded.data.report : null;

  const rows = data?.rows ?? [];
  const ok = data && data.totalDebit === data.totalCredit && data.openingDebitTotal === data.openingCreditTotal && data.balanceDebitTotal === data.balanceCreditTotal;
  const cell = (n: number) => (n ? i18n.money(n, 'IQD') : '');

  function exportCsv() {
    if (!data) return;
    downloadCsv(`trial-balance_${from}_${to}.csv`, trialBalanceCsv(data, t, i18n.name));
  }

  return (
    <div className="stack">
      <div className="row no-print" style={{ alignItems: 'flex-end' }}>
        <PeriodPicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <span className="spacer" />
        <button type="button" className="btn" onClick={exportCsv} disabled={!data}><Icon name="download" size={16} />{t('exportExcel')}</button>
        <button type="button" className="btn" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('print')}</button>
      </div>
      <div className="muted small">{t('onlyPosted')} {t('tbOpeningHelp')}</div>
      {reversed && <div className="alert bad" role="alert">{t('err_date_range_reversed')}</div>}
      <ErrorBox error={error} />
      {data && !reversed && (
        <div className="card">
          <div className="row" style={{ padding: '14px 16px 8px' }}>
            <h2>{t('trialBalance')} <span className="muted small">{i18n.date(from)} — {i18n.date(to)}</span></h2>
            <span className="spacer" />
            {rows.length > 0 && (ok ? <span className="chip ok">{t('tbBalanced')}</span> : <span className="chip bad">{t('tbNotBalanced')}</span>)}
          </div>
          {rows.length === 0 ? <p className="muted" style={{ padding: '0 16px 16px' }}>{t('noData')}</p> : (
            <div className="table-wrap">
              <table className="table tb-six">
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ width: 80 }}>{t('code')}</th><th rowSpan={2}>{t('account')}</th>
                    <th colSpan={2} className="tb-group">{t('opening')}</th>
                    <th colSpan={2} className="tb-group">{t('tbMovement')}</th>
                    <th colSpan={2} className="tb-group">{t('closing')}</th>
                  </tr>
                  <tr>
                    <th className="amount">{t('debit')}</th><th className="amount">{t('credit')}</th>
                    <th className="amount">{t('debit')}</th><th className="amount">{t('credit')}</th>
                    <th className="amount">{t('debit')}</th><th className="amount">{t('credit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code} className="click" onClick={() => go(`statement/${r.code}`)}>
                      <td><span className="tree-code">{r.code}</span></td>
                      <td>{i18n.name(r.name)}</td>
                      <td className="amount">{cell(r.openingDebit)}</td>
                      <td className="amount">{cell(r.openingCredit)}</td>
                      <td className="amount">{cell(r.debit)}</td>
                      <td className="amount">{cell(r.credit)}</td>
                      <td className="amount">{cell(r.closingDebit)}</td>
                      <td className="amount">{cell(r.closingCredit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td /><td>{t('totals')}</td>
                    <td className="amount">{i18n.money(data.openingDebitTotal, 'IQD')}</td>
                    <td className="amount">{i18n.money(data.openingCreditTotal, 'IQD')}</td>
                    <td className="amount">{i18n.money(data.totalDebit, 'IQD')}</td>
                    <td className="amount">{i18n.money(data.totalCredit, 'IQD')}</td>
                    <td className="amount">{i18n.money(data.balanceDebitTotal, 'IQD')}</td>
                    <td className="amount">{i18n.money(data.balanceCreditTotal, 'IQD')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Statement({ code: initialCode }: { code?: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const [code, setCode] = useState(initialCode ?? '');
  const [from, setFrom] = useState(() => yearStart(settings?.fiscalYearStart));
  const [to, setTo] = useState(todayIso());
  // all lines (IQD at the book rates), or one currency's lines in that currency: a dollar safe runs a dollar balance
  const [currency, setCurrency] = useState<'' | 'IQD' | 'USD'>('');
  const cur = currency || 'IQD';
  const { data, error } = useLoad(() => (code ? api.statement(code, from || undefined, to || undefined, currency || undefined) : Promise.resolve(null)), [code, from, to, currency]);

  function exportCsv() {
    if (!data) return;
    downloadCsv(`statement_${data.accountCode}_${from}_${to}.csv`, [
      [`${data.accountCode} — ${i18n.name(data.name)}`],
      [t('colDate'), t('number'), t('description'), t('debit'), t('credit'), t('balance')],
      ['', '', t('opening'), '', '', formatAmount(data.opening, cur)],
      ...data.rows.map((r) => [r.date, r.number, r.description, formatAmount(r.debit, cur), formatAmount(r.credit, cur), formatAmount(r.balance, cur)]),
      ['', '', t('closing'), formatAmount(data.totalDebit, cur), formatAmount(data.totalCredit, cur), formatAmount(data.closing, cur)]
    ]);
  }

  return (
    <div className="stack">
      <div className="row no-print" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ width: 340 }}>
          <span>{t('account')}</span>
          <AccountCombo value={code} onChange={setCode} filter={() => true} includeParents ariaLabel={t('account')} />
        </div>
        <PeriodPicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <div className="track" role="group" aria-label={t('currency')}>
          <button type="button" aria-pressed={currency === ''} onClick={() => setCurrency('')}>{t('all')}</button>
          <button type="button" aria-pressed={currency === 'IQD'} onClick={() => setCurrency('IQD')}>{t('iqdName')}</button>
          <button type="button" aria-pressed={currency === 'USD'} onClick={() => setCurrency('USD')}>{t('usdName')}</button>
        </div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={exportCsv} disabled={!data}><Icon name="download" size={16} />{t('exportExcel')}</button>
        <button type="button" className="btn" onClick={() => void printDocument('report')} disabled={!data}><Icon name="printer" size={16} />{t('print')}</button>
      </div>
      {!code && <div className="alert info">{t('pickAccount')}</div>}
      <ErrorBox error={error} />
      {data && (
        <div className="card">
          <div style={{ padding: '14px 16px 8px' }}>
            <h2>{t('statement')}: <span className="ltr">{data.accountCode}</span> — {i18n.name(data.name)}</h2>
            <div className="muted small">{i18n.date(from)} — {i18n.date(to)} · {t('onlyPosted')}</div>
          </div>
          <table className="table">
            <thead>
              <tr><th style={{ width: 110 }}>{t('colDate')}</th><th style={{ width: 130 }}>{t('number')}</th><th>{t('description')}</th><th className="amount">{t('debit')}</th><th className="amount">{t('credit')}</th><th className="amount">{t('balance')}</th></tr>
            </thead>
            <tbody>
              <tr><td /><td /><td className="muted">{t('opening')}</td><td /><td /><td className="amount">{i18n.money(data.opening, cur)}</td></tr>
              {data.rows.map((r, i) => (
                <tr key={r.entryId + i} className="click" onClick={() => go(`entry/${r.entryId}`)}>
                  <td className="num">{i18n.date(r.date)}</td>
                  <td><a className="ltr" href={href(`entry/${r.entryId}`)} onClick={(e) => e.stopPropagation()}>{r.number}</a></td>
                  <td>{r.description}{r.accountCode !== data.accountCode && <div className="muted small"><span className="ltr">{r.accountCode}</span> {i18n.name(r.accountName)}</div>}</td>
                  <td className="amount">{r.debit ? i18n.money(r.debit, cur) : ''}</td>
                  <td className="amount">{r.credit ? i18n.money(r.credit, cur) : ''}</td>
                  <td className="amount">{i18n.money(r.balance, cur)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td /><td /><td>{t('closing')}</td><td className="amount">{i18n.money(data.totalDebit, cur)}</td><td className="amount">{i18n.money(data.totalCredit, cur)}</td><td className="amount">{i18n.money(data.closing, cur)}</td></tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
