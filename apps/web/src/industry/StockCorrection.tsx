import { useMemo, useRef, useState } from 'react';
import { roundHalfUp, UNITS } from '@qasa/core';
import {
  api, ApiError, CORRECTION_REASONS, isNetworkError, newIdempotencyKey, type CorrectionReason, type ItemDetail, type StockCorrectionInput, type StockCorrectionResult
} from '../api.ts';
import { AmountInput, ErrorBox, Icon, Modal, QtyInput, SearchCombo, useData, useLoad, useMay, useToast, type PickOption } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { BatchInFields } from './BatchFields.tsx';

/**
 * "Correct stock" on an item's page (and a row of the Items list): what is there now, or what to add or take out, in
 * one warehouse, and why. The server makes the document that reason has (a stock adjustment, opening stock, or a
 * purchase invoice when the supplier of a purchase never entered is picked: packages/server/src/stock-correction.ts)
 * and posts it where the company's rules let this person; the item's page shows the result at once.
 */

/** What a reason allows: out only, in only, or either way. */
export const REASON_WAY: Record<CorrectionReason, 'out' | 'in' | 'both'> = {
  purchase_missing: 'in', found: 'both', damaged: 'out', lost: 'out', opening: 'in', other: 'both'
};

/** The difference a correction makes (base thousandths), from what the books hold and what was typed. */
export function correctionDiff(mode: 'set' | 'change', way: 'in' | 'out', qtyMilli: number | null, onBooksMilli: number): number | null {
  if (qtyMilli === null) return null;
  if (mode === 'set') return qtyMilli - onBooksMilli;
  return way === 'out' ? -qtyMilli : qtyMilli;
}

/** A cost to suggest for what comes in (IQD per base unit): the average cost while there is stock, else the purchase price. */
export function suggestedCost(item: Pick<ItemDetail, 'qtyMilli' | 'value' | 'purchasePrice' | 'purchaseCurrency'>, rateX100: number | undefined): number | null {
  if (item.value !== undefined && item.qtyMilli > 0) return roundHalfUp((item.value * 1000) / item.qtyMilli);
  if (item.purchasePrice === null || item.purchasePrice === undefined) return null;
  if (item.purchaseCurrency === 'USD') return rateX100 ? roundHalfUp((item.purchasePrice * rateX100) / 10000) : null;
  return item.purchasePrice;
}

/** What the person is refused before anything is sent (the server says the same). */
export function correctionProblem(reason: CorrectionReason, diff: number | null, note: string, unitCost: number | null): Key | null {
  if (diff === null) return 'err_line_qty_invalid_qtyMilli';
  if (diff === 0) return 'err_correction_no_change';
  if (REASON_WAY[reason] === 'out' && diff > 0) return 'err_correction_out_only_reason';
  if (REASON_WAY[reason] === 'in' && diff < 0) return 'err_correction_in_only_reason';
  if (reason === 'other' && !note.trim()) return 'err_note_required_note';
  if (diff > 0 && (reason === 'purchase_missing' || reason === 'opening') && unitCost === null) return 'err_line_price_invalid_unitCost';
  return null;
}

/** The same, opened from a row of the Items list: the item's stock per warehouse is read first. */
export function StockCorrectionFor({ itemId, onClose, onDone }: { itemId: string; onClose(): void; onDone(result: StockCorrectionResult): void }) {
  const { data, error } = useLoad(() => api.item(itemId), [itemId]);
  if (error) return <Modal title="" onClose={onClose}><ErrorBox error={error} /></Modal>;
  return data ? <StockCorrection item={data} onClose={onClose} onDone={onDone} /> : null;
}

export function StockCorrection({ item, initialReason = 'found', onClose, onDone }: {
  item: ItemDetail;
  initialReason?: CorrectionReason;
  onClose(): void;
  onDone(result: StockCorrectionResult): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const can = useMay();
  const { settings } = useData();
  const warehouses = useLoad(() => api.warehouses(), []);
  const active = (warehouses.data ?? []).filter((w) => w.active);
  const [warehouseId, setWarehouseId] = useState(() => item.stock[0]?.warehouseId ?? '');
  const shownWarehouse = warehouseId || active[0]?.id || '';
  const onBooks = item.stock.find((s) => s.warehouseId === shownWarehouse)?.qtyMilli ?? 0;
  const [mode, setMode] = useState<'set' | 'change'>('set');
  const [way, setWay] = useState<'in' | 'out'>('in');
  const [qtyMilli, setQtyMilli] = useState<number | null>(null);
  const [reason, setReason] = useState<CorrectionReason>(initialReason);
  const suggestion = useMemo(() => suggestedCost(item, settings?.defaultRateX100), [item, settings?.defaultRateX100]);
  const [unitCost, setUnitCost] = useState<number | null>(suggestion);
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [batch, setBatch] = useState({ batchNo: '', expiry: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<Key | null>(null);
  // the key of a try that got no answer: sent again unchanged, it makes the document once
  const held = useRef<{ key: string; of: string } | null>(null);
  const buys = can('purchase');
  const suppliers = useLoad(() => (buys ? api.parties({ type: 'supplier', active: 'true' }) : Promise.resolve([])), [buys]);
  const supplierOptions: PickOption[] = (suppliers.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone }));

  const diff = correctionDiff(mode, way, qtyMilli, onBooks);
  const comesIn = diff !== null && diff > 0;
  const unit = i18n.name(UNITS[item.unit]);
  const explain: Key = reason === 'purchase_missing' && supplierId ? 'sc_x_supplier' : `sc_x_${reason}`;

  async function save() {
    if (busy) return;
    const wrong = correctionProblem(reason, diff, note, unitCost);
    if (wrong) { setProblem(wrong); return; }
    const input: StockCorrectionInput = {
      warehouseId: shownWarehouse, mode, qtyMilli: mode === 'set' ? qtyMilli! : diff!, reason, lang: i18n.lang,
      ...(comesIn && unitCost !== null ? { unitCost } : {}),
      ...(reason === 'purchase_missing' && supplierId ? { supplierId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(comesIn && item.trackBatches && batch.batchNo.trim() ? { batchNo: batch.batchNo.trim() } : {}),
      ...(comesIn && item.trackExpiry && batch.expiry ? { expiry: batch.expiry } : {})
    };
    const of = JSON.stringify([item.id, input]);
    if (!held.current || held.current.of !== of) held.current = { key: newIdempotencyKey(), of };
    setBusy(true);
    setError(null);
    try {
      const result = await api.correctStock(item.id, input, { key: held.current.key });
      held.current = null;
      const doc = result.document.number ?? '';
      toast(result.posted ? t('sc_done', { doc }) : t(result.document.type === 'stock_doc' ? 'sc_waitingOpening' : 'sc_waiting'));
      onDone(result);
    } catch (e) {
      // a refusal: the same fields may be sent again with a new key; a lost answer keeps the key (made at most once)
      if (!isNetworkError(e) && e instanceof ApiError) held.current = null;
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const change = (fn: () => void) => { fn(); setProblem(null); };

  return (
    <Modal title={`${t('sc_title')} — ${i18n.name(item.name)}`} onClose={onClose}>
      <div className="stack stock-correction">
        <p className="muted small" style={{ margin: 0 }}>{t('sc_help')}</p>
        <div className="grid-2">
          {active.length > 1 ? (
            <label className="field">
              <span>{t('warehouse')}</span>
              <select className="input" value={shownWarehouse} onChange={(e) => change(() => setWarehouseId(e.target.value))}>
                {active.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
              </select>
            </label>
          ) : <div className="field"><span>{t('warehouse')}</span><div className="input" aria-readonly="true">{active[0] ? i18n.name(active[0].name) : ''}</div></div>}
          <div className="field">
            <span>{t('sc_onBooks')}</span>
            <div className="input num" aria-readonly="true"><strong>{i18n.qty(onBooks)}</strong> <span className="muted small">{unit}</span></div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="track" role="group" aria-label={t('sc_title')}>
            <button type="button" aria-pressed={mode === 'set'} onClick={() => change(() => setMode('set'))}>{t('sc_modeSet')}</button>
            <button type="button" aria-pressed={mode === 'change'} onClick={() => change(() => setMode('change'))}>{t('sc_modeChange')}</button>
          </div>
          {mode === 'change' && (
            <div className="track" role="group" aria-label={t('adj_direction')}>
              <button type="button" aria-pressed={way === 'in'} onClick={() => change(() => setWay('in'))}>{t('adj_in')}</button>
              <button type="button" aria-pressed={way === 'out'} onClick={() => change(() => setWay('out'))}>{t('adj_out')}</button>
            </div>
          )}
        </div>
        <div className="grid-2">
          <div className="field">
            <span>{mode === 'set' ? t('sc_counted') : t('sc_qty')}</span>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
              <QtyInput value={qtyMilli} onChange={(v) => change(() => setQtyMilli(v))} ariaLabel={mode === 'set' ? t('sc_counted') : t('sc_qty')} />
              <span className="muted small" style={{ whiteSpace: 'nowrap' }}>{unit}</span>
            </div>
          </div>
          <div className="field">
            <span>{t('sc_after')}</span>
            <div className="input num" aria-readonly="true">
              {diff === null ? '—' : <><strong>{i18n.qty(onBooks + diff)}</strong> <span className="muted small">({diff > 0 ? '+' : diff < 0 ? '−' : ''}{i18n.qty(Math.abs(diff))})</span></>}
            </div>
          </div>
        </div>
        <label className="field">
          <span>{t('adj_reason')}</span>
          <select className="input" value={reason} onChange={(e) => change(() => setReason(e.target.value as CorrectionReason))}>
            {CORRECTION_REASONS.map((r) => <option key={r} value={r}>{t(`sc_r_${r}`)}</option>)}
          </select>
        </label>
        <div className="alert info small">{t(explain)}</div>
        {reason === 'purchase_missing' && (buys ? (
          <div className="field">
            <span>{t('sc_supplier')}</span>
            <SearchCombo value={supplierId} options={supplierOptions} onChange={(v) => change(() => setSupplierId(v))} placeholder={t('chooseSupplier')} ariaLabel={t('sc_supplier')} emptyLabel={t('sc_noSupplier')} />
          </div>
        ) : <span className="muted small">{t('sc_supplierNeedsPurchases')}</span>)}
        {(comesIn || (diff === null && (mode === 'set' || way === 'in'))) && reason !== 'damaged' && reason !== 'lost' && (
          <>
            <div className="grid-2">
              <div className="field">
                <span>{t('sc_unitCost')} <span className="muted small">/ {unit}</span></span>
                <AmountInput value={unitCost} currency="IQD" onChange={(v) => change(() => setUnitCost(v))} ariaLabel={t('sc_unitCost')} />
                {(reason === 'found' || reason === 'other') && <span className="muted small">{t('sc_costAverage')}</span>}
              </div>
            </div>
            {item.trackBatches && (
              <div className="field">
                <span>{t('ex_batch')}</span>
                <BatchInFields item={item} batchNo={batch.batchNo} expiry={batch.expiry} onChange={(v) => change(() => setBatch(v))} />
              </div>
            )}
          </>
        )}
        <label className="field">
          <span>{reason === 'other' ? t('sc_noteOther') : t('sc_note')}</span>
          <input className={'input' + (problem === 'err_note_required_note' ? ' invalid' : '')} maxLength={400} value={note} onChange={(e) => change(() => setNote(e.target.value))} />
        </label>
        {problem && <div className="alert bad" role="alert">{t(problem)}</div>}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !shownWarehouse} onClick={() => void save()}><Icon name="check" size={16} />{busy ? t('saving') : t('sc_save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
