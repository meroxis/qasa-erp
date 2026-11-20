import { ErrorBox, Icon, useData, useLoad, usePageNav } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import { posApi, type Money2, type ShiftReport } from '../industry/pos-api.ts';
import { printDocument } from '../industry/printing.ts';
import { money2, shiftTime } from './shared.ts';
import { DiffText } from './OpenShift.tsx';

/* ---------- the shift report (X while open, Z once closed) ---------- */

export function PosShiftReport({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  usePageNav({ key: 'pos_title', group: 'gSales', title: 'pos_shiftReport' });
  const { data: r, error } = useLoad<ShiftReport>(() => posApi.shift(id), [id]);
  if (error) return <ErrorBox error={error} />;
  if (!r) return null;
  return (
    <div className="stack">
      <div className="row no-print">
        <a className="btn" href={href('pos')}>{t('pos_backToRegister')}</a>
        <button type="button" className="btn primary" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('pos_print')}</button>
      </div>
      <ShiftPaper r={r} company={settings ? i18n.name(settings.companyName) : ''} />
    </div>
  );
}

/**
 * 2.0.0: the X/Z reports of several shifts (every till of a day, from the end-of-day close) on one page, one paper
 * after another, printed in one go.
 */
export function PosShiftReports({ ids }: { ids: string[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  usePageNav({ key: 'pos_title', group: 'gSales', title: 'pos_shiftReport' });
  const { data, error } = useLoad<ShiftReport[]>(() => Promise.all(ids.map((id) => posApi.shift(id))), [ids.join(',')]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const company = settings ? i18n.name(settings.companyName) : '';
  return (
    <div className="stack">
      <div className="row no-print">
        <a className="btn" href={href('day-close')}>{t('ux_backToDayClose')}</a>
        <button type="button" className="btn primary" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('ux_printAllZ', { n: i18n.int(data.length) })}</button>
      </div>
      {data.map((r) => <div key={r.id} className="page-break-after"><ShiftPaper r={r} company={company} /></div>)}
    </div>
  );
}

function ShiftPaper({ r, company }: { r: ShiftReport; company: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const time = (iso: string | null) => shiftTime(i18n, iso);
  return (
      <div className="card pad stack paper">
        <div className="paper-head">
          <div>
            <div className="small muted">{company}</div>
            <h2 style={{ margin: 0 }}>{r.status === 'open' ? t('pos_xReport') : t('pos_zReport')} — {r.number}</h2>
          </div>
          <span className={'chip ' + (r.status === 'open' ? 'info' : '')}>{r.status === 'open' ? t('pos_statusOpen') : t('pos_statusClosed')}</span>
        </div>
        <div className="grid-3">
          <div><div className="small muted">{t('pos_register')}</div><div>{r.register}</div></div>
          <div><div className="small muted">{t('pos_cashier')}</div><div>{r.openedBy}{r.closedBy && r.closedBy !== r.openedBy ? ` / ${r.closedBy}` : ''}</div></div>
          <div><div className="small muted">{t('pos_cashAccount')}</div><div className="num">{r.cashAccountCode}</div></div>
          <div><div className="small muted">{t('pos_opened')}</div><div className="num">{time(r.openedAt)}</div></div>
          <div><div className="small muted">{t('pos_closed')}</div><div className="num">{time(r.closedAt)}</div></div>
          <div><div className="small muted">{t('pos_salesCount')}</div><div className="num">{i18n.int(r.count)}</div></div>
        </div>
        <table className="table">
          <tbody>
            <tr><td>{t('pos_openingCash')}</td><td className="num">{i18n.money(r.openingCash, 'IQD')}</td></tr>
            <tr><td>{t('pos_sales')}</td><td className="num">{money2(i18n, r.sales)}</td></tr>
            {(r.refunds.IQD > 0 || r.refunds.USD > 0) && <tr><td>{t('pos_refunds')}</td><td className="num">−{money2(i18n, r.refunds)}</td></tr>}
            {Object.entries(r.methods ?? {}).filter(([m]) => m !== 'cash' || Object.keys(r.methods ?? {}).length > 1).map(([m, v]) => <tr key={m}><td>{t(m === 'voucher' ? 'dc_m_voucher' : `pay_${m}` as Key)}</td><td className="num">{money2(i18n, v as Money2)}</td></tr>)}
            {(r.usdTaken?.usd ?? 0) > 0 && <tr><td>{t('tl_usdTaken')}<div className="small muted">{t('tl_usdTakenHelp')}</div></td><td className="num">{i18n.money(r.usdTaken!.usd, 'USD')} = {i18n.money(r.usdTaken!.iqd, 'IQD')}</td></tr>}
            <tr><td><strong>{t('pos_expected')}</strong></td><td className="num"><strong>{money2(i18n, r.expected)}</strong></td></tr>
            {r.counted && <tr><td>{t('pos_counted')}</td><td className="num">{money2(i18n, r.counted)}</td></tr>}
            {r.difference && <tr><td>{t('pos_difference')}</td><td className="num"><DiffText d={r.difference} /></td></tr>}
            {r.gift && r.gift.soldCount > 0 && <tr><td>{t('ux_giftSold', { n: i18n.int(r.gift.soldCount) })}</td><td className="num">{i18n.money(r.gift.sold, 'IQD')}</td></tr>}
            {r.gift && r.gift.used > 0 && <tr><td>{t('ux_giftUsed')}</td><td className="num">{i18n.money(r.gift.used, 'IQD')}</td></tr>}
          </tbody>
        </table>
        {r.notes && <p className="small" style={{ whiteSpace: 'pre-line' }}>{t('pos_notes')}: {r.notes}</p>}

        <h3 style={{ marginBlockEnd: 0 }}>{t('pos_itemsSold')}</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('pos_item')}</th><th className="num">{t('pos_qty')}</th><th className="num">{t('pos_amount')}</th></tr></thead>
            <tbody>
              {r.items.map((it) => (
                <tr key={it.itemId}><td>{it.code} — {i18n.name(it.name)}</td><td className="num">{i18n.qty(it.qtyMilli)}</td><td className="num">{money2(i18n, it.amount)}</td></tr>
              ))}
              {r.items.length === 0 && <tr><td colSpan={3} className="muted">{t('pos_noSales')}</td></tr>}
            </tbody>
          </table>
        </div>

        <h3 style={{ marginBlockEnd: 0 }}>{t('pos_invoices')}</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('pos_no')}</th><th>{t('pos_time')}</th><th>{t('pos_customer')}</th><th className="num">{t('pos_amount')}</th><th /></tr></thead>
            <tbody>
              {r.invoices.map((inv) => (
                <tr key={inv.invoiceId}>
                  <td><a href={href(`invoice/${inv.invoiceId}`)} className="ltr">{inv.number ?? '—'}</a>{inv.offlineRef && <div className="small muted ltr">{inv.offlineRef}</div>}</td>
                  <td className="num">{i18n.digitsOf(new Date(inv.createdAt).toTimeString().slice(0, 5))}</td>
                  <td>{inv.partyName ?? t('pos_walkIn')}</td>
                  <td className="num">{i18n.money(inv.total, inv.currency)}</td>
                  <td>{inv.status !== 'posted' && <span className="chip bad">{t('pos_cancelled')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">{t('pos_returnsNote')}</p>
      </div>
  );
}

