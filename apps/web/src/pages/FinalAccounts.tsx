import { Fragment, useState } from 'react';
import { formatAmount, todayIso } from '@qasa/core';
import { api, type FinalAccountsReport, type NamedAmount } from '../api.ts';
import { ErrorBox, Icon, downloadCsv, useData, useLoad } from '../components.tsx';
import { isKey, useI18n, type I18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import { PeriodPicker, yearStart } from './Reports.tsx';

/** Financial-statement style: losses and deductions in parentheses. */
function amountText(i18n: I18n, value: number): string {
  return value < 0 ? `(${i18n.money(-value, 'IQD')})` : i18n.money(value, 'IQD');
}

const csvAmount = (value: number) => (value < 0 ? `(${formatAmount(-value, 'IQD')})` : formatAmount(value, 'IQD'));

function rowLabel(t: I18n['t'], id: string): string {
  const key = `fa_${id}`;
  return isKey(key) ? t(key) : id;
}

export function FinalAccounts() {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings, plan } = useData();
  const [from, setFrom] = useState(() => yearStart(settings?.fiscalYearStart));
  const [to, setTo] = useState(todayIso());
  const [details, setDetails] = useState(false);
  const { data, error } = useLoad(() => (from && to ? api.finalAccounts(from, to) : Promise.resolve(null)), [from, to]);
  const canExport = !!plan?.features.includes('finalAccountsExport');
  const company = settings ? i18n.name(settings.companyName) : '';

  function exportCsv(fa: FinalAccountsReport) {
    const rows: (string | number)[][] = [[company], [`${t('finalAccounts')} ${fa.from} — ${fa.to}`], []];
    for (const section of fa.sections) {
      rows.push([t(`fs_${section.id}` as Key)]);
      for (const r of section.rows) {
        if (r.kind === 'line' && r.amount === 0 && r.details.length === 0) continue;
        rows.push([r.groups.join(' + '), rowLabel(t, r.id), csvAmount(r.kind === 'line' ? r.sign * r.amount : r.amount)]);
        if (details) for (const d of r.details.filter((x) => !r.groups.includes(x.code))) rows.push([d.code, '   ' + i18n.name(d.name), csvAmount(r.sign * d.amount)]);
      }
      rows.push([]);
    }
    const bs = fa.balanceSheet;
    rows.push([t('fs_balanceSheet'), t('asAt', { d: fa.to })]);
    rows.push([t('bs_assets')]);
    for (const g of bs.assets) rows.push([g.code, i18n.name(g.name), csvAmount(g.amount)]);
    rows.push(['', t('bs_totalAssets'), csvAmount(bs.totalAssets)], [t('bs_liabilities')]);
    for (const g of bs.liabilities) rows.push([g.code, i18n.name(g.name), csvAmount(g.amount)]);
    if (bs.priorResult) rows.push(['', t('bs_priorResult'), csvAmount(bs.priorResult)]);
    rows.push(['', t('bs_currentResult'), csvAmount(bs.currentResult)], ['', t('bs_totalLiabilities'), csvAmount(bs.totalLiabilities)]);
    downloadCsv(`final-accounts_${fa.from}_${fa.to}.csv`, rows);
  }

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="row no-print" style={{ alignItems: 'flex-end' }}>
        <PeriodPicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <label className="row small" style={{ gap: 6, alignSelf: 'center' }}>
          <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />{t('showSubAccounts')}
        </label>
        <span className="spacer" />
        {canExport ? (
          <>
            <button type="button" className="btn" onClick={() => data && exportCsv(data)} disabled={!data}><Icon name="download" size={16} />{t('exportExcel')}</button>
            <button type="button" className="btn" onClick={() => window.print()} disabled={!data}><Icon name="printer" size={16} />{t('print')}</button>
          </>
        ) : (
          <a className="btn" href={href('plans')} title={t('exportNeedsPro')}>
            <Icon name="printer" size={16} />{t('print')} · {t('exportExcel')} <span className="chip plan-pro">Pro</span>
          </a>
        )}
      </div>
      <div className="muted small no-print">{t('finalAccountsNote')}{!canExport && <> {t('exportNeedsPro')}</>}</div>
      <ErrorBox error={error} />

      {data && (
        <div className={'paper final-accounts' + (canExport ? '' : ' no-print-content')}>
          <div className="paper-head">
            <div style={{ flex: 1 }}>
              <div className="company-line">{company}</div>
              <div className="paper-title">{t('finalAccounts')}</div>
            </div>
            <div className="paper-meta">
              <span className="muted">{t('from')}</span><strong className="num">{i18n.date(data.from)}</strong>
              <span className="muted">{t('to')}</span><strong className="num">{i18n.date(data.to)}</strong>
            </div>
          </div>

          {data.sections.map((section) => (
            <section key={section.id} className="fa-section">
              <h3>{t(`fs_${section.id}` as Key)}</h3>
              <table className="table fa-table">
                <tbody>
                  {section.rows.map((r) => {
                    if (r.kind === 'subtotal') {
                      return (
                        <tr key={r.id} className={'fa-subtotal' + (r.id === 'netResult' ? ' fa-result' : '')}>
                          <td>{rowLabel(t, r.id)}{r.id === 'netResult' && r.amount < 0 && <span className="chip bad" style={{ marginInlineStart: 8 }}>{t('loss')}</span>}</td>
                          <td className="amount">{amountText(i18n, r.amount)}</td>
                        </tr>
                      );
                    }
                    if (r.amount === 0 && r.details.length === 0) return null;
                    return (
                      <Fragment key={r.id}>
                        <tr>
                          <td>{r.sign < 0 && <span className="muted">{t('less')} </span>}{rowLabel(t, r.id)} <span className="tree-code small">{r.groups.filter((g) => g.length === 2).join(' + ')}</span></td>
                          <td className="amount">{r.sign < 0 ? amountText(i18n, -r.amount) : amountText(i18n, r.amount)}</td>
                        </tr>
                        {details && r.details.filter((d) => !r.groups.includes(d.code)).map((d) => <DetailRow key={d.code} d={d} value={r.sign * d.amount} i18n={i18n} />)}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}

          <section className="fa-section">
            <div className="row">
              <h3>{t('fs_balanceSheet')} <span className="muted small">{t('asAt', { d: i18n.date(data.to) })}</span></h3>
              <span className="spacer" />
              {data.balanceSheet.totalAssets === data.balanceSheet.totalLiabilities
                ? <span className="chip ok no-print">{t('bsBalanced')}</span>
                : <span className="chip bad no-print">{t('bsNotBalanced')}</span>}
            </div>
            <div className="grid-2 fa-balance">
              <BalanceSide
                title={t('bs_assets')} groups={data.balanceSheet.assets} details={details} i18n={i18n}
                total={data.balanceSheet.totalAssets} totalLabel={t('bs_totalAssets')}
              />
              <BalanceSide
                title={t('bs_liabilities')} groups={data.balanceSheet.liabilities} details={details} i18n={i18n}
                total={data.balanceSheet.totalLiabilities} totalLabel={t('bs_totalLiabilities')}
                extra={[
                  ...(data.balanceSheet.priorResult ? [{ label: t('bs_priorResult'), amount: data.balanceSheet.priorResult }] : []),
                  { label: t('bs_currentResult'), amount: data.balanceSheet.currentResult }
                ]}
              />
            </div>
          </section>
          {!canExport && <div className="print-only muted small">{t('exportNeedsPro')}</div>}
        </div>
      )}
    </div>
  );
}

function DetailRow({ d, value, i18n }: { d: NamedAmount; value: number; i18n: I18n }) {
  return (
    <tr className="fa-detail">
      <td><span className="tree-code small">{d.code}</span> {i18n.name(d.name)}</td>
      <td className="amount">{amountText(i18n, value)}</td>
    </tr>
  );
}

function BalanceSide({ title, groups, details, i18n, total, totalLabel, extra = [] }: {
  title: string; groups: (NamedAmount & { details: NamedAmount[] })[]; details: boolean; i18n: I18n;
  total: number; totalLabel: string; extra?: { label: string; amount: number }[];
}) {
  const { t } = i18n;
  return (
    <table className="table fa-table">
      <thead><tr><th>{title}</th><th className="amount">{t('amount')}</th></tr></thead>
      <tbody>
        {groups.map((g) => (
          <Fragment key={g.code}>
            <tr><td><span className="tree-code small">{g.code}</span> {i18n.name(g.name)}</td><td className="amount">{amountText(i18n, g.amount)}</td></tr>
            {details && g.details.filter((d) => d.code !== g.code).map((d) => <DetailRow key={d.code} d={d} value={d.amount} i18n={i18n} />)}
          </Fragment>
        ))}
        {extra.map((x) => <tr key={x.label}><td>{x.label}</td><td className="amount">{amountText(i18n, x.amount)}</td></tr>)}
        {groups.length === 0 && extra.length === 0 && <tr><td colSpan={2} className="muted">{t('noData')}</td></tr>}
      </tbody>
      <tfoot><tr><td>{totalLabel}</td><td className="amount">{amountText(i18n, total)}</td></tr></tfoot>
    </table>
  );
}
