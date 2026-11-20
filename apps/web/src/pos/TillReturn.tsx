import { useState } from 'react';
import { newIdempotencyKey, type InvoiceView } from '../api.ts';
import { ErrorBox, Icon, Modal } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { posApi } from '../industry/pos-api.ts';

/** What may still come back of each line: sold, less what returns already gave back. */
export function returnable(invoice: Pick<InvoiceView, 'lines'>): { lineNo: number; leftMilli: number }[] {
  return invoice.lines.map((l) => ({ lineNo: l.lineNo, leftMilli: Math.max(0, l.qtyMilli - l.returnedQtyMilli) }));
}

/**
 * A return at the till (2.0.0): type or scan the receipt number, pick what comes back, and the money is paid back from
 * this shift's safe. When the company's till rules ask for a supervisor on refunds, the PIN is asked just before the
 * return is sent, and the server checks that approval (till-returns.ts). No Sales permission is needed: the Point of
 * sale role and the cashier's own open shift are enough.
 */
export function TillReturnDialog(p: {
  shiftId: string; needsSupervisor: boolean;
  ask(): Promise<{ token: string } | null>;
  onDone(back: InvoiceView): void; onClose(): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [q, setQ] = useState('');
  const [sale, setSale] = useState<InvoiceView | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [key] = useState(newIdempotencyKey);
  const find = async () => {
    setError(null);
    setBusy(true);
    try {
      const found = await posApi.findSale(p.shiftId, q.trim());
      setSale(found);
      setQty({});
    } catch (e) {
      setSale(null);
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const left = sale ? new Map(returnable(sale).map((l) => [l.lineNo, l.leftMilli])) : new Map<number, number>();
  const picked = Object.entries(qty).map(([lineNo, n]) => ({ lineNo: Number(lineNo), qtyMilli: n })).filter((l) => l.qtyMilli > 0);
  const total = sale ? sale.lines.reduce((s, l) => s + (l.qtyMilli ? Math.round((l.amount * (qty[l.lineNo] ?? 0)) / l.qtyMilli) : 0), 0) : 0;
  const send = async () => {
    if (!sale || !picked.length) return;
    setError(null);
    let approvals: string[] | undefined;
    if (p.needsSupervisor) {
      const ok = await p.ask();
      if (!ok) return;
      approvals = [ok.token];
    }
    setBusy(true);
    try {
      const back = await posApi.giveBack(p.shiftId, { invoiceId: sale.id, lines: picked, ...(approvals ? { approvals } : {}) }, { key });
      p.onDone(back);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('ux_tillReturn')} onClose={p.onClose}>
      <div className="stack">
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void find(); }}>
          <label className="field" style={{ flex: 1, margin: 0 }}><span>{t('ux_receiptNumber')}</span>
            <input className="input ltr" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="INV-2026-0001" aria-label={t('ux_receiptNumber')} />
          </label>
          <button type="submit" className="btn" disabled={busy || !q.trim()} style={{ alignSelf: 'flex-end' }}><Icon name="search" size={16} />{t('ux_find')}</button>
        </form>
        <div className="small muted">{t('ux_receiptHint')}</div>
        {sale && (
          <>
            <div className="row" style={{ gap: 8 }}>
              <strong className="ltr">{sale.number}</strong><span className="muted">{i18n.date(sale.date)}</span>
              <span className="spacer" />
              <button type="button" className="btn small" onClick={() => setQty(Object.fromEntries([...left].map(([n, m]) => [n, m])))}>{t('ux_returnAll')}</button>
            </div>
            <table className="table">
              <thead><tr><th>{t('item')}</th><th className="num">{t('ux_sold')}</th><th className="num">{t('ux_left')}</th><th className="num">{t('ux_back')}</th></tr></thead>
              <tbody>
                {sale.lines.map((l) => {
                  const most = left.get(l.lineNo) ?? 0;
                  return (
                    <tr key={l.lineNo}>
                      <td>{i18n.name(l.itemName)}</td>
                      <td className="num">{i18n.qty(l.qtyMilli)}</td>
                      <td className="num">{i18n.qty(most)}</td>
                      <td className="num">
                        <input className="input num ltr" style={{ width: 90 }} inputMode="decimal" disabled={most === 0} aria-label={t('ux_back')}
                          value={qty[l.lineNo] ? String(qty[l.lineNo]! / 1000) : ''}
                          onChange={(e) => {
                            const n = Math.round(Number(e.target.value.replace(',', '.')) * 1000);
                            setQty((x) => ({ ...x, [l.lineNo]: Number.isFinite(n) ? Math.max(0, Math.min(most, n)) : 0 }));
                          }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="pos-r-row"><span>{t('ux_refundAbout')}</span><strong className="num">{i18n.money(total, sale.currency)}</strong></div>
            {p.needsSupervisor && <div className="small muted">{t('ux_returnNeedsPin')}</div>}
          </>
        )}
        <ErrorBox error={error} />
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={p.onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy || !sale || !picked.length} onClick={() => void send()}><Icon name="undo" size={16} />{t('ux_giveBack')}</button>
        </div>
      </div>
    </Modal>
  );
}
