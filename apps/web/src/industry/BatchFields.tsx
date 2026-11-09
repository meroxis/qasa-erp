import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, type ItemView } from '../api.ts';
import { useI18n } from '../i18n.ts';
import { Icon, Modal } from '../components.tsx';
import { batchesApi, type BatchReportRow } from './batches-api.ts';

/** A line coming in (purchase, opening stock): its batch number and expiry date, for an item that tracks batches. */
export function BatchInFields({ item, batchNo, expiry, onChange }: {
  item: Pick<ItemView, 'trackBatches' | 'trackExpiry'> | undefined; batchNo: string; expiry: string; onChange(v: { batchNo: string; expiry: string }): void;
}) {
  const { t } = useI18n();
  if (!item?.trackBatches) return null;
  return (
    <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'nowrap' }}>
      <input className="input small ltr" style={{ width: 110 }} placeholder={t('ex_batchNo')} aria-label={t('ex_batchNo')} maxLength={40} value={batchNo} onChange={(e) => onChange({ batchNo: e.target.value, expiry })} />
      {item.trackExpiry && (
        <input className={'input small' + (!expiry ? ' invalid' : '')} type="date" aria-label={t('ex_expiry')} title={t('ex_expiry')} value={expiry} onChange={(e) => onChange({ batchNo, expiry: e.target.value })} />
      )}
    </div>
  );
}

/** A line going out (sale, POS, transfer): automatic (earliest expiry first) or one batch picked by hand. */
export function BatchPick({ item, warehouseId, value, onChange }: {
  item: Pick<ItemView, 'id' | 'trackBatches'> | undefined; warehouseId: string; value: string; onChange(batchId: string): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [rows, setRows] = useState<BatchReportRow[]>([]);
  useEffect(() => {
    if (!item?.trackBatches || !warehouseId) { setRows([]); return; }
    let alive = true;
    batchesApi.ofItem(item.id, warehouseId).then((r) => { if (alive) setRows(r.filter((b) => b.qtyMilli > 0)); }, () => {});
    return () => { alive = false; };
  }, [item?.id, item?.trackBatches, warehouseId]);
  if (!item?.trackBatches) return null;
  return (
    <select className="input small" style={{ marginTop: 4 }} value={value} aria-label={t('ex_batch')} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('ex_auto')}</option>
      {rows.map((b) => (
        <option key={b.batchId} value={b.batchId}>
          {(b.batch || t('ex_noNumber'))}{b.expiry ? ` · ${i18n.date(b.expiry)}` : ''} · {i18n.qty(b.qtyMilli)}{b.state === 'expired' ? ` · ${t('ex_state_expired')}` : ''}
        </option>
      ))}
    </select>
  );
}

/** Whether an error says some stock is past its expiry date (the 'warn' policy lets the user confirm and go on). */
export function isExpiredRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'validation' && Array.isArray(error.details) && (error.details as { code?: string }[]).some((d) => d.code === 'batch_expired');
}

/**
 * The confirmation before selling stock past its expiry date: an in-app dialog (it follows the page's direction, as
 * the browser's own box does not). `ask(error)` resolves true only when the company allows it ('warn') and the user
 * confirmed; any other error resolves false and shows as it is.
 */
export function useExpiredConfirm(): { dialog: ReactNode; ask(error: unknown): Promise<boolean> } {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const answer = useRef<((yes: boolean) => void) | null>(null);
  const close = (yes: boolean) => {
    setOpen(false);
    answer.current?.(yes);
    answer.current = null;
  };
  async function ask(error: unknown): Promise<boolean> {
    if (!isExpiredRefusal(error)) return false;
    try {
      if ((await batchesApi.settings()).expiredSales !== 'warn') return false;
    } catch {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      answer.current = resolve;
      setOpen(true);
    });
  }
  const dialog = open ? (
    <Modal title={t('ex_expired')} onClose={() => close(false)}>
      <div className="stack">
        <p style={{ margin: 0 }}>{t('ex_confirmExpired')}</p>
        <div className="row">
          <button type="button" className="btn danger" onClick={() => close(true)}><Icon name="check" size={16} />{t('ex_sellAnyway')}</button>
          <button type="button" className="btn" onClick={() => close(false)} autoFocus>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  ) : null;
  return { dialog, ask };
}
